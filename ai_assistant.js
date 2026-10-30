/* ———————————————————————————————————————————————————————————————
   Sillage AI — embedded B2B retail-intelligence assistant for Maison Atlas
   Reads the live dataset + pipeline through window.SillageContext (set by index.html).
   Built-in analytical engine answers offline; an optional Anthropic / OpenAI key
   (kept in this browser only) turns free-form questions over to an LLM with the same context.
   ——————————————————————————————————————————————————————————————— */
(function () {
  "use strict";

  const CHAT_KEY = "sillage-chat-v1", CFG_KEY = "sillage-cfg-v1";
  const OPEN_W = { High: 1, Med: .55, Low: .15 };
  const BARRIER = { Low: 0, Med: 2, High: 6, "Very High": 10 };
  const STALE_DAYS = { "Discovery Set Sent": 14, "Follow-up Required": 10, "Meeting Booked": 21 };
  const NEXT_STEP = {
    "Discovery Set Sent": "Call to collect first impressions on the discovery set; propose a 6-unit opening order.",
    "Follow-up Required": "Send the retailer-margin sheet and a dated proposal for a meeting.",
    "Meeting Booked": "Confirm the meeting, bring tester + sell-in story, close on MOQ.",
  };
  const CHIPS = [
    { id: "growth", label: "Top 5 Growth Cities for Single-SKU" },
    { id: "dispatch", label: "Optimize 50 Discovery Set Dispatch List" },
    { id: "stagnation", label: "Pipeline Stagnation & Follow-up Audit" },
    { id: "exclusivity", label: "Exclusivity Zone Conflict Check" },
    { id: "export", label: "Swiss & Non-EU Export Strategy" },
    { id: "restock", label: "Restock & Sell-Through Forecast" },
    { id: "outreach", label: "Outreach Sequences Due Today" },
    { id: "potential", label: "Export Potential Leaders" },
  ];

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Figures are EUR internally; the CRM formats them in the currency picked in the header (€ / CHF / £)
  const kEur = v => ctx.short(v);
  const isExport = r => ctx.marketOf(r) !== "EUR";
  const avg = (a, f) => a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : 0;
  const daysSince = d => d ? Math.floor((Date.now() - new Date(d + "T12:00:00")) / 864e5) : null;
  const km = (a, b) => {
    const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const mode = arr => { const c = {}; arr.forEach(x => (c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(e => e[0]); };

  let ctx = null;
  const ctxReady = new Promise(res => {
    if (window.SillageContext) { ctx = window.SillageContext; res(); }
    else document.addEventListener("sillage:ready", () => { ctx = window.SillageContext; res(); }, { once: true });
  });

  // ———————————————————————————————— Analytical engine
  const isProtected = r => ctx.protectedStatuses.includes(r.pipeline_status);
  const isOpen = r => r.pipeline_status !== "Declined" && !isProtected(r);
  // Single-SKU placement score, 0–100: fit carries most weight, then openness, tier, CX, ease of entry
  function score(r) {
    const cx = r.customer_experience_rating == null ? 0 : (r.customer_experience_rating - 4.2) * 12;
    const s = .45 * r.brand_alignment_score + .22 * r.tier_score + 22 * OPEN_W[r.single_sku_openness] + cx
      + (r.launch_priority.startsWith("Tier 1") ? 8 : 0) + (r.openness_verified ? 3 : 0) - (BARRIER[r.entry_barrier] || 0);
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  // Rough close probability for a discovery set sent today
  const convP = r => Math.min(.6, .06 + .3 * OPEN_W[r.single_sku_openness] * r.brand_alignment_score / 100 + (r.launch_priority.startsWith("Tier 1") ? .08 : 0));
  const zoneOf = r => {
    if (isProtected(r)) return null;
    let best = null;
    ctx.data.filter(isProtected).forEach(p => { const d = km(r, p); if (d <= ctx.zoneKm && (!best || d < best.km)) best = { p, km: d }; });
    return best;
  };
  const storeLink = r => `<button class="sl-store" data-id="${r.id}" title="Show on map">${esc(r.name)}</button>`;
  const meta = r => `${esc(r.city)} · ${esc(r.country)} · fit ${r.brand_alignment_score} · tier ${r.tier_score} · SKU ${esc(r.single_sku_openness)}`;

  function overview() {
    const d = ctx.data, sim = ctx.sim;
    const by = k => mode(d.map(r => r[k]));
    const counts = k => Object.fromEntries(by(k).map(v => [v, d.filter(r => r[k] === v).length]));
    return {
      stores: d.length, shown: ctx.shown.length, countries: counts("country"), types: counts("type"), segments: counts("segment"),
      pipeline: counts("pipeline_status"), openness: counts("single_sku_openness"), priority: counts("launch_priority"),
      avg_fit: Math.round(avg(d, r => r.brand_alignment_score)), avg_tier: Math.round(avg(d, r => r.tier_score)),
      exclusivity_radius_km: ctx.zoneKm,
      unit_economics: { msrp: sim.msrp, wholesale: +sim.wholesale.toFixed(2), brand_margin_per_unit: +sim.brandM.toFixed(2), moq_units: sim.moq, reorders_y1: sim.re, base_currency: "EUR" },
      currency: currencyContext(),
      partners: d.filter(isProtected).map(r => ({ name: r.name, city: r.city, status: r.pipeline_status,
        revenue: Math.round(r._ws?.revenue || 0), outstanding: Math.round(r._ws?.outstanding || 0), overdue: Math.round(r._ws?.overdue || 0),
        last_invoice: r._ws?.last || null, stock: r._rs ? { status: r._rs.label, on_hand: Math.round(r._rs.onHand), cover_days: Math.round(r._rs.cover),
          units_per_month: +r._rs.perMonth.toFixed(1), reorder_by: r._rs.reorderDate, suggested_units: r._rs.suggest } : null })),
      alerts: (a => ({ restock: a.restock.map(r => `${r.name}: ${r._rs.label}`), sequence_steps_due: a.steps.map(x => `${x.r.name} step ${x.step + 1}`) }))(ctx.alerts()),
    };
  }

  // Market price lists, VAT, thresholds and FX the CRM is using right now
  function currencyContext() {
    const L = ctx.lists, r2 = v => Math.round(v * 100) / 100;
    return { display: ctx.currency, fx_per_eur: { CHF: ctx.fx.CHF, GBP: ctx.fx.GBP, source: ctx.fx.src, as_of: ctx.fx.asof }, vat_pct: ctx.vat,
      markets: Object.fromEntries(Object.entries(L).map(([c, l]) => [c, { name: l.m.name, vat_pct: l.m.vat, corridor: l.m.corridor, msrp: r2(l.msrp), wholesale: r2(l.wholesale),
        brand_margin_unit: r2(l.brandM), moq_units: l.moq, opening_order: Math.round(l.order), min_order: Math.round(l.open), free_shipping: l.m.freeShip,
        freight: l.m.freight, customs_per_shipment: l.m.customs, rules: l.m.duty }])) };
  }

  function growthCities() {
    const groups = new Map();
    ctx.data.forEach(r => {
      const k = r.city + "|" + r.country;
      if (!groups.has(k)) groups.set(k, { city: r.city, country: r.country, all: [] });
      groups.get(k).all.push(r);
    });
    const rows = [...groups.values()].map(g => {
      const pros = g.all.filter(r => isOpen(r) && !zoneOf(r));
      const partners = g.all.filter(isProtected).length;
      // Cross-border doors: clearance fees eat into each shipment, so discount by the landed share of the opening order
      const friction = g.all[0] && isExport(g.all[0]) ? 1 - ctx.priceOf(g.all[0]).m.customs / Math.max(1, ctx.priceOf(g.all[0]).order) : 1;
      const potential = pros.reduce((s, r) => s + score(r) / 100 * OPEN_W[r.single_sku_openness], 0) * friction;
      const value = pros.reduce((s, r) => s + (r._val || 0) * convP(r), 0);
      return { ...g, pros, partners, potential: potential * (partners ? .85 : 1), value, export: friction < 1,
        high: pros.filter(r => r.single_sku_openness === "High").length,
        quick: pros.filter(r => r.launch_priority.startsWith("Tier 1")).length,
        fit: Math.round(avg(pros, r => r.brand_alignment_score)),
        traits: mode(pros.flatMap(r => r.cx_traits)).slice(0, 2) };
    }).filter(g => g.pros.length).sort((a, b) => b.potential - a.potential).slice(0, 5);
    const top = rows[0]?.potential || 1;
    const html = `<p class="sl-lead">Ranked by <b>single-SKU potential</b>: Σ placement score × openness over doors still winnable (not partner, not declined, outside exclusivity zones). Cities already holding a partner are discounted 15 %; Swiss cities by their customs friction. Values in ${esc(ctx.currency)}.</p>` +
      rows.map((g, i) => {
        const lead = [...g.pros].sort((a, b) => score(b) - score(a)).slice(0, 3);
        return `<div class="sl-card"><div class="sl-card-h"><span class="sl-rank">${i + 1}</span><b>${esc(g.city)}</b><span class="sl-mute">${esc(g.country)}</span><span class="sl-idx">${Math.round(g.potential / top * 100)}</span></div>
          <div class="sl-bar"><i style="width:${Math.round(g.potential / top * 100)}%"></i></div>
          <div class="sl-kv"><span>${g.pros.length} winnable doors</span><span>${g.high} high-openness</span><span>${g.quick} Tier 1</span><span>avg fit ${g.fit}</span><span>≈ ${kEur(g.value)} expected y1</span>${g.partners ? `<span class="sl-warn">${g.partners} partner in place</span>` : ""}</div>
          <div class="sl-sub">Lead doors: ${lead.map(storeLink).join(", ")}</div>
          ${g.export ? (l => `<div class="sl-sub sl-warn">Export · ${esc(l.c)} list: wholesale ${ctx.local(l.wholesale, l.c, 2)}, shelf ${ctx.local(l.msrp, l.c)} (VAT ${l.m.vat} %), opening ${ctx.local(l.order, l.c)} · ${ctx.local(l.m.customs, l.c)} clearance per shipment.</div>`)(ctx.priceOf(g.all[0])) : ""}
          ${g.traits.length ? `<div class="sl-sub">Store culture: ${g.traits.map(esc).join(" · ")}</div>` : ""}</div>`;
      }).join("") +
      `<p class="sl-rec"><b>Recommendation.</b> Open ${esc(rows[0]?.city || "–")} first with its top two doors as an exclusive pair, then roll into ${rows.slice(1, 3).map(g => esc(g.city)).join(" and ")} once the first reorder lands — this keeps samples concentrated where word-of-mouth compounds.</p>`;
    return { html, summary: rows.map(g => ({ city: g.city, country: g.country, winnable: g.pros.length, high_openness: g.high, tier1: g.quick, avg_fit: g.fit, expected_y1_eur: Math.round(g.value), partners: g.partners, export_market: g.export })) };
  }

  // Currency-aware export plan: Switzerland today (CHF list, 8.1 % VAT, customs), UK as the next non-EU option
  function exportStrategy() {
    const ch = ctx.data.filter(r => ctx.marketOf(r) === "CHF"), L = ctx.lists, chf = L.CHF, eu = L.EUR, gbp = L.GBP;
    const pros = ch.filter(r => isOpen(r) && !zoneOf(r)).map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
    const partners = ch.filter(isProtected);
    const value = pros.reduce((s, p) => s + (p.r._val || 0) * convP(p.r), 0);
    const cities = mode(pros.map(p => p.r.city)).slice(0, 4).map(c => ({ c, n: pros.filter(p => p.r.city === c).length }));
    const FR_CH = /Geneva|Genève|Lausanne|Montreux|Morges|Nyon|Sion|Delémont|Chaux-de-Fonds|Yverdon|Vésenaz|Payerne|Fribourg|Neuchâtel/, IT_CH = /Lugano|Locarno|Bellinzona|Ascona|Biasca|Vezia/;
    const langOf = c => FR_CH.test(c) ? "French" : IT_CH.test(c) ? "Italian" : "German";
    const f = (v, c, d = 0) => ctx.local(v, c, d);
    const shipments = 1 + ctx.sim.re, clearance = chf.m.customs * shipments;
    const lift = pct => Math.round(pct * 100);
    const unitEu = eu.brandM, unitCh = chf.brandM / ctx.fx.CHF;   // both in EUR
    const html = `<p class="sl-lead">Switzerland: <b>${ch.length} doors</b>, ${pros.length} winnable, ${partners.length} partner${partners.length === 1 ? "" : "s"} · ≈ ${kEur(value)} expected year 1 (shown in ${esc(ctx.currency)}).</p>
      <div class="sl-stats"><div><span>CHF wholesale</span><b>${f(chf.wholesale, "CHF", 2)}</b></div><div><span>Shelf CH</span><b>${f(chf.msrp, "CHF")}</b></div><div><span>Opening</span><b>${f(chf.order, "CHF")}</b></div></div>
      <h4>Price corridor</h4>
      <p class="sl-sub">EUR list ${f(eu.wholesale, "EUR", 2)} → CHF ${f(chf.wholesale, "CHF", 2)} at ${ctx.fx.CHF.toFixed(4)} × ${chf.m.corridor} corridor. Brand margin per unit ${f(unitCh, "EUR", 2)} vs ${f(unitEu, "EUR", 2)} in the EU (${unitCh >= unitEu ? "+" : ""}${lift(unitCh / unitEu - 1)} %) after clearance. Swiss shelf ${f(chf.msrp, "CHF")} at 8.1 % VAT vs ${f(ctx.sim.msrp, "EUR")} in France at 20 % — keep the gap under ~15 % in EUR terms or Geneva clients buy in Annemasse.</p>
      <h4>MOQ &amp; shipping</h4>
      <p class="sl-sub">Swiss minimum ${f(chf.open, "CHF")} → ${chf.moq} units per boutique (EU: ${eu.moq}). ${chf.order < chf.m.freeShip ? `<span class="sl-warn">Opening order ${f(chf.order, "CHF")} is under the ${f(chf.m.freeShip, "CHF")} free-shipping line: push one more case or bill ${f(chf.m.freight, "CHF")} freight.</span>` : "Opening order clears free shipping."} ${shipments} shipments / door / year ≈ ${f(clearance, "CHF")} clearance: consolidate reorders per city.</p>
      <h4>Duty &amp; VAT</h4><p class="sl-sub">${esc(chf.m.duty)}</p>
      ${cities.length ? `<h4>Where to open</h4><ul class="sl-list">${cities.map(({ c, n }) => `<li><b>${esc(c)}</b> <span class="sl-tag">${n} winnable</span> — ${pros.filter(p => p.r.city === c).slice(0, 2).map(p => storeLink(p.r)).join(", ")}</li>`).join("")}</ul>` : ""}
      <h4>Next non-EU market · UK</h4>
      <p class="sl-sub">No UK doors in the directory yet. GBP list would be wholesale ${f(gbp.wholesale, "GBP", 2)}, shelf ${f(gbp.msrp, "GBP")} (20 % VAT), ${gbp.moq}-unit opening ≈ ${f(gbp.order, "GBP")}. ${esc(gbp.m.duty)}</p>
      <p class="sl-rec"><b>Recommendation.</b> Sign one Swiss importer of record (DAP, CHF invoicing) and open ${esc(cities[0]?.c || "Zürich")} first; pitch in ${langOf(cities[0]?.c || "Zürich")}. Ship each city's opening orders together so one clearance fee covers several doors, and re-check the CHF corridor whenever EUR/CHF moves more than 3 %.</p>`;
    return { html, summary: { ch_doors: ch.length, winnable: pros.length, partners: partners.length, expected_y1_eur: Math.round(value), top_cities: cities,
      chf_list: { wholesale: chf.wholesale, msrp: chf.msrp, moq: chf.moq, opening: Math.round(chf.order), free_shipping: chf.m.freeShip, clearance_per_year_per_door: clearance },
      margin_unit_eur: { eu: +unitEu.toFixed(2), ch: +unitCh.toFixed(2) }, top_doors: pros.slice(0, 8).map(p => `${p.r.name} (${p.r.city})`) } };
  }

  let lastDispatch = [];
  function dispatch(n = 50) {
    const pool = ctx.data.filter(r => r.pipeline_status === "Not Contacted" && !zoneOf(r))
      .map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
    const perCity = {}, picked = [];
    // Max 3 per city, and no two picks closer than half the exclusivity radius: avoids sampling two doors that would compete
    for (const pass of [r => r.single_sku_openness !== "Low", () => true]) {
      for (const { r, s } of pool) {
        if (picked.length >= n) break;
        if (picked.some(p => p.r === r) || !pass(r) || (perCity[r.city] || 0) >= 3) continue;
        if (picked.some(p => km(p.r, r) < ctx.zoneKm / 2)) continue;
        perCity[r.city] = (perCity[r.city] || 0) + 1;
        picked.push({ r, s });
      }
    }
    picked.sort((a, b) => a.r.country.localeCompare(b.r.country) || a.r.city.localeCompare(b.r.city) || b.s - a.s);
    lastDispatch = picked.map(p => p.r);
    const expPartners = picked.reduce((s, p) => s + convP(p.r), 0);
    const expRev = picked.reduce((s, p) => s + (p.r._val || 0) * convP(p.r), 0);
    const ccMix = mode(picked.map(p => p.r.country)).map(c => `${c} ${picked.filter(p => p.r.country === c).length}`).join(" · ");
    const segMix = mode(picked.map(p => p.r.segment)).slice(0, 3).map(sg => `${esc(sg)} ${picked.filter(p => p.r.segment === sg).length}`).join(" · ");
    const html = `<p class="sl-lead">${picked.length} discovery sets selected from ${pool.length} uncontacted doors outside protected territories. Capped at 3 per city, min. ${(ctx.zoneKm / 2).toFixed(1)} km apart, low-openness doors only as filler. Sorted by country → city for one shipping run.</p>
      <div class="sl-stats"><div><span>Expected partners</span><b>${expPartners.toFixed(1)}</b></div><div><span>Expected y1</span><b>${kEur(expRev)}</b></div><div><span>Avg score</span><b>${Math.round(avg(picked, p => p.s))}</b></div></div>
      <div class="sl-sub">Countries: ${ccMix}</div><div class="sl-sub">Segments: ${segMix}</div>
      <ol class="sl-list">${picked.map(p => `<li>${storeLink(p.r)} <span class="sl-score">${p.s}</span><div class="sl-mute">${meta(p.r)}</div></li>`).join("")}</ol>
      <div class="sl-actions"><button class="sl-btn" data-act="dispatch-csv">Download CSV</button><button class="sl-btn gold" data-act="dispatch-mark">Mark ${picked.length} as Discovery Set Sent</button></div>`;
    return { html, summary: { count: picked.length, expected_partners: +expPartners.toFixed(1), expected_y1_eur: Math.round(expRev), top10: picked.slice(0, 10).map(p => `${p.r.name} (${p.r.city})`) } };
  }

  function stagnation() {
    const sec = [];
    const engaged = ctx.data.filter(r => STALE_DAYS[r.pipeline_status]);
    const stale = [], undated = [];
    engaged.forEach(r => {
      const d = daysSince(ctx.touched(r.crm_key));
      if (d == null) undated.push(r); else if (d >= STALE_DAYS[r.pipeline_status]) stale.push({ r, d });
    });
    stale.sort((a, b) => b.d / STALE_DAYS[b.r.pipeline_status] - a.d / STALE_DAYS[a.r.pipeline_status]);
    const partners = ctx.data.filter(isProtected);
    const overdue = partners.filter(r => r._ws?.overdueN).sort((a, b) => b._ws.overdue - a._ws.overdue);
    const lapsed = partners.map(r => ({ r, d: daysSince(r._ws?.last) })).filter(x => x.d == null || x.d > 90).sort((a, b) => (b.d ?? 1e9) - (a.d ?? 1e9));
    const idleQuick = ctx.data.filter(r => r.pipeline_status === "Not Contacted" && r.launch_priority.startsWith("Tier 1") && r.single_sku_openness === "High" && !zoneOf(r))
      .sort((a, b) => score(b) - score(a));

    sec.push(`<p class="sl-lead">Pipeline: ${engaged.length} doors in active prospecting, ${partners.length} partners. SLA: discovery 14 d, follow-up 10 d, meeting 21 d since last status change.</p>`);
    sec.push(`<h4>Stalled prospects <span class="sl-mute">${stale.length}</span></h4>` + (stale.length
      ? `<ul class="sl-list">${stale.map(({ r, d }) => `<li>${storeLink(r)} <span class="sl-tag">${esc(r.pipeline_status)} · ${d} d</span><div class="sl-mute">${esc(NEXT_STEP[r.pipeline_status])}</div>${r.cx_insights?.pitch ? `<div class="sl-mute">Angle: ${esc(r.cx_insights.pitch)}</div>` : ""}</li>`).join("")}</ul>`
      : `<p class="sl-sub">None past SLA.</p>`));
    if (undated.length) sec.push(`<h4>Undated stages <span class="sl-mute">${undated.length}</span></h4><p class="sl-sub">Status was set before tracking started: re-confirm and re-save to start the clock — ${undated.slice(0, 8).map(storeLink).join(", ")}${undated.length > 8 ? "…" : ""}</p>`);
    sec.push(`<h4>Collections <span class="sl-mute">${overdue.length}</span></h4>` + (overdue.length
      ? `<ul class="sl-list">${overdue.map(r => `<li>${storeLink(r)} <span class="sl-tag bad">${kEur(r._ws.overdue)} overdue · ${r._ws.overdueN} inv.</span><div class="sl-mute">Polite reminder + statement; hold next delivery until settled.</div></li>`).join("")}</ul>`
      : `<p class="sl-sub">No overdue invoices.</p>`));
    sec.push(`<h4>Reorder lapse &gt; 90 d <span class="sl-mute">${lapsed.length}</span></h4>` + (lapsed.length
      ? `<ul class="sl-list">${lapsed.map(({ r, d }) => `<li>${storeLink(r)} <span class="sl-tag">${d == null ? "no invoice yet" : d + " d since last invoice"}</span><div class="sl-mute">Check sell-through, offer a staff training or tester refresh to trigger reorder.</div></li>`).join("")}</ul>`
      : `<p class="sl-sub">Every partner invoiced within 90 days.</p>`));
    sec.push(`<h4>Untouched quick wins <span class="sl-mute">${idleQuick.length}</span></h4><p class="sl-sub">Tier 1, high openness, free territory, never contacted: ${idleQuick.slice(0, 8).map(storeLink).join(", ") || "none"}.</p>`);
    return { html: sec.join(""), summary: { stalled: stale.map(x => `${x.r.name} – ${x.r.pipeline_status} ${x.d}d`), undated: undated.length,
      overdue: overdue.map(r => `${r.name} ${Math.round(r._ws.overdue)}€`), reorder_lapse: lapsed.map(x => x.r.name), idle_quick_wins: idleQuick.length } };
  }

  function exclusivity() {
    const R = ctx.zoneKm, partners = ctx.data.filter(isProtected);
    const conflicts = ctx.data.filter(r => r.pipeline_status !== "Not Contacted" && isOpen(r)).map(r => ({ r, z: zoneOf(r) })).filter(x => x.z);
    const overlaps = [];
    partners.forEach((a, i) => partners.slice(i + 1).forEach(b => { const d = km(a, b); if (d < 2 * R) overlaps.push({ a, b, d }); }));
    overlaps.sort((x, y) => x.d - y.d);
    const blocked = ctx.data.filter(r => r.pipeline_status === "Not Contacted" && r.launch_priority.startsWith("Tier 1")).map(r => ({ r, z: zoneOf(r) })).filter(x => x.z);
    const shadowed = ctx.data.filter(r => isOpen(r) && zoneOf(r)).length;
    const html = `<p class="sl-lead">Radius ${R.toFixed(1)} km around ${partners.length} protected accounts · ${shadowed} doors fall inside a territory.</p>
      <h4>Active conflicts <span class="sl-mute">${conflicts.length}</span></h4>${conflicts.length
        ? `<ul class="sl-list">${conflicts.map(({ r, z }) => `<li>${storeLink(r)} <span class="sl-tag bad">${esc(r.pipeline_status)}</span><div class="sl-mute">${z.km.toFixed(1)} km from partner ${storeLink(z.p)} — pause outreach or obtain the partner's written consent.</div></li>`).join("")}</ul>`
        : `<p class="sl-sub">No prospect in play inside a partner territory.</p>`}
      <h4>Overlapping territories <span class="sl-mute">${overlaps.length}</span></h4>${overlaps.length
        ? `<ul class="sl-list">${overlaps.slice(0, 12).map(o => `<li>${storeLink(o.a)} ↔ ${storeLink(o.b)} <span class="sl-tag">${o.d.toFixed(1)} km</span></li>`).join("")}</ul><p class="sl-sub">Overlaps &lt; ${(2 * R).toFixed(1)} km: define street-level boundaries in contracts, or downgrade one to non-exclusive.</p>`
        : `<p class="sl-sub">Partner territories are disjoint.</p>`}
      <h4>Tier 1 opportunities blocked <span class="sl-mute">${blocked.length}</span></h4><p class="sl-sub">${blocked.slice(0, 8).map(({ r, z }) => `${storeLink(r)} (${z.km.toFixed(1)} km from ${esc(z.p.name)})`).join(", ") || "None."}</p>
      <p class="sl-rec"><b>Recommendation.</b> ${conflicts.length ? "Resolve the active conflicts before the next dispatch. " : ""}${blocked.length > 3 ? `A ${Math.max(.5, R / 2).toFixed(1)} km radius in dense cities would release ${blocked.length} Tier 1 doors — consider city-specific radii.` : "Current radius leaves Tier 1 coverage intact."}</p>`;
    return { html, summary: { radius_km: R, conflicts: conflicts.map(x => `${x.r.name} in zone of ${x.z.p.name} (${x.z.km.toFixed(1)} km)`), overlaps: overlaps.length, tier1_blocked: blocked.length } };
  }

  function storeBrief(r) {
    const z = zoneOf(r), ins = r.cx_insights || {};
    return `<div class="sl-card"><div class="sl-card-h"><b>${storeLink(r)}</b><span class="sl-idx">${score(r)}</span></div>
      <div class="sl-sub">${esc(r.type)} · ${esc(r.segment)} · ${esc(r.full_address)}</div>
      <div class="sl-kv"><span>${esc(r.pipeline_status)}</span><span>fit ${r.brand_alignment_score}</span><span>tier ${r.tier_score}</span><span>SKU ${esc(r.single_sku_openness)}</span><span>CX ${r.customer_experience_rating ?? "–"}</span><span>entry ${esc(r.entry_barrier)}</span></div>
      ${ins.pitch ? `<p class="sl-sub"><b>Pitch.</b> ${esc(ins.pitch)}</p>` : ""}${ins.watch_out ? `<p class="sl-sub"><b>Watch out.</b> ${esc(ins.watch_out)}</p>` : ""}
      ${z ? `<p class="sl-sub sl-warn">Inside ${esc(z.p.name)}'s territory (${z.km.toFixed(1)} km).</p>` : ""}
      ${r._ws ? `<p class="sl-sub">Wholesale: ${r._ws.units} units · ${kEur(r._ws.revenue)} invoiced · ${kEur(r._ws.outstanding)} outstanding</p>` : `<p class="sl-sub">Close probability if sampled now ≈ ${Math.round(convP(r) * 100)} %.</p>`}
      ${r._rs ? `<p class="sl-sub ${r._rs.alert ? "sl-warn" : ""}">Stock: ${esc(r._rs.label)} · ≈ ${Math.round(r._rs.onHand)} u. on hand · ${Math.round(r._rs.cover)} d cover · ${r._rs.perMonth.toFixed(1)} u./month${r._rs.alert ? ` · reorder ${r._rs.suggest} u. by ${esc(r._rs.reorderDate)}` : ""}</p>` : ""}
      <p class="sl-sub">Export potential ${r.export_potential_score}/100 · ${esc(r.export_potential.nearest_hub)} ${r.export_potential.hub_km} km · ${r.export_potential.high_end_doors_5km} high-end doors ≤ 5 km</p>
      ${isExport(r) ? (l => `<p class="sl-sub">Export · ${esc(l.c)} list: wholesale ${ctx.local(l.wholesale, l.c, 2)}, shelf ${ctx.local(l.msrp, l.c)} at ${l.m.vat} % VAT, MOQ ${ctx.moqFor(r)} u.</p>`)(ctx.priceOf(r)) : ""}</div>`;
  }

  // Predictive restock: velocity from the delivery log, cover vs lead time, suggested case-pack reorder
  function restockForecast() {
    const P = ctx.data.filter(r => r._rs).sort((a, b) => a._rs.rank - b._rs.rank || a._rs.cover - b._rs.cover);
    const alerts = P.filter(r => r._rs.alert), units = P.reduce((a, r) => a + r._rs.perMonth, 0);
    const reorderValue = alerts.reduce((a, r) => a + r._rs.suggest * ctx.priceOf(r).eurPerUnit, 0);
    const line = r => { const s = r._rs; return `<li>${storeLink(r)} <span class="sl-tag ${s.tone === "bad" ? "bad" : ""}">${esc(s.label)}</span>
      <div class="sl-mute">≈ ${Math.round(s.onHand)} u. on hand · ${Math.round(s.cover)} d cover · ${s.perMonth.toFixed(1)} u./month${s.trend != null ? ` (${s.trend >= 0 ? "+" : ""}${Math.round(s.trend * 100)} %)` : ""} · cadence ${Math.round(s.cadence)} d</div>
      ${s.alert ? `<div class="sl-mute">→ Reorder by ${esc(s.reorderDate)}: propose <b>${s.suggest} units</b>${s.skus.length > 1 ? `, lowest cover on ${esc(s.skus[0].sku)} (${Math.round(s.skus[0].cover)} d)` : ""}.</div>` : ""}</li>`; };
    const html = `<p class="sl-lead">${P.length} partner doors sell through ≈ <b>${units.toFixed(0)} units / month</b>. ${alerts.length ? `<b>${alerts.length} need stock</b> — ${kEur(reorderValue)} of reorders to propose now.` : "Every door is covered beyond lead time."}</p>
      <h4>Alerts <span class="sl-mute">${alerts.length}</span></h4>${alerts.length ? `<ul class="sl-list">${alerts.map(line).join("")}</ul>` : `<p class="sl-sub">None.</p>`}
      <h4>Healthy <span class="sl-mute">${P.length - alerts.length}</span></h4>${P.length - alerts.length ? `<ul class="sl-list">${P.filter(r => !r._rs.alert).map(line).join("")}</ul>` : `<p class="sl-sub">–</p>`}
      <p class="sl-sub">Model: each delivery is assumed to sell through before the next; velocity is an exponentially weighted mean (recent orders count most). Lead time 10 d, safety window 14 d.</p>`;
    return { html, summary: P.map(r => ({ store: r.name, status: r._rs.label, on_hand: Math.round(r._rs.onHand), cover_days: Math.round(r._rs.cover), per_month: +r._rs.perMonth.toFixed(1), suggest: r._rs.suggest })) };
  }
  // Day 0 / 7 / 14 outreach steps whose date has come
  function outreachDue() {
    const due = ctx.dueSteps(), names = ["Initial email", "Value-add follow-up", "Sample delivery confirmation"];
    const scheduled = ctx.data.filter(r => ctx.sequence(r.crm_key)).length;
    const html = `<p class="sl-lead">${scheduled} sequence${scheduled === 1 ? "" : "s"} running · <b>${due.length} step${due.length === 1 ? "" : "s"} due</b>.</p>${due.length
      ? `<ul class="sl-list">${due.map(x => `<li>${storeLink(x.r)} <span class="sl-tag ${x.late ? "bad" : ""}">Step ${x.step + 1} · ${x.late ? x.late + " d late" : "today"}</span><div class="sl-mute">${names[x.step]} (Day ${ctx.seqDays[x.step]}) · <button class="sl-store" data-seq="${x.r.id}">Open sequence</button></div></li>`).join("")}</ul>`
      : `<p class="sl-sub">Nothing due. Start a sequence from any pitch: Day 0 intro, Day 7 value-add with local market stats, Day 14 sample delivery check.</p>`}`;
    return { html, summary: due.map(x => `${x.r.name}: step ${x.step + 1} (${x.late} d late)`) };
  }
  // Doors where local wealth, luxury hubs and high-end clientele converge, still winnable
  function potentialLeaders() {
    const pros = ctx.data.filter(r => isOpen(r)).sort((a, b) => b.export_potential_score - a.export_potential_score || score(b) - score(a));
    const blend = pros.map(r => ({ r, b: Math.round(.5 * r.export_potential_score + .5 * score(r)) })).sort((a, b) => b.b - a.b).slice(0, 10);
    const html = `<p class="sl-lead">Export Potential Score = 40 % purchasing power · 30 % luxury-hub proximity · 30 % high-end clientele density. Below: winnable doors ranked by <b>potential × placement score</b> (50/50).</p>
      <ol class="sl-list">${blend.map(({ r, b }) => { const e = r.export_potential, g = ctx.guard(r);
        return `<li>${storeLink(r)} <span class="sl-score">${b}</span><div class="sl-mute">export ${r.export_potential_score} · fit ${r.brand_alignment_score} · ${esc(e.nearest_hub)} ${e.hub_km} km · ${e.high_end_doors_5km} high-end doors ≤ 5 km${g && g.risk !== "clear" ? ` · <span class="sl-warn">${esc(g.label)}</span>` : ""}</div></li>`; }).join("")}</ol>
      <p class="sl-rec"><b>Highest raw potential:</b> ${pros.slice(0, 5).map(r => `${storeLink(r)} (${r.export_potential_score})`).join(", ")}.</p>`;
    return { html, summary: blend.map(({ r, b }) => ({ store: r.name, city: r.city, blended: b, export_potential: r.export_potential_score, fit: r.brand_alignment_score })) };
  }

  const ANALYSES = { growth: growthCities, dispatch, stagnation, exclusivity, export: exportStrategy, restock: restockForecast, outreach: outreachDue, potential: potentialLeaders };
  function route(q) {
    const t = q.toLowerCase();
    if (/export|switzerland|suisse|swiss|schweiz|\bchf\b|\bgbp\b|\buk\b|britain|royaume|non-eu|hors.?ue|douane|customs|currency|devise|vat|tva/.test(t)) return "export";
    if (/restock|reorder|réassort|stock|sell.?through|rupture|velocity|rotation/.test(t)) return "restock";
    if (/sequence|séquence|cadence|outreach|prospection due|step/.test(t)) return "outreach";
    if (/potential|potentiel|purchasing|pouvoir d'achat|wealth|luxury hub/.test(t)) return "potential";
    if (/growth|croissance|ville|cit(y|ies)|where.*(launch|open)/.test(t)) return "growth";
    if (/dispatch|discovery|sample|échantillon|coffret|envoi|send/.test(t)) return "dispatch";
    if (/stagna|follow|relance|stuck|audit|overdue|reorder|impay/.test(t)) return "stagnation";
    if (/exclusiv|zone|territor|conflict|conflit|radius/.test(t)) return "exclusivity";
    return null;
  }
  function localAnswer(q) {
    const id = route(q);
    if (id) return ANALYSES[id]().html;
    const t = q.toLowerCase().trim();
    const exactCity = ctx.data.some(r => r.city.toLowerCase() === t);
    const hit = !exactCity && t.length > 3 && ctx.data.filter(r => r.name.toLowerCase().includes(t) || t.includes(r.name.toLowerCase())).slice(0, 3);
    if (hit && hit.length) return hit.map(storeBrief).join("");
    const city = ctx.data.find(r => r.city.toLowerCase() === t) || ctx.data.find(r => t.includes(r.city.toLowerCase()));
    if (city) {
      const rows = ctx.data.filter(r => r.city === city.city).sort((a, b) => score(b) - score(a));
      return `<p class="sl-lead"><b>${esc(city.city)}</b>: ${rows.length} doors · ${rows.filter(isProtected).length} partners · ${rows.filter(r => r.single_sku_openness === "High").length} high-openness.</p>
        <ol class="sl-list">${rows.slice(0, 8).map(r => `<li>${storeLink(r)} <span class="sl-score">${score(r)}</span><div class="sl-mute">${esc(r.pipeline_status)} · ${meta(r)}</div></li>`).join("")}</ol>`;
    }
    const o = overview();
    return `<p class="sl-lead">${o.stores} doors in ${Object.keys(o.countries).length} markets (${o.shown} in the current view) · avg fit ${o.avg_fit} · ${o.openness.High || 0} high-openness · ${o.partners.length} partners.</p>
      <p class="sl-sub">Built-in mode answers the ${CHIPS.length} analyses above, a store name or a city. Add an API key in ⚙︎ for open-ended strategy questions.</p>`;
  }

  // ———————————————————————————————— LLM (optional)
  let cfg = store.get(CFG_KEY, { provider: "builtin", key: "", model: "" });
  const DEFAULT_MODEL = { anthropic: "claude-opus-5-5", openai: "gpt-4.1" };
  const SYSTEM = `You are Sillage AI, the retail-intelligence assistant inside Maison Atlas, a private CRM used by a niche fragrance house to place a single SKU in independent perfumeries, concept stores and department stores across BE, NL, DE, FR, LU, CH.
Ground every claim in the JSON context you are given (store counts, clusters, tiers, openness, sentiment, pipeline, wholesale ledger, exclusivity radius, unit economics, currency). Never invent stores or figures; say when the data cannot answer.
All raw amounts in the context are EUR. The user is viewing figures in overview.currency.display: quote money in that currency (convert with fx_per_eur) and, for Swiss or other non-EU doors, also in the store's own price-list currency.
When you assess growth outside the EU (Switzerland today, the UK next), reason as an export strategist: the market's price list and corridor premium over spot FX, local VAT (CH 8.1 % vs FR 20 %) and the resulting shelf-price gap with neighbouring EU cities (cross-border shopping risk), MOQ against that market's minimum order and free-shipping threshold, customs clearance per shipment and how consolidating orders amortises it, duty and import-VAT rules, Incoterms (DAP vs DDP) and the need for an importer of record / UK Responsible Person, plus FX exposure on CHF or GBP invoicing.
Answer like a luxury-retail strategist: a one-line verdict, then at most 6 tight bullets with numbers and named doors, then one concrete next action. Use **bold** sparingly. Reply in the user's language.`;

  function llmContext(q) {
    const id = route(q);
    const prospects = ctx.data.filter(isOpen).map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s).slice(0, 40)
      .map(({ r, s }) => ({ name: r.name, city: r.city, cc: r.country, type: r.type, segment: r.segment, status: r.pipeline_status, score: s,
        fit: r.brand_alignment_score, tier: r.tier_score, sku: r.single_sku_openness, cx: r.customer_experience_rating, sentiment: r.sentiment_summary, pitch: r.cx_insights?.pitch }));
    return { overview: overview(), top_prospects: prospects, analysis: id ? { [id]: ANALYSES[id]().summary } : undefined };
  }

  async function llm(history, q) {
    const provider = cfg.provider, model = cfg.model || DEFAULT_MODEL[provider];
    const context = "CRM context (JSON):\n" + JSON.stringify(llmContext(q));
    const turns = history.slice(-8).map(m => ({ role: m.role, content: m.text }));
    const messages = [...turns, { role: "user", content: context + "\n\nQuestion: " + q }];
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model, max_tokens: 4000, system: SYSTEM, output_config: { effort: "low" }, messages }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || res.statusText);
      if (j.stop_reason === "refusal") throw new Error("The model declined this request.");
      return j.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + cfg.key },
      body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM }, ...messages] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || res.statusText);
    return j.choices[0].message.content;
  }
  // Minimal, escape-first markdown: headings, bold, bullets, numbered lists, paragraphs
  function md(text) {
    const lines = esc(text).split("\n"), out = [];
    let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    lines.forEach(l => {
      const b = l.match(/^\s*[-*•]\s+(.*)/), n = l.match(/^\s*\d+[.)]\s+(.*)/), h = l.match(/^#{1,4}\s+(.*)/);
      if (b || n) { const t = b ? "ul" : "ol"; if (list !== t) { close(); out.push(`<${t} class="sl-list">`); list = t; } out.push(`<li>${(b || n)[1]}</li>`); }
      else { close(); if (h) out.push(`<h4>${h[1]}</h4>`); else if (l.trim()) out.push(`<p>${l}</p>`); }
    });
    close();
    return out.join("").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }

  // ———————————————————————————————— UI
  const css = `
.sl-fab { position: fixed; z-index: 950; right: max(20px, env(safe-area-inset-right)); bottom: calc(20px + env(safe-area-inset-bottom));
  display: inline-flex; align-items: center; gap: 9px; height: 48px; padding: 0 20px 0 16px; border-radius: 999px; cursor: pointer;
  font: 600 13.5px/1 var(--text, system-ui); letter-spacing: .01em; color: var(--gold-hi, #e2c88f);
  background: linear-gradient(180deg, rgba(197,160,89,.22), rgba(197,160,89,.08)), rgba(18,18,20,.62);
  border: 1px solid rgba(197,160,89,.45); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 0 1px 0 rgba(255,255,255,.08) inset, 0 18px 40px -14px rgba(0,0,0,.95), 0 0 24px -6px rgba(197,160,89,.45);
  transition: transform .35s var(--ease-out, ease), opacity .3s, box-shadow .3s; }
.sl-fab:hover { transform: translateY(-2px); box-shadow: 0 1px 0 rgba(255,255,255,.1) inset, 0 22px 44px -14px rgba(0,0,0,.95), 0 0 32px -4px rgba(197,160,89,.6); }
.sl-fab:active { transform: scale(.96); }
.sl-fab svg { width: 18px; height: 18px; }
.sl-fab.hide { opacity: 0; pointer-events: none; transform: translateY(12px) scale(.94); }
.sl-panel { position: fixed; z-index: 1002; top: 12px; right: 12px; bottom: 12px; width: min(460px, calc(100vw - 24px));
  display: flex; flex-direction: column; border-radius: 24px; overflow: hidden; color: var(--ink, #f5f5f7);
  background: rgba(14,14,16,.82); border: 1px solid rgba(197,160,89,.22);
  backdrop-filter: blur(40px) saturate(180%); -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow: 0 40px 100px -20px #000, 0 0 0 .5px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.06) inset;
  transform: translateX(calc(100% + 24px)); visibility: hidden; transition: transform .55s var(--ease, ease), visibility 0s linear .55s; }
.sl-panel.open { transform: none; visibility: visible; transition: transform .55s var(--ease, ease), visibility 0s; }
.sl-head { display: flex; align-items: center; gap: 12px; padding: 14px 14px 12px 18px; border-bottom: 1px solid var(--hair, rgba(255,255,255,.08)); flex: none; }
.sl-orb { width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #0b0904;
  background: radial-gradient(circle at 35% 30%, #f3e2b8, #c5a059 55%, #8c6f35); box-shadow: 0 0 18px -2px rgba(197,160,89,.6); }
.sl-orb svg { width: 15px; height: 15px; }
.sl-title { flex: 1; min-width: 0; }
.sl-title b { display: block; font: 500 18px/1.1 var(--serif, Georgia, serif); }
.sl-title small { color: var(--muted, #8e8e93); font-size: 11.5px; }
.sl-ico { width: 30px; height: 30px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; flex: none;
  background: rgba(118,118,128,.22); color: var(--ink-2, #d2d2d7); transition: background .2s; }
.sl-ico:hover { background: rgba(118,118,128,.36); }
.sl-ico svg { width: 13px; height: 13px; }
.sl-cfg { padding: 14px 18px; border-bottom: 1px solid var(--hair, rgba(255,255,255,.08)); display: grid; gap: 8px; font-size: 12px; color: var(--muted, #8e8e93); flex: none; }
.sl-cfg label { display: grid; gap: 4px; }
.sl-cfg input, .sl-cfg select { font: 13px var(--text, system-ui); color: var(--ink, #fff); background: rgba(255,255,255,.05); border: 1px solid var(--hair-2, rgba(255,255,255,.14)); border-radius: 10px; padding: 8px 10px; }
.sl-cfg .row { display: flex; gap: 8px; } .sl-cfg .row > * { flex: 1; }
.sl-log { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 18px; display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.sl-msg { max-width: 100%; font-size: 13.5px; line-height: 1.5; animation: sl-in .45s var(--ease-out, ease) both; }
.sl-msg.user { align-self: flex-end; max-width: 85%; background: rgba(197,160,89,.16); border: 1px solid rgba(197,160,89,.3); padding: 9px 13px; border-radius: 16px 16px 4px 16px; }
.sl-msg.ai { padding-left: 14px; border-left: 1px solid rgba(197,160,89,.35); }
.sl-msg.ai h4 { margin: 14px 0 6px; font: 600 11px/1.2 var(--text, system-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--gold, #c5a059); }
.sl-msg p { margin: 0 0 8px; }
.sl-lead { color: var(--ink-2, #d2d2d7); }
.sl-sub, .sl-mute { color: var(--muted, #8e8e93); font-size: 12px; }
.sl-warn { color: var(--warn, #f2a65e); }
.sl-rec { background: rgba(197,160,89,.08); border: 1px solid rgba(197,160,89,.2); border-radius: 12px; padding: 10px 12px; margin-top: 10px !important; }
.sl-card { background: rgba(255,255,255,.035); border: 1px solid var(--hair, rgba(255,255,255,.08)); border-radius: 14px; padding: 12px 13px; margin-bottom: 8px; }
.sl-card-h { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.sl-rank { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600; background: rgba(197,160,89,.2); color: var(--gold-hi, #e2c88f); }
.sl-idx { margin-left: auto; font: 600 15px var(--sans, system-ui); color: var(--gold-hi, #e2c88f); font-variant-numeric: tabular-nums; }
.sl-bar { height: 3px; border-radius: 2px; background: rgba(255,255,255,.06); margin: 8px 0; overflow: hidden; }
.sl-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--gold-deep, #8c6f35), var(--gold-hi, #e2c88f)); }
.sl-kv { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--ink-2, #d2d2d7); margin-bottom: 4px; }
.sl-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
.sl-stats div { background: rgba(255,255,255,.04); border: 1px solid var(--hair, rgba(255,255,255,.08)); border-radius: 12px; padding: 8px 10px; }
.sl-stats span { display: block; font-size: 10.5px; color: var(--muted, #8e8e93); text-transform: uppercase; letter-spacing: .08em; }
.sl-stats b { font: 600 18px var(--sans, system-ui); color: var(--gold-hi, #e2c88f); }
.sl-list { margin: 4px 0 8px; padding-left: 20px; display: grid; gap: 6px; }
.sl-list li::marker { color: var(--faint, #5a5a5f); font-size: 11px; }
.sl-store { all: unset; cursor: pointer; color: var(--gold-hi, #e2c88f); font-weight: 500; }
.sl-store:hover { text-decoration: underline; text-underline-offset: 3px; }
.sl-store:focus-visible { outline: 2px solid var(--gold, #c5a059); border-radius: 4px; }
.sl-score { font-size: 11px; color: var(--gold, #c5a059); font-variant-numeric: tabular-nums; margin-left: 4px; }
.sl-tag { font-size: 11px; color: var(--ink-2, #d2d2d7); background: rgba(255,255,255,.06); border-radius: 999px; padding: 2px 8px; margin-left: 4px; white-space: nowrap; }
.sl-tag.bad { color: var(--bad, #ff6b6b); background: rgba(255,107,107,.1); }
.sl-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sl-btn { font: 500 12px var(--text, system-ui); color: var(--ink, #fff); background: rgba(255,255,255,.06); border: 1px solid var(--hair-2, rgba(255,255,255,.14)); border-radius: 999px; padding: 8px 14px; cursor: pointer; }
.sl-btn:hover { background: rgba(255,255,255,.1); }
.sl-btn.gold { background: var(--gold, #c5a059); color: #0b0904; border-color: transparent; font-weight: 600; }
.sl-typing { display: inline-flex; gap: 4px; padding: 6px 0; }
.sl-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--gold, #c5a059); animation: sl-dot 1.2s infinite ease-in-out; }
.sl-typing i:nth-child(2) { animation-delay: .15s; } .sl-typing i:nth-child(3) { animation-delay: .3s; }
.sl-foot { flex: none; padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--hair, rgba(255,255,255,.08)); }
.sl-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, #000 90%, transparent); mask-image: linear-gradient(90deg, #000 90%, transparent); }
.sl-chips::-webkit-scrollbar { display: none; }
.sl-chip { flex: none; font: 500 12px/1 var(--text, system-ui); color: var(--ink-2, #d2d2d7); background: rgba(255,255,255,.05); border: 1px solid rgba(197,160,89,.28);
  border-radius: 999px; padding: 8px 12px; cursor: pointer; transition: background .2s, border-color .2s, color .2s; }
.sl-chip:hover { background: rgba(197,160,89,.14); border-color: rgba(197,160,89,.55); color: var(--gold-hi, #e2c88f); }
.sl-form { display: flex; align-items: flex-end; gap: 8px; background: rgba(255,255,255,.05); border: 1px solid var(--hair-2, rgba(255,255,255,.14)); border-radius: 18px; padding: 6px 6px 6px 14px; transition: border-color .2s; }
.sl-form:focus-within { border-color: rgba(197,160,89,.5); }
.sl-form textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: var(--ink, #fff); font: 14px/1.4 var(--text, system-ui); padding: 7px 0; max-height: 120px; min-height: 22px; }
.sl-form textarea::placeholder { color: var(--faint, #5a5a5f); }
.sl-send { width: 34px; height: 34px; border-radius: 50%; border: 0; flex: none; cursor: pointer; display: grid; place-items: center; background: var(--gold, #c5a059); color: #0b0904; transition: opacity .2s, transform .15s; }
.sl-send:disabled { opacity: .35; cursor: default; }
.sl-send:not(:disabled):active { transform: scale(.92); }
.sl-send svg { width: 15px; height: 15px; }
.sl-mode { font-size: 10.5px; color: var(--faint, #5a5a5f); margin-top: 8px; text-align: center; letter-spacing: .02em; }
.sl-nav { display: inline-flex; }
@keyframes sl-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes sl-dot { 0%, 80%, 100% { opacity: .25; transform: scale(.8); } 40% { opacity: 1; transform: none; } }
@media (max-width: 700px) {
  .sl-nav { display: none; }
  .sl-fab { height: 50px; padding: 0 18px 0 14px; }
  .sl-panel { top: auto; left: 0; right: 0; bottom: 0; width: 100%; height: min(88dvh, 88vh); border-radius: 24px 24px 0 0; border-bottom: 0;
    transform: translateY(100%); }
  .sl-panel.open { transform: none; }
}
.sl-fab[data-alerts]:not([data-alerts=""])::after, .sl-nav[data-alerts]:not([data-alerts=""])::after { content: attr(data-alerts); position: absolute; top: -5px; right: -5px;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: grid; place-items: center; font: 700 10.5px/1 var(--text, system-ui);
  color: #fff; background: #ff453a; box-shadow: 0 0 0 2px #000, 0 4px 12px rgba(255,69,58,.5); animation: sl-badge .5s cubic-bezier(.34,1.56,.64,1); }
.sl-nav { position: relative; }
@keyframes sl-badge { from { transform: scale(0); } }
.sl-alerts { display: grid; gap: 6px; padding: 10px 14px 0; }
.sl-alert { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 8px auto 1fr; align-items: center; gap: 4px 10px; padding: 10px 12px;
  border-radius: 12px; font-size: 12.5px; background: rgba(242,166,94,.08); box-shadow: inset 0 0 0 1px rgba(242,166,94,.28); transition: transform .15s, background .2s; }
.sl-alert.bad { background: rgba(255,107,107,.08); box-shadow: inset 0 0 0 1px rgba(255,107,107,.3); }
.sl-alert:active { transform: scale(.98); }
.sl-alert:focus-visible { outline: 2px solid #c5a059; }
.sl-alert i { width: 8px; height: 8px; border-radius: 50%; background: #f2a65e; box-shadow: 0 0 8px #f2a65e; }
.sl-alert.bad i { background: #ff6b6b; box-shadow: 0 0 8px #ff6b6b; }
.sl-alert b { font-weight: 600; color: #f5f5f7; white-space: nowrap; }
.sl-alert span { color: #8e8e93; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
@media (prefers-reduced-motion: reduce) { .sl-panel, .sl-fab, .sl-msg { transition: none !important; animation: none !important; } }`;

  const SPARK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.95 2.55L22.5 16.5l-2.55.95L19 20l-.95-2.55L15.5 16.5l2.55-.95L19 13z"/></svg>`;
  const X = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;
  const GEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  const SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
  const TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`;

  function mount() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement("button");
    fab.className = "sl-fab";
    fab.setAttribute("aria-label", "Open Sillage AI");
    fab.setAttribute("aria-expanded", "false");
    fab.innerHTML = `${SPARK}<span>Sillage AI</span>`;
    document.body.appendChild(fab);

    const nav = document.querySelector(".nav-actions");
    let navBtn = null;
    if (nav) {
      navBtn = document.createElement("button");
      navBtn.className = "btn sl-nav";
      navBtn.innerHTML = `<span style="color:var(--gold-hi);display:inline-flex;width:14px">${SPARK}</span>Sillage AI`;
      nav.prepend(navBtn);
    }

    const panel = document.createElement("aside");
    panel.className = "sl-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Sillage AI assistant");
    panel.innerHTML = `
      <header class="sl-head"><div class="sl-orb">${SPARK}</div><div class="sl-title"><b>Sillage AI</b><small>Retail intelligence · live on your pipeline</small></div>
        <button class="sl-ico" data-act="clear" title="Clear conversation" aria-label="Clear conversation">${TRASH}</button>
        <button class="sl-ico" data-act="cfg" title="AI engine settings" aria-label="AI engine settings" aria-expanded="false">${GEAR}</button>
        <button class="sl-ico" data-act="close" title="Close (Esc)" aria-label="Close">${X}</button></header>
      <form class="sl-cfg" hidden>
        <div class="row"><label>Engine<select name="provider"><option value="builtin">Built-in analytics</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
          <label>Model<input name="model" placeholder="default" autocomplete="off"></label></div>
        <label>API key<input name="key" type="password" placeholder="Stored in this browser only" autocomplete="off"></label>
        <span>The key never leaves this browser except to the chosen provider. The quick analyses always run locally.</span>
      </form>
      <div class="sl-log" aria-live="polite"></div>
      <footer class="sl-foot">
        <div class="sl-chips">${CHIPS.map(c => `<button class="sl-chip" data-chip="${c.id}">${esc(c.label)}</button>`).join("")}</div>
        <form class="sl-form"><textarea rows="1" placeholder="Ask about cities, doors, pipeline, territories…" aria-label="Message Sillage AI"></textarea><button class="sl-send" type="submit" aria-label="Send" disabled>${SEND}</button></form>
        <div class="sl-mode"></div>
      </footer>`;
    document.body.appendChild(panel);

    const $ = s => panel.querySelector(s);
    const log = $(".sl-log"), ta = $("textarea"), send = $(".sl-send"), cfgForm = $(".sl-cfg");
    let history = store.get(CHAT_KEY, []), busy = false;

    const engine = () => cfg.provider !== "builtin" && cfg.key ? cfg.provider : "builtin";
    const modeLine = () => { $(".sl-mode").textContent = engine() === "builtin" ? "Built-in analytics · deterministic, runs offline" : `${engine() === "anthropic" ? "Anthropic" : "OpenAI"} · ${cfg.model || DEFAULT_MODEL[engine()]} · grounded on your CRM data`; };
    const save = () => store.set(CHAT_KEY, history.slice(-40));
    function add(role, html, text) {
      const el = document.createElement("div");
      el.className = "sl-msg " + (role === "user" ? "user" : "ai");
      el.innerHTML = html;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      history.push({ role, html, text: text ?? el.textContent });
      save();
      return el;
    }
    // Proactive notifications: restock warnings and due outreach steps, counted on the launcher
    const bell = document.createElement("div");
    bell.className = "sl-alerts";
    log.before(bell);
    function refreshAlerts() {
      const a = ctx.alerts(), n = a.restock.length + a.steps.length;
      [fab, navBtn].forEach(b => { if (!b) return; b.dataset.alerts = n || ""; b.setAttribute("aria-label", `Open Sillage AI${n ? ` · ${n} alert${n > 1 ? "s" : ""}` : ""}`); });
      const crit = a.restock.filter(r => r._rs.tone === "bad").length;
      bell.innerHTML = n ? `${a.restock.length ? `<button class="sl-alert ${crit ? "bad" : "warn"}" data-alert="restock"><i></i><b>${a.restock.length} restock alert${a.restock.length > 1 ? "s" : ""}</b><span>${a.restock.slice(0, 3).map(r => esc(r.name)).join(" · ")}${a.restock.length > 3 ? "…" : ""}</span></button>` : ""}${
        a.steps.length ? `<button class="sl-alert warn" data-alert="outreach"><i></i><b>${a.steps.length} outreach step${a.steps.length > 1 ? "s" : ""} due</b><span>${a.steps.slice(0, 3).map(x => esc(x.r.name)).join(" · ")}</span></button>` : ""}` : "";
      bell.hidden = !n;
    }
    refreshAlerts();
    document.addEventListener("sillage:alerts", refreshAlerts);
    function welcome() {
      const o = overview();
      return `<p><span class="serif" style="font-size:17px">Bonjour.</span></p><p class="sl-lead">I read ${o.stores} doors across ${Object.keys(o.countries).length} markets, ${o.partners.length} partner accounts and a ${o.exclusivity_radius_km.toFixed(1)} km exclusivity radius — live from this CRM, priced in ${esc(o.currency.display)}. Pick an analysis below or ask anything.</p>`;
    }
    function render() {
      log.innerHTML = "";
      if (!history.length) add("assistant", welcome());
      else history.forEach(m => { const el = document.createElement("div"); el.className = "sl-msg " + (m.role === "user" ? "user" : "ai"); el.style.animation = "none"; el.innerHTML = m.html; log.appendChild(el); });
      log.scrollTop = log.scrollHeight;
    }

    async function ask(q, chipId) {
      if (busy || !q.trim()) return;
      busy = true; send.disabled = true;
      const prior = history.filter(m => m.text).slice(-8);
      add("user", esc(q), q);
      const typing = document.createElement("div");
      typing.className = "sl-msg ai";
      typing.innerHTML = `<span class="sl-typing"><i></i><i></i><i></i></span>`;
      log.appendChild(typing);
      log.scrollTop = log.scrollHeight;
      await new Promise(r => setTimeout(r, 380));   // let the indicator register before heavy synchronous work
      let html;
      try {
        if (chipId) html = ANALYSES[chipId]().html;
        else if (engine() !== "builtin") html = md(await llm(prior, q));
        else html = localAnswer(q);
      } catch (e) {
        html = `<p class="sl-warn">Provider error: ${esc(e.message)}</p>` + localAnswer(q);
      }
      typing.remove();
      add("assistant", html);
      busy = false; send.disabled = !ta.value.trim();
    }

    let lastFocus = null;
    function open() {
      lastFocus = document.activeElement;
      panel.classList.add("open"); fab.classList.add("hide"); fab.setAttribute("aria-expanded", "true");
      modeLine();
      if (!log.childElementCount) render();
      setTimeout(() => ta.focus({ preventScroll: true }), 350);
    }
    function close() {
      panel.classList.remove("open"); fab.classList.remove("hide"); fab.setAttribute("aria-expanded", "false");
      lastFocus?.focus?.({ preventScroll: true });
    }
    const toggle = () => panel.classList.contains("open") ? close() : open();
    fab.addEventListener("click", open);
    navBtn?.addEventListener("click", toggle);
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "Escape" && panel.classList.contains("open")) close();
    });

    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; send.disabled = busy || !ta.value.trim(); });
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $(".sl-form").requestSubmit(); } });
    $(".sl-form").addEventListener("submit", e => { e.preventDefault(); const q = ta.value; ta.value = ""; ta.style.height = "auto"; ask(q); });
    $(".sl-chips").addEventListener("click", e => { const c = e.target.closest("[data-chip]"); if (c) ask(CHIPS.find(x => x.id === c.dataset.chip).label, c.dataset.chip); });

    panel.addEventListener("click", e => {
      const seq = e.target.closest("[data-seq]");
      if (seq) { ctx.openPitch(+seq.dataset.seq, "seq"); return; }
      const al = e.target.closest("[data-alert]");
      if (al) { ask(CHIPS.find(x => x.id === al.dataset.alert).label, al.dataset.alert); return; }
      const s = e.target.closest(".sl-store");
      if (s) { ctx.focus(+s.dataset.id); if (matchMedia("(max-width: 700px)").matches) close(); return; }
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") close();
      else if (act === "clear") { history = []; save(); render(); }
      else if (act === "cfg") { cfgForm.hidden = !cfgForm.hidden; e.target.closest("[data-act]").setAttribute("aria-expanded", !cfgForm.hidden); }
      else if (act === "dispatch-csv") {
        const cols = ["name", "type", "segment", "full_address", "city", "country", "brand_alignment_score", "tier_score", "single_sku_openness", "decision_maker_role"];
        const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csv = [["#", ...cols, "score"].join(","), ...lastDispatch.map((r, i) => [i + 1, ...cols.map(c => q(r[c])), score(r)].join(","))].join("\n");
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: "discovery-dispatch.csv" });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } else if (act === "dispatch-mark") {
        const ids = lastDispatch.filter(r => r.pipeline_status === "Not Contacted").map(r => r.id);
        if (!ids.length || !confirm(`Move ${ids.length} stores to "Discovery Set Sent"? The stagnation audit will start their 14-day clock today.`)) return;
        ctx.setStatus(ids, "Discovery Set Sent");
        ctx.toast(`${ids.length} stores → Discovery Set Sent`);
        e.target.disabled = true;
      }
    });

    const f = cfgForm.elements;
    f.provider.value = cfg.provider;
    f.key.value = cfg.key; f.model.value = cfg.model;
    cfgForm.addEventListener("input", () => {
      cfg = { provider: f.provider.value, key: f.key.value.trim(), model: f.model.value.trim() };
      f.model.placeholder = DEFAULT_MODEL[cfg.provider] || "–";
      store.set(CFG_KEY, cfg); modeLine();
    });
    cfgForm.addEventListener("submit", e => e.preventDefault());
    f.model.placeholder = DEFAULT_MODEL[f.provider.value] || "–";
  }

  ctxReady.then(mount);
})();
