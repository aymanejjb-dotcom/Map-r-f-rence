/* ———————————————————————————————————————————————————————————————
   Maison Atlas — predictive engines (pure functions, no DOM state)
   · Restock & sell-through velocity per partner, from the wholesale delivery log
   · Territory cannibalization guard: exclusivity-zone intersections around a prospect
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

  return { restock, guard, guardSVG, overlapShare, km, printDocument, addDays, days, LEAD_DAYS, LEVELS };
})();
