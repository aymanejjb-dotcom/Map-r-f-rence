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
    { id: "pulse", label: "Dynamic Market Pulse" },
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
  function baseScore(r) {
    const cx = r.customer_experience_rating == null ? 0 : (r.customer_experience_rating - 4.2) * 12;
    const s = .45 * r.brand_alignment_score + .22 * r.tier_score + 22 * OPEN_W[r.single_sku_openness] + cx
      + (r.launch_priority.startsWith("Tier 1") ? 8 : 0) + (r.openness_verified ? 3 : 0) - (BARRIER[r.entry_barrier] || 0);
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  // Market pulse (intelligence.js): regional purchasing shifts + the seasonal buying window ahead, ±12 points.
  // Recomputed per calendar day, so priorities move with the retail calendar without a rebuild.
  const pulseMemo = new Map();
  let pulseDay = null;
  function pulseOf(r) {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== pulseDay) { pulseMemo.clear(); pulseDay = day; }
    if (!pulseMemo.has(r.id)) pulseMemo.set(r.id, window.SillageIntel.pulse(r, day));
    return pulseMemo.get(r.id);
  }
  const score = r => Math.max(0, Math.min(100, baseScore(r) + pulseOf(r).delta));
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
      `<p class="sl-rec"><b>Recommendation.</b> Open ${esc(rows[0]?.city || "–")} first with its top two doors as an exclusive pair, then roll into ${rows.slice(1, 3).map(g => esc(g.city)).join(L(" et ", " and "))} once the first reorder lands — this keeps samples concentrated where word-of-mouth compounds.</p>`;
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
      ${(p => `<p class="sl-sub">Market pulse ${signed(p.delta)} (base ${baseScore(r)}): ${p.drivers.map(d => `${esc(d.label)} ${signed(d.pts)}`).join(" · ") || "neutral"}</p>`)(pulseOf(r))}
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

  // Dynamic market pulse: which regions and doors the calendar and purchasing shifts favour right now
  const signed = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function marketPulse() {
    const I = window.SillageIntel, mi = new Date().getMonth();
    const pros = ctx.data.filter(r => isOpen(r) && !zoneOf(r)).map(r => ({ r, b: baseScore(r), p: pulseOf(r), s: score(r) }));
    const regions = Object.entries(I.REGION).map(([cc, [pts, note]]) => {
      const rows = pros.filter(x => x.r.country === cc);
      return { cc, pts, note, n: rows.length, avg: rows.length ? avg(rows, x => x.p.delta) : 0 };
    }).filter(x => x.n).sort((a, b) => b.avg - a.avg);
    const risers = [...pros].sort((a, b) => b.p.delta - a.p.delta || b.s - a.s).slice(0, 6);
    const fallers = [...pros].filter(x => x.p.delta < 0).sort((a, b) => a.p.delta - b.p.delta || b.b - a.b).slice(0, 4);
    const top = [...pros].sort((a, b) => b.s - a.s).slice(0, 8);
    const win = [1, 2, 3].map(k => MONTHS[(mi + k) % 12]).join(" · ");
    const curve = I.SEASON.map((v, i) => `<i style="height:${Math.round(v / 1.4 * 100)}%"${i === mi ? ' class="on"' : [1, 2, 3].includes((i - mi + 12) % 12) ? ' class="win"' : ""} title="${MONTHS[i]} ${v.toFixed(2)}"></i>`).join("");
    const html = `<p class="sl-lead">Prioritisation scores now carry a <b>market pulse</b> of ±12 points: regional purchasing shifts, segment momentum and the seasonal buying window ahead (<b>${win}</b>). Retailers order 1–3 months before sell-out, so the window, not today, sets urgency.</p>
      <div class="sl-season" aria-label="Retail sell-in seasonality">${curve}</div>
      <div class="sl-card"><div class="sl-card-h"><b>Regional momentum</b><span class="sl-mute">avg pulse on winnable doors</span></div>
        <ol class="sl-list">${regions.map(g => `<li><b>${esc(g.cc)}</b> <span class="sl-score">${signed(Math.round(g.avg))}</span><div class="sl-mute">${esc(g.note)} · ${g.n} doors</div></li>`).join("")}</ol></div>
      <div class="sl-card"><div class="sl-card-h"><b>Rising now</b></div><ol class="sl-list">${risers.map(x => `<li>${storeLink(x.r)} <span class="sl-score">${x.b} → ${x.s}</span><div class="sl-mute">${esc(x.r.city)} · ${x.p.drivers.slice(0, 2).map(d => `${esc(d.label)} ${signed(d.pts)}`).join(" · ")}</div></li>`).join("")}</ol></div>
      ${fallers.length ? `<div class="sl-card"><div class="sl-card-h"><b>Cooling</b></div><ol class="sl-list">${fallers.map(x => `<li>${storeLink(x.r)} <span class="sl-score">${x.b} → ${x.s}</span><div class="sl-mute">${esc(x.r.city)} · ${x.p.drivers.filter(d => d.pts < 0).map(d => `${esc(d.label)} ${signed(d.pts)}`).join(" · ")}</div></li>`).join("")}</ol></div>` : ""}
      <p class="sl-rec"><b>Pulse-adjusted top 8:</b> ${top.map(x => `${storeLink(x.r)} (${x.s})`).join(", ")}.</p>
      <p class="sl-sub">Indices are editorial 2026 estimates (see intelligence.js · REGION, SEASON, RESORTS); they reorder doors, they do not size markets.</p>`;
    return { html, summary: { buying_window: win, regions: regions.map(g => ({ country: g.cc, shift_pts: g.pts, avg_pulse: +g.avg.toFixed(1), note: g.note })),
      rising: risers.map(x => ({ store: x.r.name, city: x.r.city, base: x.b, pulse: x.p.delta, score: x.s, drivers: x.p.drivers })),
      cooling: fallers.map(x => ({ store: x.r.name, city: x.r.city, base: x.b, pulse: x.p.delta })) } };
  }

  const ANALYSES = { growth: growthCities, dispatch, stagnation, exclusivity, export: exportStrategy, restock: restockForecast, outreach: outreachDue, potential: potentialLeaders, pulse: marketPulse };
  function route(q) {
    const t = q.toLowerCase();
    if (/pulse|season|saison|trend|tendance|regional|régional|shift|momentum|calendar|calendrier/.test(t)) return "pulse";
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
  // ———————————————————————————————— Dynamic query engine (built-in, offline)
  // Parses the question into entities (stores, cities, countries, types, statuses, openness, N)
  // and intents (brief, compare, exclusivity, friction, ranking, count), then answers from live data.
  const tl = s => window.I18N ? window.I18N.t(s) : s;
  const FR = () => (window.I18N?.lang || "fr") === "fr";
  const L = (fr, en) => FR() ? fr : en;
  const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`´]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  const has = (t, w) => (" " + t + " ").includes(" " + w + " ");
  const GENERIC = new Set(["parfumerie", "parfumeries", "perfumery", "parfum", "parfums", "perfume", "store", "shop", "boutique", "the", "les", "des", "and", "concept", "maison", "house", "galeries", "grand", "magasin", "beauty", "cosmetics", "haute", "paris", "berlin", "london", "city", "le", "la", "de", "du", "et", "a", "au", "aux"]);
  const COUNTRY_WORDS = {
    FR: ["france", "french", "francais", "francaise", "fr"], BE: ["belgium", "belgique", "belgian", "belge", "be"], NL: ["netherlands", "pays bas", "holland", "hollande", "dutch", "nl", "neerlandais"],
    DE: ["germany", "allemagne", "german", "allemand", "allemande", "deutschland", "de"], LU: ["luxembourg", "lux", "lu"], CH: ["switzerland", "suisse", "swiss", "schweiz", "ch", "helvetique"],
  };
  const TYPE_WORDS = { "Niche Boutique": ["niche boutique", "niche boutiques", "boutique de niche", "boutiques de niche", "niche"], "Independent Concept Store": ["concept store", "concept stores", "concept"], "Department Store": ["department store", "department stores", "grand magasin", "grands magasins", "dept"] };
  const STATUS_WORDS = [
    ["Key Account", /\bkey accounts?\b|\bcomptes? cles?\b/], ["Partner Active", /\bpartners?\b|\bpartenaires?\b|\bactive accounts?\b/], ["Declined", /\bdeclin/],
    ["Meeting Booked", /\bmeetings?\b|\brendez vous\b|\brdv\b/], ["Follow-up Required", /\bfollow ?ups?\b|\brelances?\b/], ["Discovery Set Sent", /\bdiscovery sets? sent\b|\bcoffrets? envoyes?\b/],
    ["Not Contacted", /\bnot contacted\b|\buncontacted\b|\bnon contactes?\b|\bjamais contactes?\b/],
  ];
  const CITY_ALIAS = { bruxelles: "Brussels", brussel: "Brussels", anvers: "Antwerp", antwerpen: "Antwerp", gand: "Ghent", gent: "Ghent", louvain: "Leuven", liege: "Liège",
    geneve: "Geneva", genf: "Geneva", zurich: "Zürich", bale: "Basel", berne: "Bern", lucerne: "Luzern", munchen: "Munich", francfort: "Frankfurt am Main", frankfurt: "Frankfurt am Main",
    cologne: "Köln", hambourg: "Hamburg", dusseldorf: "Düsseldorf", "la haye": "The Hague", "den haag": "The Hague", "saint moritz": "St. Moritz", "st moritz": "St. Moritz", nuremberg: "Nürnberg", aix: "Aix-en-Provence" };
  const WORD_N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10 };

  // Staff / CX friction score, 0 (frictionless) – 100 (hard door): traits, staff & watch-out notes, rating, entry barrier
  const FRICTION_TRAIT = { "Pushes sales": 12, "Busy weekends": 6, "Tourist crowds": 8, "Expert staff": -7, "Luxury service": -3, "Allows free sniffing": -5, "Generous samples": -4,
    "Discovery bar / blotters": -3, "Appointment-friendly": -3, "Curated indie brands": -4, "Gift wrapping": -1 };
  const STAFF_NEG = [/snob/, /pushy|aggressive|hard.?sell/, /sales.?led|commercial/, /understaffed|long wait|queue/, /varies|mixed|inconsistent|depends/, /stiff|cold|reserved|formal/, /generalist|little niche/, /brand.?(employed|led|trained)|counters?/, /tourist/];
  const STAFF_POS = [/expert|knowledgeable|expertise/, /passionate|enthusiastic|loves/, /warm|friendly|welcoming|courteous|helpful/, /personal|attentive|patience|unhurried/, /owner.?(run|led)|founder/, /well.?trained|professional|polished|competent|excellent/];
  const frMemo = new Map();
  function friction(r) {
    if (frMemo.has(r.id)) return frMemo.get(r.id);
    const drivers = [];
    let f = 40;
    r.cx_traits.forEach(t => { const v = FRICTION_TRAIT[t]; if (v) { f += v; drivers.push([t, v]); } });
    const txt = fold(`${r.cx_insights?.staff || ""} ${r.cx_insights?.watch_out || ""}`);
    const neg = STAFF_NEG.filter(re => re.test(txt)).length, pos = STAFF_POS.filter(re => re.test(txt)).length;
    if (neg) { f += 4 * neg; drivers.push([L("signaux équipe négatifs", "negative staff signals") + ` ×${neg}`, 4 * neg]); }
    if (pos) { f -= 4 * pos; drivers.push([L("signaux équipe positifs", "positive staff signals") + ` ×${pos}`, -4 * pos]); }
    if (r.customer_experience_rating != null) { const v = Math.round((4.3 - r.customer_experience_rating) * 14); if (v) { f += v; drivers.push([L(`note CX ${r.customer_experience_rating}`, `CX rating ${r.customer_experience_rating}`), v]); } }
    const b = Math.round((BARRIER[r.entry_barrier] || 0) * 1.1);
    if (b) { f += b; drivers.push([L(`barrière d'entrée ${({ Low: "faible", Med: "moyenne", High: "élevée", "Very High": "très élevée" })[r.entry_barrier]}`, `entry barrier ${r.entry_barrier}`), b]); }
    const scoreF = Math.max(0, Math.min(100, Math.round(f)));
    const level = scoreF <= 30 ? L("faible", "low") : scoreF <= 55 ? L("modérée", "moderate") : L("élevée", "high");
    const out = { score: scoreF, level, tone: scoreF <= 30 ? "ok" : scoreF <= 55 ? "" : "warn", drivers: drivers.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) };
    frMemo.set(r.id, out);
    return out;
  }
  const frTag = r => { const f = friction(r); return `<span class="${f.tone === "warn" ? "sl-warn" : ""}">${L("friction", "friction")} ${f.score} (${f.level})</span>`; };

  function parse(q) {
    const t = fold(q);
    const ents = { t, stores: [], cities: [], countries: [], types: [], statuses: [], open: null, n: null };
    // N: "top 10", "10 meilleures", "five best"
    const mN = t.match(/\b(?:top|les|the|best|meilleur(?:e|s|es)?)\s+(\d{1,2})\b|\b(\d{1,2})\s+(?:best|meilleur|top|premi|doors|portes|stores|boutiques|adresses|points)/);
    if (mN) ents.n = +(mN[1] || mN[2]);
    else { const w = Object.keys(WORD_N).find(k => new RegExp(`\\b(top|the|les) ${k}\\b`).test(t)); if (w) ents.n = WORD_N[w]; }
    // Countries
    Object.entries(COUNTRY_WORDS).forEach(([cc, ws]) => {
      if (ws.some(w => w.length > 2 ? has(t, w) : new RegExp(`(^|\\s)${w}(\\s|$)`).test(q.toLowerCase().replace(/[^a-z ]/g, " ")) && q.includes(w.toUpperCase()))) ents.countries.push(cc);
    });
    // Cities (longest first, word-bounded)
    const cities = [...new Set(ctx.data.map(r => r.city))].sort((a, b) => b.length - a.length);
    let rest = " " + t + " ";
    for (const c of cities) { const fc = fold(c); if (fc.length > 2 && rest.includes(" " + fc + " ")) { ents.cities.push(c); rest = rest.replace(" " + fc + " ", " "); } }
    const known = new Set(cities);
    Object.entries(CITY_ALIAS).forEach(([al, c]) => { if (known.has(c) && !ents.cities.includes(c) && rest.includes(" " + al + " ")) { ents.cities.push(c); rest = rest.replace(" " + al + " ", " "); } });
    // Stores: full normalised name, else all distinctive tokens of the name
    const scored = [];
    ctx.data.forEach(r => {
      const fn = fold(r.name);
      if (fn.length >= 4 && (" " + t + " ").includes(" " + fn + " ")) { scored.push([r, 100 + fn.length]); return; }
      const toks = fn.split(" ").filter(w => w.length >= 4 && !GENERIC.has(w) && !ents.cities.some(c => fold(c) === w));
      if (toks.length && toks.every(w => has(t, w))) scored.push([r, toks.join("").length]);
    });
    if (scored.length) {
      const best = Math.max(...scored.map(x => x[1]));
      let hits = scored.filter(x => x[1] >= Math.min(best, 100) * (best >= 100 ? 1 : .8)).map(x => x[0]);
      if (ents.cities.length) { const inCity = hits.filter(r => ents.cities.includes(r.city)); if (inCity.length) hits = inCity; }
      ents.stores = hits.slice(0, 6);
    }
    Object.entries(TYPE_WORDS).forEach(([ty, ws]) => { if (ws.some(w => has(t, w))) ents.types.push(ty); });
    if (ents.types.includes("Niche Boutique") && ents.types.length > 1 && !/\bniche boutique|boutique de niche/.test(t)) ents.types = ents.types.filter(x => x !== "Niche Boutique");
    STATUS_WORDS.forEach(([s, re]) => { if (re.test(t)) ents.statuses.push(s); });
    if (/\b(high|forte?|haute|tres) (openness|ouverture)|\bopen to (a )?single|\bouverte?s? (au|a la) mono|\bhigh openness/.test(t)) ents.open = "High";
    // Intents
    ents.intent = {
      friction: /friction|staff|personnel|equipe|vendeu|accueil|welcome|service|cx\b|customer experience|experience client|snob|pushy|difficile|hard door|easy door|facile/.test(t),
      exclusivity: /exclusi|territor|zone|rayon|radius|conflict|conflit|cannibal|overlap|chevauch|protect/.test(t),
      compare: /\bvs\b|versus|compar|\bor\b|\bou\b|difference|better|mieux/.test(t) && ents.stores.length >= 2,
      count: /how many|combien|nombre de|number of|count/.test(t),
      worst: /worst|pire|lowest|plus faible|moins bon|weakest|least|hardest|plus difficile|highest friction|plus de friction/.test(t),
      easiest: /easiest|plus facile|lowest friction|moins de friction|smoothest|accueillant/.test(t),
      rank: /best|top|meilleur|priorit|where|ou lancer|recommend|recommand|which|quel|quelle|quels|quelles|list|liste|show|montre|affiche/.test(t),
    };
    return ents;
  }

  function filterBy(e) {
    return ctx.data.filter(r => (!e.cities.length || e.cities.includes(r.city)) && (!e.countries.length || e.countries.includes(r.country))
      && (!e.types.length || e.types.includes(r.type)) && (!e.statuses.length || e.statuses.includes(r.pipeline_status)) && (!e.open || r.single_sku_openness === e.open));
  }
  const scopeLabel = e => {
    const bits = [];
    if (e.cities.length) bits.push(e.cities.join(", "));
    if (e.countries.length) bits.push(e.countries.join(", "));
    if (e.types.length) bits.push(e.types.map(ty => L(({ "Niche Boutique": "boutiques de niche", "Independent Concept Store": "concept stores", "Department Store": "grands magasins" })[ty], ty)).join(", "));
    if (e.statuses.length) bits.push(e.statuses.join(", "));
    if (e.open) bits.push(L("forte ouverture", "high openness"));
    return bits.join(" · ") || L("tout le réseau", "the whole directory");
  };
  const metaL = r => `${esc(r.city)} · ${esc(r.country)} · ${L("affinité", "fit")} ${r.brand_alignment_score} · ${L("niveau", "tier")} ${r.tier_score} · ${L("ouverture", "SKU")} ${esc(L(tl(r.single_sku_openness).toLowerCase(), r.single_sku_openness))}`;

  // Territorial exclusivity around one door: inside a partner zone? what would an exclusive radius here block?
  function exclusivityFor(r) {
    const R = ctx.zoneKm, z = zoneOf(r), near = ctx.data.filter(p => p.id !== r.id).map(p => ({ p, d: km(r, p) })).filter(x => x.d <= R).sort((a, b) => a.d - b.d);
    const partners = near.filter(x => isProtected(x.p)), blocked = near.filter(x => isOpen(x.p));
    const t1 = blocked.filter(x => x.p.launch_priority.startsWith("Tier 1")), lost = blocked.reduce((s, x) => s + score(x.p), 0);
    const ownScore = score(r);
    let verdict;
    if (isProtected(r)) verdict = L(`<b>Compte protégé.</b> ${esc(r.name)} détient déjà un territoire de ${R.toFixed(1)} km : ${blocked.length} porte${blocked.length > 1 ? "s" : ""} prospectable${blocked.length > 1 ? "s" : ""} y ${blocked.length > 1 ? "sont gelées" : "est gelée"}.`,
      `<b>Protected account.</b> ${esc(r.name)} already holds a ${R.toFixed(1)} km territory: ${blocked.length} prospectable door${blocked.length === 1 ? " is" : "s are"} frozen inside it.`);
    else if (z) verdict = L(`<b>Conflit.</b> ${esc(r.name)} se trouve dans le territoire de ${esc(z.p.name)} (${z.km.toFixed(1)} km) : pas de démarchage actif sans renégocier l'exclusivité ou réduire le rayon sous ${Math.max(.5, z.km - .1).toFixed(1)} km.`,
      `<b>Conflict.</b> ${esc(r.name)} sits inside ${esc(z.p.name)}'s territory (${z.km.toFixed(1)} km): no active pitch unless that exclusivity is renegotiated or the radius drops below ${Math.max(.5, z.km - .1).toFixed(1)} km.`);
    else if (!blocked.length) verdict = L(`<b>Exclusivité sans coût.</b> Aucune autre porte dans un rayon de ${R.toFixed(1)} km : ${esc(r.name)} peut recevoir un territoire exclusif sans rien geler.`,
      `<b>Free exclusivity.</b> No other door within ${R.toFixed(1)} km: ${esc(r.name)} can be granted an exclusive territory without freezing anything.`);
    else if (lost > ownScore * 1.5 || t1.length > 1) verdict = L(`<b>Exclusivité déconseillée.</b> Elle gèlerait ${blocked.length} portes (dont ${t1.length} niveau 1) pesant ${lost} points de score contre ${ownScore} pour ${esc(r.name)} : préférer un accord sélectif.`,
      `<b>Exclusivity not advised.</b> It would freeze ${blocked.length} doors (${t1.length} Tier 1) worth ${lost} score points against ${ownScore} for ${esc(r.name)}: offer a selective agreement instead.`);
    else verdict = L(`<b>Exclusivité défendable.</b> Elle gèlerait ${blocked.length} porte${blocked.length > 1 ? "s" : ""} (${lost} points) contre ${ownScore} pour ${esc(r.name)} — monnayez-la contre un engagement de volume.`,
      `<b>Exclusivity defensible.</b> It would freeze ${blocked.length} door${blocked.length > 1 ? "s" : ""} (${lost} points) against ${ownScore} for ${esc(r.name)} — trade it for a volume commitment.`);
    return `<div class="sl-card"><div class="sl-card-h"><b>${storeLink(r)}</b><span class="sl-idx">${ownScore}</span></div>
      <div class="sl-sub">${L("Exclusivité territoriale", "Territorial exclusivity")} · ${L("rayon", "radius")} ${R.toFixed(1)} km · ${esc(r.full_address)}</div>
      <p class="sl-sub">${verdict}</p>
      ${partners.length ? `<p class="sl-sub sl-warn">${L("Partenaires dans le rayon", "Partners within the radius")} : ${partners.map(x => `${storeLink(x.p)} ${x.d.toFixed(1)} km`).join(", ")}</p>` : ""}
      ${blocked.length ? `<p class="sl-sub">${L("Portes concernées", "Doors affected")} : ${blocked.slice(0, 6).map(x => `${storeLink(x.p)} <span class="sl-mute">${x.d.toFixed(1)} km · ${score(x.p)}</span>`).join(", ")}${blocked.length > 6 ? "…" : ""}</p>` : ""}</div>`;
  }

  function frictionCard(r) {
    const f = friction(r), ins = r.cx_insights || {};
    const drv = f.drivers.slice(0, 5).map(([k, v]) => `${esc(L(EXACT_FR[k] || k, k))} ${v > 0 ? "+" : "−"}${Math.abs(v)}`).join(" · ");
    const advice = f.score > 55
      ? L("Porte exigeante : passer par le décideur, rendez-vous hors week-end, kit testeur + formation équipe, jamais de démarchage en boutique aux heures de pointe.", "Hard door: go through the decision maker, book outside weekends, bring tester + staff training, never cold-pitch on the floor at peak hours.")
      : f.score > 30 ? L("Friction modérée : un brief équipe court et un coffret découverte réservé au personnel suffisent.", "Moderate friction: a short staff brief and a staff-only discovery set are enough.")
      : L("Équipe réceptive : visite directe possible, l'équipe peut porter le récit du parfum seule.", "Receptive team: walk-in pitch is fine, staff can carry the fragrance story on their own.");
    return `<div class="sl-card"><div class="sl-card-h"><b>${storeLink(r)}</b><span class="sl-idx ${f.tone === "warn" ? "sl-warn" : ""}">${f.score}</span></div>
      <div class="sl-sub">${L("Friction équipe / CX", "Staff / CX friction")} : <b>${f.level}</b> · ${metaL(r)}</div>
      ${ins.staff ? `<p class="sl-sub"><b>${L("Équipe", "Staff")}.</b> ${esc(ins.staff)}</p>` : ""}${ins.watch_out ? `<p class="sl-sub"><b>${L("Vigilance", "Watch out")}.</b> ${esc(ins.watch_out)}</p>` : ""}
      <p class="sl-sub sl-mute">${drv || L("aucun signal marqué", "no strong signal")}</p>
      <p class="sl-sub">${advice}</p></div>`;
  }
  const EXACT_FR = { "Pushes sales": "vente insistante", "Busy weekends": "week-ends chargés", "Tourist crowds": "affluence touristique", "Expert staff": "personnel expert", "Luxury service": "service luxe",
    "Allows free sniffing": "essais libres", "Generous samples": "échantillons généreux", "Discovery bar / blotters": "bar découverte", "Appointment-friendly": "sur rendez-vous", "Curated indie brands": "marques indépendantes", "Gift wrapping": "paquet cadeau" };

  function compareStores(rows) {
    const line = (lab, f) => `<tr><td class="sl-mute">${lab}</td>${rows.map(r => `<td>${f(r)}</td>`).join("")}</tr>`;
    const best = [...rows].sort((a, b) => (score(b) - friction(b).score / 4 - (zoneOf(b) ? 30 : 0)) - (score(a) - friction(a).score / 4 - (zoneOf(a) ? 30 : 0)))[0];
    return `<p class="sl-lead">${L("Comparaison", "Comparison")} · ${rows.length} ${L("portes", "doors")}</p>
      <div class="sl-card" style="overflow-x:auto"><table class="sl-t" style="width:100%;border-collapse:collapse;font-size:12px">
        <tr><td></td>${rows.map(r => `<td><b>${storeLink(r)}</b><div class="sl-mute">${esc(r.city)}</div></td>`).join("")}</tr>
        ${line(L("Score placement", "Placement score"), r => `<b>${score(r)}</b>`)}
        ${line(L("Affinité", "Fit"), r => r.brand_alignment_score)}${line(L("Niveau", "Tier"), r => r.tier_score)}
        ${line(L("Ouverture", "Openness"), r => esc(r.single_sku_openness))}${line("CX", r => r.customer_experience_rating ?? "–")}
        ${line(L("Friction", "Friction"), r => `${friction(r).score} (${friction(r).level})`)}
        ${line(L("Territoire", "Territory"), r => isProtected(r) ? L("protégé", "protected") : zoneOf(r) ? `<span class="sl-warn">${L("en zone", "in zone")}</span>` : L("libre", "clear"))}
        ${line(L("Statut", "Status"), r => esc(r.pipeline_status))}
        ${line(L("Potentiel export", "Export potential"), r => r.export_potential_score)}</table></div>
      <p class="sl-rec"><b>${L("Verdict.", "Verdict.")}</b> ${L(`Prioriser ${storeLink(best)} : meilleur équilibre score / friction / territoire.`, `Prioritise ${storeLink(best)}: best balance of score, friction and territory.`)}</p>`;
  }

  function rankList(e, rows) {
    const n = Math.min(e.n || 8, 25);
    let key = r => score(r), label = L("score de placement", "placement score"), val = r => score(r);
    if (e.intent.friction) {
      const asc = e.intent.easiest || !e.intent.worst;
      key = r => asc ? -friction(r).score : friction(r).score; val = r => friction(r).score; label = asc ? L("friction la plus faible", "lowest friction") : L("friction la plus forte", "highest friction");
    } else if (e.intent.worst) { key = r => -score(r); label = L("score le plus faible", "lowest score"); }
    const pool = e.statuses.length ? rows : rows.filter(r => r.pipeline_status !== "Declined");
    const top = [...pool].sort((a, b) => key(b) - key(a)).slice(0, n);
    const avgF = Math.round(avg(rows, r => friction(r).score));
    return `<p class="sl-lead"><b>${esc(scopeLabel(e))}</b> : ${rows.length} ${L("portes", "doors")} · ${rows.filter(isProtected).length} ${L("partenaires", "partners")} · ${rows.filter(r => r.single_sku_openness === "High").length} ${L("à forte ouverture", "high-openness")} · ${L("friction moy.", "avg friction")} ${avgF}. ${L("Classement", "Ranked by")} : <b>${label}</b>.</p>
      <ol class="sl-list">${top.map(r => `<li>${storeLink(r)} <span class="sl-score">${val(r)}</span><div class="sl-mute">${esc(r.pipeline_status)} · ${metaL(r)} · ${frTag(r)}${zoneOf(r) ? ` · <span class="sl-warn">${L("en zone", "in zone")} ${esc(zoneOf(r).p.name)}</span>` : ""}</div></li>`).join("")}</ol>
      ${top.length ? `<p class="sl-rec"><b>${L("Prochaine action.", "Next action.")}</b> ${L(`Ouvrir ${storeLink(top[0])} en premier${top[1] ? `, puis ${storeLink(top[1])}` : ""}.`, `Open ${storeLink(top[0])} first${top[1] ? `, then ${storeLink(top[1])}` : ""}.`)}</p>` : ""}`;
  }

  function territoryScope(e, rows) {
    const R = ctx.zoneKm, partners = rows.filter(isProtected), inZone = rows.filter(r => !isProtected(r) && zoneOf(r));
    const free = rows.filter(r => isOpen(r) && !zoneOf(r)).sort((a, b) => score(b) - score(a));
    // Best exclusive anchor: high own score, low score frozen around it
    const anchors = free.map(r => { const lost = ctx.data.filter(p => p.id !== r.id && isOpen(p) && km(r, p) <= R).reduce((s, p) => s + score(p), 0); return { r, lost, net: score(r) - lost / 2 }; })
      .sort((a, b) => b.net - a.net).slice(0, 4);
    return `<p class="sl-lead"><b>${esc(scopeLabel(e))}</b> · ${L("rayon", "radius")} ${R.toFixed(1)} km : ${partners.length} ${L("comptes protégés", "protected accounts")}, ${inZone.length} ${L("portes en zone", "doors inside a zone")}, ${free.length} ${L("portes libres", "free doors")}.</p>
      ${inZone.length ? `<div class="sl-card"><div class="sl-card-h"><b>${L("Portes gelées", "Frozen doors")}</b></div><ol class="sl-list">${inZone.slice(0, 6).map(r => `<li>${storeLink(r)}<div class="sl-mute">${L("zone de", "zone of")} ${esc(zoneOf(r).p.name)} · ${zoneOf(r).km.toFixed(1)} km · ${L("score", "score")} ${score(r)}</div></li>`).join("")}</ol></div>` : ""}
      ${anchors.length ? `<div class="sl-card"><div class="sl-card-h"><b>${L("Meilleurs ancrages exclusifs", "Best exclusive anchors")}</b><span class="sl-mute">${L("score − coût de gel", "score − freeze cost")}</span></div><ol class="sl-list">${anchors.map(a => `<li>${storeLink(a.r)} <span class="sl-score">${score(a.r)}</span><div class="sl-mute">${L("gèlerait", "would freeze")} ${a.lost} ${L("points autour", "points around it")} · ${frTag(a.r)}</div></li>`).join("")}</ol></div>` : ""}
      <p class="sl-rec"><b>${L("Recommandation.", "Recommendation.")}</b> ${anchors[0] ? L(`Proposer l'exclusivité à ${storeLink(anchors[0].r)} en priorité ; les autres en distribution sélective.`, `Offer exclusivity to ${storeLink(anchors[0].r)} first; keep the others selective.`) : L("Aucune porte libre : revoir le rayon ou les accords existants.", "No free door: revisit the radius or existing agreements.")}</p>`;
  }

  function countAnswer(e, rows) {
    const by = k => Object.entries(rows.reduce((a, r) => ((a[r[k]] = (a[r[k]] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${esc(k)} ${v}`).join(" · ");
    return `<p class="sl-lead"><b>${rows.length}</b> ${L("portes", "doors")} · ${esc(scopeLabel(e))}.</p>
      <p class="sl-sub">${L("Par statut", "By status")} : ${by("pipeline_status") || "–"}</p><p class="sl-sub">${L("Par type", "By type")} : ${by("type") || "–"}</p>
      <p class="sl-sub">${L("Par ville", "By city")} : ${by("city") || "–"}</p>`;
  }

  function localAnswer(q) {
    const e = parse(q), I = e.intent;
    // 1 · Named stores
    if (e.stores.length) {
      if (I.compare || (e.stores.length >= 2 && e.stores.length <= 4 && !I.exclusivity && !I.friction)) return compareStores(e.stores.slice(0, 4));
      return e.stores.slice(0, 3).map(r => I.exclusivity ? exclusivityFor(r) : I.friction ? frictionCard(r) : storeBrief(r) + exclusivityFor(r).replace('<div class="sl-card">', '<div class="sl-card sl-sub-card">') + frictionCard(r)).join("");
    }
    const scoped = e.cities.length || e.countries.length || e.types.length || e.statuses.length || e.open;
    const rows = filterBy(e);
    // 2 · Scoped questions (a city, a country, a type, a status…)
    if (scoped) {
      if (!rows.length) return `<p class="sl-lead">${L(`Aucune porte ne correspond à <b>${esc(scopeLabel(e))}</b>.`, `No door matches <b>${esc(scopeLabel(e))}</b>.`)}</p>`;
      if (I.count && !I.rank) return countAnswer(e, rows);
      if (I.exclusivity) return territoryScope(e, rows);
      return rankList(e, rows);
    }
    // 3 · Network-wide intents the analyses don't cover
    if (I.friction) return rankList(e, ctx.data);
    if (I.count) return countAnswer(e, ctx.data);
    // 4 · Packaged analyses
    const id = route(q);
    if (id) return ANALYSES[id]().html;
    if (I.rank) return rankList(e, ctx.data);
    // 5 · Free-text match on network, notes, sentiment
    const hits = ctx.data.filter(r => e.t.length > 3 && fold(`${r.network || ""} ${r.sentiment_summary} ${r.notes_prospections || ""} ${r.cx_traits.join(" ")}`).includes(e.t)).slice(0, 8);
    if (hits.length) return `<p class="sl-lead">${L(`${hits.length} porte${hits.length > 1 ? "s" : ""} mentionnent « ${esc(q)} » :`, `${hits.length} door${hits.length > 1 ? "s" : ""} mention “${esc(q)}”:`)}</p><ol class="sl-list">${hits.map(r => `<li>${storeLink(r)} <span class="sl-score">${score(r)}</span><div class="sl-mute">${metaL(r)}</div></li>`).join("")}</ol>`;
    const ex = ctx.data.filter(isOpen).sort((a, b) => score(b) - score(a))[0];
    return `<p class="sl-lead">${L(`Je n'ai pas identifié de boutique, de ville ou d'analyse dans « ${esc(q)} ».`, `I couldn't find a store, city or analysis in “${esc(q)}”.`)}</p>
      <p class="sl-sub">${L("Exemples", "Try")} : ${[
        L(`« ${ex ? esc(ex.name) : "Paris"} exclusivité »`, `“${ex ? esc(ex.name) : "Paris"} exclusivity”`),
        L("« friction équipe à Bruxelles »", "“staff friction in Brussels”"),
        L("« top 10 boutiques de niche en Suisse »", "“top 10 niche boutiques in Switzerland”"),
        L("« combien de partenaires en Allemagne »", "“how many partners in Germany”"),
        L("« compare A vs B »", "“compare A vs B”")].join(" · ")}</p>`;
  }

  // ———————————————————————————————— LLM (optional)
  let cfg = store.get(CFG_KEY, { provider: "builtin", key: "", model: "" });
  const DEFAULT_MODEL = { anthropic: "claude-opus-5-5", openai: "gpt-4.1" };
  const SYSTEM = `You are Sillage AI, the retail-intelligence assistant inside Maison Atlas, a private CRM used by a niche fragrance house to place a single SKU in independent perfumeries, concept stores and department stores across BE, NL, DE, FR, LU, CH.
Ground every claim in the JSON context you are given (store counts, clusters, tiers, openness, sentiment, pipeline, wholesale ledger, exclusivity radius, unit economics, currency). Never invent stores or figures; say when the data cannot answer.
All raw amounts in the context are EUR. The user is viewing figures in overview.currency.display: quote money in that currency (convert with fx_per_eur) and, for Swiss or other non-EU doors, also in the store's own price-list currency.
When you assess growth outside the EU (Switzerland today, the UK next), reason as an export strategist: the market's price list and corridor premium over spot FX, local VAT (CH 8.1 % vs FR 20 %) and the resulting shelf-price gap with neighbouring EU cities (cross-border shopping risk), MOQ against that market's minimum order and free-shipping threshold, customs clearance per shipment and how consolidating orders amortises it, duty and import-VAT rules, Incoterms (DAP vs DDP) and the need for an importer of record / UK Responsible Person, plus FX exposure on CHF or GBP invoicing.
Prospect scores already include a market pulse (base_score + market_pulse): regional purchasing shifts by country, segment momentum and the seasonal buying window 1–3 months ahead (Q4 gifting build, ski-resort winters, coastal summers). Name those drivers when they change a recommendation.
Answer like a luxury-retail strategist: a one-line verdict, then at most 6 tight bullets with numbers and named doors, then one concrete next action. Use **bold** sparingly. Reply in the user's language.`;

  function llmContext(q) {
    const id = route(q);
    const prospects = ctx.data.filter(isOpen).map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s).slice(0, 40)
      .map(({ r, s }) => ({ name: r.name, city: r.city, cc: r.country, type: r.type, segment: r.segment, status: r.pipeline_status, score: s,
        fit: r.brand_alignment_score, tier: r.tier_score, sku: r.single_sku_openness, cx: r.customer_experience_rating, sentiment: r.sentiment_summary, pitch: r.cx_insights?.pitch, friction: friction(r).score, staff: r.cx_insights?.staff, exclusivity_conflict: zoneOf(r) ? zoneOf(r).p.name : null,
        base_score: baseScore(r), market_pulse: pulseOf(r).delta, pulse_drivers: pulseOf(r).drivers.map(d => `${d.label} (${d.pts > 0 ? "+" : ""}${d.pts})`) }));
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
  font: 600 13.5px/1 var(--text, system-ui); letter-spacing: .01em; color: var(--gold-hi, #ecd27a);
  background: linear-gradient(180deg, rgba(212,175,55,.22), rgba(212,175,55,.08)), rgba(18,18,20,.62);
  border: 1px solid rgba(212,175,55,.45); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 0 1px 0 rgba(255,255,255,.08) inset, 0 18px 40px -14px rgba(0,0,0,.95), 0 0 24px -6px rgba(212,175,55,.45);
  transition: transform .35s var(--ease-out, ease), opacity .3s, box-shadow .3s; }
.sl-fab:hover { transform: translateY(-2px); box-shadow: 0 1px 0 rgba(255,255,255,.1) inset, 0 22px 44px -14px rgba(0,0,0,.95), 0 0 32px -4px rgba(212,175,55,.6); }
.sl-fab:active { transform: scale(.96); }
.sl-fab svg { width: 18px; height: 18px; }
.sl-fab.hide { opacity: 0; pointer-events: none; transform: translateY(12px) scale(.94); }
.sl-panel { position: fixed; z-index: 1002; top: 12px; right: 12px; bottom: 12px; width: min(460px, calc(100vw - 24px));
  display: flex; flex-direction: column; border-radius: 24px; overflow: hidden; color: var(--ink, #f5f5f7);
  background: rgba(14,14,16,.82); border: 1px solid rgba(212,175,55,.22);
  backdrop-filter: blur(40px) saturate(180%); -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow: 0 40px 100px -20px #000, 0 0 0 .5px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.06) inset;
  transform: translateX(calc(100% + 24px)); visibility: hidden; transition: transform .55s var(--ease, ease), visibility 0s linear .55s; }
.sl-panel.open { transform: none; visibility: visible; transition: transform .55s var(--ease, ease), visibility 0s; }
.sl-head { display: flex; align-items: center; gap: 12px; padding: 14px 14px 12px 18px; border-bottom: 1px solid var(--hair, rgba(255,255,255,.08)); flex: none; }
.sl-orb { width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #0b0904;
  background: radial-gradient(circle at 35% 30%, #f3e2b8, #D4AF37 55%, #9c7c22); box-shadow: 0 0 18px -2px rgba(212,175,55,.6); }
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
.sl-msg.user { align-self: flex-end; max-width: 85%; background: rgba(212,175,55,.16); border: 1px solid rgba(212,175,55,.3); padding: 9px 13px; border-radius: 16px 16px 4px 16px; }
.sl-msg.ai { padding-left: 14px; border-left: 1px solid rgba(212,175,55,.35); }
.sl-msg.ai h4 { margin: 14px 0 6px; font: 600 11px/1.2 var(--text, system-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--gold, #D4AF37); }
.sl-msg p { margin: 0 0 8px; }
.sl-lead { color: var(--ink-2, #d2d2d7); }
.sl-sub, .sl-mute { color: var(--muted, #8e8e93); font-size: 12px; }
.sl-warn { color: var(--warn, #f2a65e); }
.sl-rec { background: rgba(212,175,55,.08); border: 1px solid rgba(212,175,55,.2); border-radius: 12px; padding: 10px 12px; margin-top: 10px !important; }
.sl-card { background: rgba(255,255,255,.035); border: 1px solid var(--hair, rgba(255,255,255,.08)); border-radius: 14px; padding: 12px 13px; margin-bottom: 8px; }
.sl-card-h { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.sl-rank { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600; background: rgba(212,175,55,.2); color: var(--gold-hi, #ecd27a); }
.sl-idx { margin-left: auto; font: 600 15px var(--sans, system-ui); color: var(--gold-hi, #ecd27a); font-variant-numeric: tabular-nums; }
.sl-bar { height: 3px; border-radius: 2px; background: rgba(255,255,255,.06); margin: 8px 0; overflow: hidden; }
.sl-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--gold-deep, #9c7c22), var(--gold-hi, #ecd27a)); }
.sl-kv { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--ink-2, #d2d2d7); margin-bottom: 4px; }
.sl-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
.sl-stats div { background: rgba(255,255,255,.04); border: 1px solid var(--hair, rgba(255,255,255,.08)); border-radius: 12px; padding: 8px 10px; }
.sl-stats span { display: block; font-size: 10.5px; color: var(--muted, #8e8e93); text-transform: uppercase; letter-spacing: .08em; }
.sl-stats b { font: 600 18px var(--sans, system-ui); color: var(--gold-hi, #ecd27a); }
.sl-list { margin: 4px 0 8px; padding-left: 20px; display: grid; gap: 6px; }
.sl-list li::marker { color: var(--faint, #5a5a5f); font-size: 11px; }
.sl-store { all: unset; cursor: pointer; color: var(--gold-hi, #ecd27a); font-weight: 500; }
.sl-store:hover { text-decoration: underline; text-underline-offset: 3px; }
.sl-store:focus-visible { outline: 2px solid var(--gold, #D4AF37); border-radius: 4px; }
.sl-season { display: grid; grid-template-columns: repeat(12, 1fr); align-items: end; gap: 3px; height: 54px; margin: 2px 0 12px; padding: 8px; border-radius: 12px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); }
.sl-season i { display: block; border-radius: 3px 3px 1px 1px; background: rgba(255,255,255,.12); }
.sl-season i.win { background: linear-gradient(180deg, var(--gold-hi, #ecd27a), var(--gold, #D4AF37)); }
.sl-season i.on { background: var(--ink, #f5f5f7); }
.sl-score { font-size: 11px; color: var(--gold, #D4AF37); font-variant-numeric: tabular-nums; margin-left: 4px; }
.sl-tag { font-size: 11px; color: var(--ink-2, #d2d2d7); background: rgba(255,255,255,.06); border-radius: 999px; padding: 2px 8px; margin-left: 4px; white-space: nowrap; }
.sl-tag.bad { color: var(--bad, #ff6b6b); background: rgba(255,107,107,.1); }
.sl-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sl-btn { font: 500 12px var(--text, system-ui); color: var(--ink, #fff); background: rgba(255,255,255,.06); border: 1px solid var(--hair-2, rgba(255,255,255,.14)); border-radius: 999px; padding: 8px 14px; cursor: pointer; }
.sl-btn:hover { background: rgba(255,255,255,.1); }
.sl-btn.gold { background: var(--gold, #D4AF37); color: #0b0904; border-color: transparent; font-weight: 600; }
.sl-typing { display: inline-flex; gap: 4px; padding: 6px 0; }
.sl-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--gold, #D4AF37); animation: sl-dot 1.2s infinite ease-in-out; }
.sl-typing i:nth-child(2) { animation-delay: .15s; } .sl-typing i:nth-child(3) { animation-delay: .3s; }
.sl-foot { flex: none; padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--hair, rgba(255,255,255,.08)); }
.sl-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, #000 90%, transparent); mask-image: linear-gradient(90deg, #000 90%, transparent); }
.sl-chips::-webkit-scrollbar { display: none; }
.sl-chip { flex: none; font: 500 12px/1 var(--text, system-ui); color: var(--ink-2, #d2d2d7); background: rgba(255,255,255,.05); border: 1px solid rgba(212,175,55,.28);
  border-radius: 999px; padding: 8px 12px; cursor: pointer; transition: background .2s, border-color .2s, color .2s; }
.sl-chip:hover { background: rgba(212,175,55,.14); border-color: rgba(212,175,55,.55); color: var(--gold-hi, #ecd27a); }
.sl-form { display: flex; align-items: flex-end; gap: 8px; background: rgba(255,255,255,.05); border: 1px solid var(--hair-2, rgba(255,255,255,.14)); border-radius: 18px; padding: 6px 6px 6px 14px; transition: border-color .2s; }
.sl-form:focus-within { border-color: rgba(212,175,55,.5); }
.sl-form textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: var(--ink, #fff); font: 14px/1.4 var(--text, system-ui); padding: 7px 0; max-height: 120px; min-height: 22px; }
.sl-form textarea::placeholder { color: var(--faint, #5a5a5f); }
.sl-send { width: 34px; height: 34px; border-radius: 50%; border: 0; flex: none; cursor: pointer; display: grid; place-items: center; background: var(--gold, #D4AF37); color: #0b0904; transition: opacity .2s, transform .15s; }
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
.sl-alert:focus-visible { outline: 2px solid #D4AF37; }
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
    // Language switch: refresh the greeting if the conversation hasn't started
    document.addEventListener("atlas:lang", () => {
      if (history.length <= 1 && history.every(m => m.role !== "user")) { history = []; save(); if (log.childElementCount) render(); }
      modeLine();
    });
    function welcome() {
      const o = overview();
      return FR()
        ? `<p><span class="serif" style="font-size:17px">Bonjour.</span></p><p class="sl-lead" data-i18n-skip>J'analyse ${o.stores} portes sur ${Object.keys(o.countries).length} marchés, ${o.partners.length} compte${o.partners.length > 1 ? "s" : ""} partenaire${o.partners.length > 1 ? "s" : ""} et un rayon d'exclusivité de ${o.exclusivity_radius_km.toFixed(1)} km — en direct depuis ce CRM, en ${esc(o.currency.display)}. Interrogez une boutique, une ville, l'exclusivité territoriale ou la friction équipe, ou choisissez une analyse.</p>`
        : `<p><span class="serif" style="font-size:17px">Hello.</span></p><p class="sl-lead">I read ${o.stores} doors across ${Object.keys(o.countries).length} markets, ${o.partners.length} partner account${o.partners.length === 1 ? "" : "s"} and a ${o.exclusivity_radius_km.toFixed(1)} km exclusivity radius — live from this CRM, priced in ${esc(o.currency.display)}. Ask about a store, a city, territorial exclusivity or staff friction, or pick an analysis.</p>`;
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
    // Other modules (suite bar) can open the assistant on a given analysis
    document.addEventListener("sillage:ask", e => { const c = CHIPS.find(x => x.id === e.detail?.chip); open(); if (c) ask(tl(c.label), c.id); });
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "Escape" && panel.classList.contains("open")) close();
    });

    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; send.disabled = busy || !ta.value.trim(); });
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $(".sl-form").requestSubmit(); } });
    $(".sl-form").addEventListener("submit", e => { e.preventDefault(); const q = ta.value; ta.value = ""; ta.style.height = "auto"; ask(q); });
    $(".sl-chips").addEventListener("click", e => { const c = e.target.closest("[data-chip]"); if (c) ask(tl(CHIPS.find(x => x.id === c.dataset.chip).label), c.dataset.chip); });

    panel.addEventListener("click", e => {
      const seq = e.target.closest("[data-seq]");
      if (seq) { ctx.openPitch(+seq.dataset.seq, "seq"); return; }
      const al = e.target.closest("[data-alert]");
      if (al) { ask(tl(CHIPS.find(x => x.id === al.dataset.alert).label), al.dataset.alert); return; }
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
