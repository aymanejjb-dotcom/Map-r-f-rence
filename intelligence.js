/* ———————————————————————————————————————————————————————————————
   Maison Atlas — predictive engines (pure functions, no DOM state)
   · Restock & sell-through velocity per partner, from the wholesale delivery log
   · Territory cannibalization guard: exclusivity-zone intersections around a prospect
   · Market pulse: regional purchasing shifts × retail / resort seasonality
   · 6-month cash-flow & revenue forecast from reorder velocity, seasonality and the weighted pipeline
   · Print-grade PDF dossier renderer (A4, vector text through the browser's PDF engine)
   index.html wires them into the map, cards, dossier, pitch sequencer and Sillage AI.
   ——————————————————————————————————————————————————————————————— */
window.SillageIntel = (function () {
  "use strict";
  const DAY = 864e5;
  const days = (a, b) => Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / DAY);
  const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00") + n * DAY).toISOString().slice(0, 10);
  // Recent behaviour weighs most: exponentially weighted mean, newest last
  const ewma = (xs, a = .5) => xs.reduce((m, x, i) => i ? a * x + (1 - a) * m : x, 0);

  // ———————————————————————————————— Restock & sell-through velocity
  // A delivery log is the only demand signal a wholesale brand owns. Each order is assumed to sell
  // through before the next one lands, so units ÷ days-to-next-order is that period's velocity.
  const LEAD_DAYS = 10;          // order → shelf: picking, carrier, retailer check-in
  const SAFETY_DAYS = 14;        // cover below lead time + this triggers a low-stock warning
  const DEFAULT_CADENCE = 45;    // first-order accounts: assumed reorder rhythm until a 2nd order exists
  const LEVELS = {
    reorder: { label: "Reorder now", tone: "bad", rank: 0 },
    low: { label: "Low stock", tone: "warn", rank: 1 },
    lapsed: { label: "Reorder overdue", tone: "warn", rank: 2 },
    healthy: { label: "Healthy", tone: "ok", rank: 3 },
  };

  function restock(ws, today, pack = 6) {
    if (!ws || !ws.deliveries?.length) return null;
    const byDate = new Map(), bySku = new Map();
    ws.deliveries.forEach(d => {
      byDate.set(d.date, (byDate.get(d.date) || 0) + d.units);
      const s = bySku.get(d.sku) || new Map();
      s.set(d.date, (s.get(d.date) || 0) + d.units);
      bySku.set(d.sku, s);
    });
    const orders = [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([date, units]) => ({ date, units }));
    const last = orders[orders.length - 1], since = Math.max(0, days(last.date, today));
    const intervals = orders.slice(1).map((o, i) => Math.max(1, days(orders[i].date, o.date)));
    const learned = intervals.length > 0;
    const cadence = learned ? ewma(intervals) : DEFAULT_CADENCE;
    const rates = learned ? orders.slice(0, -1).map((o, i) => o.units / intervals[i]) : [last.units / DEFAULT_CADENCE];
    const velocity = Math.max(.01, ewma(rates));
    // Retailers reorder at their reorder point, not at zero: each delivery lands on ~lead-time of carry-over stock
    const onHand = Math.max(0, last.units + velocity * LEAD_DAYS - velocity * since);
    const cover = onHand / velocity;
    const reorderIn = Math.round(cover - LEAD_DAYS);
    const trend = rates.length >= 3 ? rates[rates.length - 1] / (rates.slice(0, -1).reduce((a, b) => a + b, 0) / (rates.length - 1)) - 1 : null;
    let level = "healthy";
    if (cover <= LEAD_DAYS) level = "reorder";
    else if (cover <= LEAD_DAYS + SAFETY_DAYS) level = "low";
    else if (since > 1.5 * cadence) level = "lapsed";
    // Enough to cover the next cycle plus lead time, in case packs
    const need = velocity * (cadence + LEAD_DAYS) - onHand;
    const suggest = Math.max(pack, Math.ceil(Math.max(0, need) / pack) * pack);
    const skus = [...bySku].map(([sku, m]) => {
      const o = [...m].sort((a, b) => a[0].localeCompare(b[0]));
      const lastUnits = o[o.length - 1][1], lastDate = o[o.length - 1][0];
      const iv = o.slice(1).map((x, i) => Math.max(1, days(o[i][0], x[0])));
      const v = Math.max(.005, iv.length ? ewma(o.slice(0, -1).map((x, i) => x[1] / iv[i])) : lastUnits / cadence);
      const left = Math.max(0, lastUnits + v * LEAD_DAYS - v * Math.max(0, days(lastDate, today)));
      return { sku, velocity: v, perMonth: v * 30, onHand: left, cover: left / v };
    }).sort((a, b) => a.cover - b.cover);
    return {
      orders, cadence, velocity, perMonth: velocity * 30, since, lastDate: last.date, lastUnits: last.units, onHand, cover,
      reorderIn, reorderDate: addDays(today, Math.max(0, reorderIn)), nextOrder: addDays(last.date, Math.round(cadence)),
      trend, suggest, skus, level, ...LEVELS[level], confidence: orders.length >= 4 ? "High" : orders.length >= 2 ? "Medium" : "Low",
      alert: level !== "healthy",
    };
  }

  // ———————————————————————————————— Territory cannibalization guard
  const R_EARTH = 6371;
  function km(a, b) {
    const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(h));
  }
  // Share of one zone's area covered by another zone of the same radius (lens area ÷ πR²)
  function overlapShare(d, R) {
    if (d >= 2 * R) return 0;
    const lens = 2 * R * R * Math.acos(d / (2 * R)) - (d / 2) * Math.sqrt(4 * R * R - d * d);
    return lens / (Math.PI * R * R);
  }
  // Every protected account whose zone touches the zone this prospect would get if signed
  function guard(r, partners, R) {
    const near = partners.filter(p => p.id !== r.id).map(p => ({ p, km: km(r, p) })).filter(x => x.km < 3 * R).sort((a, b) => a.km - b.km);
    const inside = near.filter(x => x.km <= R);
    const overlaps = near.filter(x => x.km < 2 * R).map(x => ({ ...x, share: overlapShare(x.km, R) }));
    const watch = near.filter(x => x.km >= 2 * R);
    const share = overlaps.reduce((a, x) => a + x.share, 0);
    const risk = inside.length ? "blocked" : share >= .35 ? "high" : overlaps.length ? "moderate" : "clear";
    return { R, near, inside, overlaps, watch, share: Math.min(1, share), risk,
      label: { blocked: "Blocked · inside a partner zone", high: "High cannibalization risk", moderate: "Moderate overlap", clear: "Clear territory" }[risk] };
  }
  // To-scale schematic: the prospect's would-be zone at the centre, partner zones around it
  function guardSVG(r, g, colors) {
    // Frame the farthest zone shown, never tighter than the store's own zone
    const S = 260, span = Math.min(4 * g.R, Math.max(1.3 * g.R, ...g.near.map(x => x.km + g.R))), k = (S / 2 - 6) / span, c = S / 2;
    const xy = p => [c + (p.lng - r.lng) * Math.cos(r.lat * Math.PI / 180) * 111.32 * k, c - (p.lat - r.lat) * 110.57 * k];
    const rr = g.R * k;
    const zones = g.near.map(({ p }) => {
      const [x, y] = xy(p), hot = km(r, p) <= g.R ? colors.bad : km(r, p) < 2 * g.R ? colors.warn : colors.muted;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${hot}" fill-opacity=".14" stroke="${hot}" stroke-opacity=".7" stroke-width="1"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${hot}"/>`;
    }).join("");
    return `<svg class="guard-map" viewBox="0 0 ${S} ${S}" role="img" aria-label="Exclusivity zones around this store">
      <defs><clipPath id="gclip"><rect width="${S}" height="${S}" rx="14"/></clipPath></defs>
      <g clip-path="url(#gclip)"><rect width="${S}" height="${S}" fill="rgba(255,255,255,.015)"/>
      ${[1, 2, 3].filter(i => i * rr < S).map(i => `<circle cx="${c}" cy="${c}" r="${(i * rr).toFixed(1)}" fill="none" stroke="rgba(255,255,255,.07)" stroke-dasharray="2 4"/>`).join("")}
      ${zones}
      <circle cx="${c}" cy="${c}" r="${rr.toFixed(1)}" fill="none" stroke="${colors.gold}" stroke-width="1.4" stroke-dasharray="5 4"/>
      <circle cx="${c}" cy="${c}" r="5" fill="${colors.gold}" stroke="#000" stroke-width="1.5"/></g>
      <text x="${c + 6}" y="${(c - rr - 5).toFixed(1)}" fill="${colors.muted}" font-size="9">${g.R} km</text>
    </svg>`;
  }

  // ———————————————————————————————— Market pulse: regional purchasing shifts × retail seasonality
  // Editorial indices (2026 outlook), not measured data: they tilt priorities and forecasts, they do not size markets.
  // Monthly sell-in index for niche-fragrance wholesale (retailer orders), mean 1.0: Valentine's, Mother's / Father's Day,
  // a dead August, then the Q4 gifting build from the rentrée.
  const SEASON = [.78, .85, .92, .95, 1.05, 1, .82, .74, 1.02, 1.18, 1.38, 1.31];
  const RESORTS = [
    { label: "Ski-resort season", peak: [11, 0, 1, 2], up: 1.35, down: .72, downIn: [3, 4, 5, 6, 7, 8, 9, 10],
      cities: ["Courchevel", "Garmisch-Partenkirchen", "Interlaken", "Rottach-Egern", "Gmund", "Zermatt", "Gstaad", "St. Moritz", "Verbier", "Megève", "Davos"] },
    { label: "Coastal & lake summer season", peak: [5, 6, 7], up: 1.3, down: .85, downIn: [10, 11, 0, 1],
      cities: ["Biarritz", "Saint-Jean-de-Luz", "Cannes", "Nice", "Saint-Laurent-du-Var", "Toulon", "La Rochelle", "Oostende", "Den Helder",
        "Ascona", "Locarno", "Lugano", "Montreux", "Knokke", "Knokke-Heist", "Sylt", "Kampen", "Deauville", "Saint-Tropez"] },
  ];
  const REGION = {
    CH: [5, "Strong franc and tourist spend keep Swiss luxury retail ahead"],
    LU: [4, "Highest purchasing power in the EU, cross-border clientele"],
    NL: [3, "Niche fragrance is the fastest-growing prestige category in the Netherlands"],
    FR: [1, "Tourism lifts Paris and the Riviera; regional France flat"],
    BE: [0, "Stable demand, led by Antwerp and Brussels"],
    DE: [-3, "Soft consumer sentiment and department-store restructuring"],
  };
  const SEGMENT_SHIFT = {
    "True Indie Niche Boutique": [3, "Indie niche doors outgrow prestige perfumery"],
    "Specialist Niche House": [2, "Specialist niche houses gain share"],
    "Selective Concept Store": [1, "Concept stores keep widening their beauty edit"],
    "Traditional Prestige Perfumery": [-1, "Traditional prestige loses share to niche"],
    "Department Store": [-3, "Footfall shifts from department stores to independents"],
  };
  const resortOf = r => RESORTS.find(z => z.cities.includes(r.city)) || null;
  const monthOf = d => +d.slice(5, 7) - 1;
  // Local seasonality of one door for a calendar month (0–11)
  function seasonality(r, mi) {
    const z = resortOf(r);
    return SEASON[mi] * (!z ? 1 : z.peak.includes(mi) ? z.up : z.downIn.includes(mi) ? z.down : 1);
  }
  // Regional demand shift in points (country + Paris tourist flows), independent of the calendar
  function regional(r) {
    const [d, note] = REGION[r.country] || [0, ""];
    const paris = r.city === "Paris" ? 3 : 0;
    return { pts: d + paris, note: paris ? note + "; Paris tourist flows +3" : note };
  }
  // Pulse adjustment to a prioritisation score, ±12 points. Retailers buy 1–3 months ahead of sell-out,
  // so the window ahead (not the current month) drives timing urgency.
  function pulse(r, today) {
    const mi = monthOf(today), z = resortOf(r);
    const ahead = [1, 2, 3].map(k => seasonality(r, (mi + k) % 12));
    const win = ahead.reduce((a, x) => a + x, 0) / 3;
    const reg = regional(r), seg = SEGMENT_SHIFT[r.segment] || [0, ""];
    const hub = r.export_potential && r.export_potential.hub_km <= 3 && [5, 6, 7, 11].includes(mi) ? 2 : 0;
    const drivers = [
      { label: reg.note, pts: reg.pts },
      { label: seg[1], pts: seg[0] },
      { label: `${z ? z.label : "Retail calendar"}: buying window ${win >= 1 ? "opening" : "closing"} (next-90-day index ${win.toFixed(2)})`, pts: Math.round((win - 1) * 25) },
      { label: "Luxury-hub tourist peak", pts: hub },
    ].filter(x => x.pts && x.label).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
    const delta = Math.max(-12, Math.min(12, drivers.reduce((a, x) => a + x.pts, 0)));
    return { delta, drivers, window: win, season: seasonality(r, mi), regional: reg.pts, resort: z ? z.label : null };
  }

  // ———————————————————————————————— Cash-flow & revenue forecast
  // Partners: deseasonalised monthly run-rate from the last 12 months of invoices × local seasonality × damped
  // 90-day velocity trend × regional shift. Pipeline: probability-weighted opening order landing by stage, then
  // reorders. Cash: projected turnover shifted by the account's payment terms, plus receivables already invoiced.
  const ym = d => d.slice(0, 7);
  const addMonths = (m, n) => { let [y, mo] = m.split("-").map(Number); mo += n - 1; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return `${y}-${String(mo + 1).padStart(2, "0")}`; };
  const LAND = { "Meeting Booked": 1, "Follow-up Required": 2, "Discovery Set Sent": 3 };
  function forecast(accounts, prospects, opt) {
    const today = opt.today, H = opt.months || 6, now = ym(today);
    const months = Array.from({ length: H }, (_, k) => addMonths(now, k + 1));
    const blank = () => months.map(m => ({ ym: m, partners: 0, pipeline: 0, cash: 0, mk: {} }));
    const out = blank(), rows = [];
    const dom = +today.slice(8, 10), dim = new Date(+today.slice(0, 4), +today.slice(5, 7), 0).getDate();
    const put = (k, field, v, mk) => { if (k < 0 || k >= H || !v) return; out[k][field] += v; if (field !== "cash") out[k].mk[mk] = (out[k].mk[mk] || 0) + v; };
    accounts.forEach(({ r, ws, mk }) => {
      if (!ws || !ws.invoices.length) return;
      const from = addDays(today, -365), start = ws.since && ws.since > from ? ws.since : from;
      const inv = ws.invoices.filter(i => i.date >= start && i.date <= today);
      if (!inv.length) return;
      // Seasonal exposure of the observation window: full months weigh 1, the current one by days elapsed
      let expo = 0;
      for (let m = ym(start); m <= now; m = addMonths(m, 1)) {
        const w = m === now ? dom / dim : m === ym(start) ? 1 - (+start.slice(8, 10) - 1) / 30 : 1;
        expo += Math.max(.1, w) * seasonality(r, monthOf(m + "-01"));
      }
      const base = inv.reduce((a, i) => a + i.amount, 0) / Math.max(1, expo);
      const sum = (a, b) => inv.filter(i => i.date > addDays(today, -a) && i.date <= addDays(today, -b)).reduce((s, i) => s + i.amount, 0);
      const recent = sum(90, 0), prior = sum(180, 90);
      const trend = recent && prior && days(start, today) > 150 ? Math.min(1.3, Math.max(.75, recent / prior)) : 1;
      const g = 1 + (Math.cbrt(trend) - 1) * .5;            // damped monthly growth
      const regionF = 1 + regional(r).pts / 100;
      const terms = inv.map(i => i.due ? days(i.date, i.due) : 30).sort((a, b) => a - b)[Math.floor(inv.length / 2)] || 30;
      // Fractional lag: net 45 lands half a month later than net 30, split across the two months
      const lag = Math.floor(terms / 30), w = terms / 30 - lag;
      let six = 0;
      months.forEach((m, k) => {
        const v = base * seasonality(r, monthOf(m + "-01")) * g ** (k + 1) * regionF;
        six += v;
        put(k, "partners", v, mk);
        put(k + lag, "cash", v * (1 - w), mk);
        put(k + lag + 1, "cash", v * w, mk);
      });
      // Receivables already invoiced: pending collected in their due month, overdue next month at 85 %
      ws.invoices.filter(i => i.status !== "Paid").forEach(i => {
        const k = i.state === "Overdue" || !i.due || ym(i.due) <= now ? 0 : months.indexOf(ym(i.due));
        put(k, "cash", i.state === "Overdue" ? i.amount * .85 : i.amount, mk);
      });
      rows.push({ r, mk, base, trend, six, terms });
    });
    prospects.forEach(({ r, p, open, reorder, re, mk }) => {
      const land = LAND[r.pipeline_status];
      if (!land || !p) return;
      months.forEach((m, k) => {
        const s = seasonality(r, monthOf(m + "-01"));
        const v = k + 1 === land ? p * open * s : k + 1 > land ? p * reorder * re / 12 * s : 0;
        put(k, "pipeline", v, mk);
        put(k + 1, "cash", v, mk);
      });
    });
    out.forEach((o, k) => {
      o.total = o.partners + o.pipeline;
      const a = .08 + .03 * k;
      o.lo = o.partners * (1 - a) + o.pipeline * .4;
      o.hi = o.partners * (1 + a) + o.pipeline * 1.6;
    });
    const tot = f => out.reduce((a, o) => a + o[f], 0);
    return { months: out, accounts: rows.sort((a, b) => b.six - a.six), total: tot("total"), partners: tot("partners"),
      pipeline: tot("pipeline"), cash: tot("cash"), lo: tot("lo"), hi: tot("hi") };
  }

  // ———————————————————————————————— Print-grade PDF dossier
  // Rendered in an off-screen iframe and handed to the browser's PDF engine ("Save as PDF"):
  // vector text, real fonts, no canvas rasterisation.
  const PRINT_CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 400 9.6pt/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; color: #1b1a17; letter-spacing: -.003em; }
.serif, h1, h2, h3 { font-family: "Playfair Display", "Bodoni 72", Didot, Georgia, serif; font-weight: 500; letter-spacing: -.01em; }
.cover { height: 252mm; display: flex; flex-direction: column; justify-content: space-between; padding: 6mm 2mm; page-break-after: always;
  background: radial-gradient(120% 80% at 100% 0%, rgba(197,160,89,.18), transparent 60%); }
.brand { font: 600 7.5pt/1 -apple-system, "Helvetica Neue", Arial, sans-serif; letter-spacing: .32em; text-transform: uppercase; color: #8c6f35; }
.cover h1 { font-size: 40pt; line-height: 1.04; margin: 0 0 6mm; }
.cover h1 em { color: #8c6f35; }
.cover .lede { font-size: 12pt; color: #4a463f; max-width: 130mm; }
.rule { height: 1px; background: linear-gradient(90deg, #c5a059, rgba(197,160,89,0)); margin: 6mm 0; }
.meta { color: #6e685e; font-size: 8.5pt; }
.eyebrow { font: 600 7pt/1.2 -apple-system, "Helvetica Neue", Arial, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: #8c6f35; }
h2 { font-size: 17pt; margin: 9mm 0 3mm; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); border: .6pt solid #e3dccd; border-radius: 3mm; overflow: hidden; margin: 4mm 0; }
.kpis div { padding: 3.2mm 3.5mm; }
.kpis div + div { border-left: .6pt solid #e3dccd; }
.kpis span { display: block; font-size: 6.5pt; letter-spacing: .14em; text-transform: uppercase; color: #8a8478; }
.kpis b { display: block; font: 600 15pt/1.3 -apple-system, "Helvetica Neue", Arial, sans-serif; font-variant-numeric: tabular-nums; }
.kpis.gold { background: #fbf7ef; }
.kpis.gold b { color: #7a5f2b; }
.bars { display: grid; grid-template-columns: 58mm 1fr 10mm; gap: 1.6mm 3mm; align-items: center; margin: 3mm 0; }
.bars i { display: block; height: 2.2mm; border-radius: 2mm; background: #efe9dd; overflow: hidden; }
.bars i b { display: block; height: 100%; background: linear-gradient(90deg, #8c6f35, #c5a059); border-radius: 2mm; }
.bars em { font-style: normal; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
table { width: 100%; border-collapse: collapse; font-size: 8.4pt; margin: 2mm 0 4mm; }
th { text-align: left; font: 600 6.6pt -apple-system, "Helvetica Neue", Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #8a8478; border-bottom: .8pt solid #c5a059; padding: 1.6mm 1.6mm; }
td { padding: 1.7mm 1.6mm; border-bottom: .5pt solid #ece6da; vertical-align: top; font-variant-numeric: tabular-nums; }
td.r, th.r { text-align: right; }
tr { page-break-inside: avoid; }
.callout { border-left: 1.2mm solid #c5a059; background: #fbf7ef; padding: 3mm 4mm; margin: 3mm 0; border-radius: 0 2mm 2mm 0; }
.callout.alert { border-color: #d9822b; background: #fdf3e8; }
.callout.bad { border-color: #c94a4a; background: #fbecec; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
dl { display: grid; grid-template-columns: 26mm 1fr; gap: 1.6mm 4mm; margin: 2mm 0; }
dt { color: #8a8478; font-size: 7.6pt; text-transform: uppercase; letter-spacing: .1em; padding-top: .4mm; }
dd { margin: 0; }
.tag { display: inline-block; border: .6pt solid #d8cfbd; border-radius: 9mm; padding: .6mm 2.6mm; margin: 0 1.2mm 1.2mm 0; font-size: 7.6pt; }
.foot { display: flex; justify-content: space-between; margin-top: 10mm; padding-top: 3mm; border-top: .6pt solid #e3dccd; font-size: 7pt; color: #9a9488; page-break-inside: avoid; }
svg { display: block; }
.page { page-break-before: always; }
`;
  let printing = false;
  function printDocument(title, body) {
    if (printing) return Promise.resolve();
    printing = true;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&display=swap">
      <style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
    return new Promise(resolve => {
      // print() blocks until the dialog closes on desktop; mobile Safari returns early, so the frame
      // outlives the call until afterprint (or a minute) before it is removed
      const remove = () => frame.isConnected && frame.remove();
      frame.addEventListener("load", async () => {
        const w = frame.contentWindow;
        try { await Promise.race([w.document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* fonts optional */ }
        w.addEventListener("afterprint", () => setTimeout(remove, 500), { once: true });
        try { w.focus(); w.print(); } catch (e) { remove(); }
        printing = false;
        setTimeout(remove, 60000);
        resolve();
      }, { once: true });
    });
  }

  return { restock, guard, guardSVG, overlapShare, km, printDocument, addDays, days, LEAD_DAYS, LEVELS,
    pulse, seasonality, regional, forecast, addMonths, SEASON, REGION };
})();
