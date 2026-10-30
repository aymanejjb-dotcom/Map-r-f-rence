/* ———————————————————————————————————————————————————————————————
   Maison Atlas — platform modules
   · Cash-flow & revenue forecast (6 months, EUR / CHF / GBP) on SillageIntel.forecast
   · Legal agreement generator: selective / exclusive distribution or mutual NDA, pre-filled A4 PDF
   · Webhook & integration center: Shopify B2B + Stripe endpoints, payloads, sync worker, replay & pull
   · PWA shell: service worker registration, install prompt, offline status for trade shows
   Reads the live CRM through window.SillageContext (index.html), like ai_assistant.js.
   ——————————————————————————————————————————————————————————————— */
(function () {
  "use strict";

  const Intel = window.SillageIntel;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = m => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
  const X = `<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;
  let ctx = null;
  const isProtected = r => ctx.protectedStatuses.includes(r.pipeline_status);
  const download = (name, text, type) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); ctx.toast(`${what} copied`); }
    catch (e) { ctx.toast("Clipboard blocked — select and copy manually"); }
  }

  const css = `
.mx-dlg { width: min(760px, calc(100vw - 24px)) !important; }
.mx-dlg .modal-body { gap: 16px; }
.mx-dlg .modal-body > * { flex-shrink: 0; }
.mx-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(255,255,255,.04); border: 1px solid var(--hair); flex-wrap: wrap; }
.mx-tabs button { border: 0; background: transparent; color: var(--muted); font: 500 12.5px var(--text); padding: 7px 13px; border-radius: 999px; cursor: pointer; transition: background .3s var(--ease), color .3s; }
.mx-tabs button[aria-pressed="true"] { background: rgba(255,255,255,.1); color: var(--ink); box-shadow: inset 0 0 0 1px var(--hair-2); }
.mx-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; border-radius: 16px; overflow: hidden; background: var(--hair); border: 1px solid var(--hair); }
.mx-kpis div { background: var(--card); padding: 12px 14px; min-width: 0; }
.mx-kpis span { display: block; font: 600 10px/1.2 var(--text); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.mx-kpis b { display: block; margin-top: 6px; font: 500 21px/1.1 var(--sans); font-variant-numeric: tabular-nums; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mx-kpis .gold b { color: var(--gold-hi); }
.mx-kpis small { display: block; color: var(--faint); font-size: 11px; margin-top: 3px; }
.mx-chart { border-radius: 16px; border: 1px solid var(--hair); background: radial-gradient(120% 100% at 100% 0%, rgba(197,160,89,.08), transparent 60%), var(--well); padding: 12px 10px 6px; }
.mx-chart svg { display: block; width: 100%; height: auto; }
.mx-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: var(--muted); padding: 4px 6px 2px; }
.mx-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.mx-t { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.mx-t th { text-align: left; font: 600 10px var(--text); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding: 8px 8px; border-bottom: 1px solid var(--gold-line); white-space: nowrap; }
.mx-t td { padding: 9px 8px; border-bottom: 1px solid var(--hair); vertical-align: top; }
.mx-t .r { text-align: right; white-space: nowrap; }
.mx-t tr:last-child td { border-bottom: 0; }
.mx-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--hair); border-radius: 14px; }
.mx-note { color: var(--faint); font-size: 11.5px; line-height: 1.55; margin: 0; }
.mx-up { color: var(--ok); } .mx-down { color: var(--bad); }
.mx-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.mx-form label { display: flex; flex-direction: column; gap: 5px; font: 600 10px/1.2 var(--text); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); min-width: 0; }
.mx-form .wide { grid-column: 1 / -1; }
.mx-form input, .mx-form select, .mx-code, .mx-in { font: 400 13.5px var(--text); letter-spacing: 0; text-transform: none; color: var(--ink); background: var(--well); border: 1px solid var(--hair-2); border-radius: 10px; padding: 9px 11px; width: 100%; min-width: 0; }
.mx-form input:focus, .mx-form select:focus, .mx-code:focus, .mx-in:focus { outline: none; border-color: var(--gold-line); box-shadow: 0 0 0 3px var(--gold-lo); }
.mx-sum { border-left: 2px solid var(--gold); background: var(--gold-lo); border-radius: 0 12px 12px 0; padding: 12px 14px; font-size: 13px; color: var(--ink-2); }
.mx-sum b { color: var(--ink); }
.mx-ep { border: 1px solid var(--hair); border-radius: 14px; padding: 12px 14px; display: grid; gap: 6px; background: rgba(255,255,255,.015); }
.mx-ep header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mx-ep code, .mx-mono { font: 500 12px/1.5 ui-monospace, "SF Mono", Menlo, monospace; color: var(--ink-2); word-break: break-all; }
.mx-verb { font: 700 10px ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .06em; padding: 3px 7px; border-radius: 6px; background: var(--gold-lo); color: var(--gold-hi); border: 1px solid var(--gold-line); }
.mx-verb.get { background: rgba(95,208,138,.1); color: var(--ok); border-color: rgba(95,208,138,.35); }
.mx-ep .tags { display: flex; flex-wrap: wrap; gap: 5px; }
.mx-ep .tags span { font: 500 11px ui-monospace, "SF Mono", Menlo, monospace; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--hair-2); color: var(--muted); }
.mx-code { font: 400 11.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace; min-height: 220px; resize: vertical; white-space: pre; tab-size: 2; }
.mx-pre { margin: 0; max-height: 300px; overflow: auto; background: var(--well); border: 1px solid var(--hair); border-radius: 12px; padding: 12px 14px; font: 400 11.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace; color: var(--ink-2); white-space: pre; }
.mx-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.mx-ops { display: grid; gap: 6px; }
.mx-ops div { display: flex; gap: 8px; align-items: baseline; font-size: 12.5px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.03); border: 1px solid var(--hair); }
.mx-ops em { font-style: normal; font: 600 10px var(--text); letter-spacing: .1em; text-transform: uppercase; color: var(--gold-hi); min-width: 64px; }
.mx-steps { margin: 0; padding-left: 20px; color: var(--ink-2); font-size: 13.5px; line-height: 1.7; }
.mx-meter { height: 6px; border-radius: 6px; background: rgba(255,255,255,.08); overflow: hidden; }
.mx-meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--gold-deep), var(--gold-hi)); border-radius: 6px; transition: width .6s var(--ease); }
@media (max-width: 700px) {
  .mx-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mx-form { grid-template-columns: 1fr; }
  .mx-kpis b { font-size: 18px; }
}`;

  // ———————————————————————————————— Slide-over dialog shell (same chrome as the pitch generator)
  function sheetDialog(id, eyebrow, title) {
    const d = document.createElement("dialog");
    d.className = "sheet-dlg mx-dlg";
    d.id = id;
    d.setAttribute("aria-labelledby", id + "-t");
    d.innerHTML = `<div class="modal-head"><div><span class="eyebrow">${eyebrow}</span><h3 id="${id}-t">${title}</h3><div class="sub" data-sub></div></div>
      <button class="close" data-close aria-label="Close">${X}</button></div>
      <div class="modal-body" data-body></div><div class="modal-foot" data-foot></div>`;
    document.body.appendChild(d);
    const close = () => {
      if (!d.open || d.classList.contains("closing")) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) { d.close(); return; }
      d.classList.add("closing");
      d.addEventListener("animationend", () => { d.classList.remove("closing"); d.close(); }, { once: true });
    };
    d.addEventListener("cancel", e => { e.preventDefault(); close(); });
    d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-close]")) close(); });
    return {
      el: d, close,
      body: d.querySelector("[data-body]"), foot: d.querySelector("[data-foot]"), sub: d.querySelector("[data-sub]"),
      title: t => { d.querySelector("h3").textContent = t; },
      open() { d.classList.remove("closing"); if (!d.open) d.showModal(); d.querySelector("[data-body]").scrollTop = 0; },
    };
  }

  // ———————————————————————————————— 1 · Cash-flow & revenue forecast
  let fc = null, fcScope = "all";
  function forecastData() {
    const ids = fcScope === "view" ? new Set(ctx.shown.map(r => r.id)) : null;
    const rows = ctx.data.filter(r => !ids || ids.has(r.id));
    const accounts = rows.filter(isProtected).map(r => ({ r, ws: r._ws, mk: ctx.marketOf(r) }));
    const prospects = rows.filter(r => !isProtected(r)).map(r => {
      const open = ctx.moqFor(r) * ctx.priceOf(r).eurPerUnit;
      return { r, p: ctx.prob[r.pipeline_status] || 0, open, reorder: open / (r.type === "Department Store" ? 2 : 1), re: ctx.sim.re, mk: ctx.marketOf(r) };
    });
    return Intel.forecast(accounts, prospects, { today: ctx.today, months: 6 });
  }
  // Stacked partner / pipeline bars, confidence whiskers, cash-in line. viewBox scales to the dialog width.
  function chartSVG(f, light, W = 640) {
    const H = W < 500 ? 220 : 240, L = 46, B = 26, T = 14, n = f.months.length, bw = (W - L - 10) / n;
    // Round axis: 4 steps of 1 / 2 / 2.5 / 5 × 10^k in the display currency
    const top = Math.max(1, ...f.months.map(m => Math.max(m.hi, m.cash))) * ctx.fx[ctx.currency];
    const mag = 10 ** Math.floor(Math.log10(top / 4)), step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(v => v * 4 >= top);
    const max = step * 4 / ctx.fx[ctx.currency];
    const y = v => T + (H - T - B) * (1 - v / max);
    const c = light ? { grid: "#ece6da", txt: "#8a8478", gold: "#b8924a", pipe: "rgba(184,146,74,.32)", cash: "#1b1a17", band: "#6e685e" }
      : { grid: "rgba(255,255,255,.07)", txt: "#8e8e93", gold: "url(#mxg)", pipe: "rgba(197,160,89,.28)", cash: "#f5f5f7", band: "rgba(245,245,247,.45)" };
    const ticks = [0, .25, .5, .75, 1].map(k => k * max);
    const sym = ctx.markets[ctx.currency].sym, k = step >= 1000;
    const tick = v => { const x = v * ctx.fx[ctx.currency], n = k ? +(x / 1000).toFixed(1) + "k" : String(Math.round(x)); return x === 0 ? "0" : ctx.currency === "EUR" ? `${n} ${sym}` : `${sym} ${n}`; };
    const fmt = v => ctx.short(v);
    const cash = f.months.map((m, i) => [L + bw * i + bw / 2, y(m.cash)]);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Six-month turnover forecast">
      <defs><linearGradient id="mxg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2c88f"/><stop offset="1" stop-color="#8c6f35"/></linearGradient></defs>
      ${ticks.map(v => `<line x1="${L}" x2="${W - 6}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${c.grid}"/><text x="${L - 8}" y="${(y(v) + 3.5).toFixed(1)}" fill="${c.txt}" font-size="10" text-anchor="end">${esc(tick(v))}</text>`).join("")}
      ${f.months.map((m, i) => {
        const x = L + bw * i + bw * .2, w = bw * .6, yp = y(m.partners), yt = y(m.total), cx = L + bw * i + bw / 2;
        return `<g><title>${monthLabel(m.ym)} · partners ${fmt(m.partners)} · pipeline ${fmt(m.pipeline)} · cash ${fmt(m.cash)}</title>
          <rect x="${x.toFixed(1)}" y="${yp.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, y(0) - yp).toFixed(1)}" rx="5" fill="${c.gold}"/>
          ${m.pipeline > 0 ? `<rect x="${x.toFixed(1)}" y="${yt.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, yp - yt - 2).toFixed(1)}" rx="5" fill="${c.pipe}" stroke="${light ? "#b8924a" : "rgba(226,200,143,.55)"}" stroke-dasharray="3 3" stroke-width=".8"/>` : ""}
          <line x1="${cx}" x2="${cx}" y1="${y(m.hi).toFixed(1)}" y2="${y(m.lo).toFixed(1)}" stroke="${c.band}" stroke-width="1"/>
          <line x1="${cx - 5}" x2="${cx + 5}" y1="${y(m.hi).toFixed(1)}" y2="${y(m.hi).toFixed(1)}" stroke="${c.band}"/>
          <line x1="${cx - 5}" x2="${cx + 5}" y1="${y(m.lo).toFixed(1)}" y2="${y(m.lo).toFixed(1)}" stroke="${c.band}"/>
          <text x="${cx}" y="${H - 8}" fill="${c.txt}" font-size="10.5" text-anchor="middle">${monthLabel(m.ym)}</text></g>`;
      }).join("")}
      <polyline points="${cash.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${c.cash}" stroke-width="1.6" stroke-linejoin="round"/>
      ${cash.map(([x, yy]) => `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.2" fill="${light ? "#fff" : "#000"}" stroke="${c.cash}" stroke-width="1.6"/>`).join("")}
    </svg>`;
  }
  function marketRows(f) {
    const by = {};
    f.months.forEach(m => Object.entries(m.mk).forEach(([c, v]) => { by[c] = (by[c] || 0) + v; }));
    return Object.keys(ctx.markets).map(c => {
      const doors = ctx.data.filter(r => ctx.marketOf(r) === c && isProtected(r)).length;
      return { c, eur: by[c] || 0, local: (by[c] || 0) * ctx.fx[c], doors, name: ctx.markets[c].name };
    });
  }
  function renderForecast() {
    const f = fc.data = forecastData(), cur = ctx.currency;
    const peak = f.months.reduce((a, m) => m.total > a.total ? m : a, f.months[0]);
    const mk = marketRows(f);
    const fxShare = mk.filter(m => m.c !== cur).reduce((a, m) => a + m.eur, 0);
    fc.sub.textContent = `${monthLabel(f.months[0].ym)} – ${monthLabel(f.months[5].ym)} · ${f.accounts.length} partner accounts · figures in ${cur}`;
    const trend = t => t === 1 ? `<span class="muted">flat</span>` : `<span class="${t > 1 ? "mx-up" : "mx-down"}">${t > 1 ? "▲" : "▼"} ${Math.abs(Math.round((t - 1) * 100))} %</span>`;
    fc.body.innerHTML = `
      <div class="mx-row"><div class="mx-tabs" role="group" aria-label="Scope"><button data-fscope="all" aria-pressed="${fcScope === "all"}">All doors</button><button data-fscope="view" aria-pressed="${fcScope === "view"}">Current filters · ${ctx.shown.length}</button></div></div>
      <div class="mx-kpis">
        <div class="gold"><span>6-month turnover</span><b>${ctx.short(f.total)}</b><small>${ctx.short(f.lo)} – ${ctx.short(f.hi)}</small></div>
        <div><span>Cash-in</span><b>${ctx.short(f.cash)}</b><small>after payment terms</small></div>
        <div><span>From partners</span><b>${ctx.short(f.partners)}</b><small>${f.total ? Math.round(f.partners / f.total * 100) : 0} % · reorder velocity</small></div>
        <div><span>Peak month</span><b>${monthLabel(peak.ym)}</b><small>${ctx.short(peak.total)}</small></div>
      </div>
      <div class="mx-chart">${chartSVG(f, false, fc.body.clientWidth < 520 ? 360 : 640)}
        <div class="mx-legend"><span><i style="background:linear-gradient(#e2c88f,#8c6f35)"></i>Partner reorders</span><span><i style="background:rgba(197,160,89,.28);outline:1px dashed rgba(226,200,143,.6)"></i>Weighted pipeline</span><span><i style="background:transparent;border:1.6px solid var(--ink);border-radius:50%"></i>Cash-in</span><span>│ confidence range</span></div></div>
      <h4 class="eyebrow" style="margin:4px 0 -6px">By market currency</h4>
      <div class="mx-scroll"><table class="mx-t"><tr><th>Market</th><th class="r">Partners</th><th class="r">6-mo · local</th><th class="r">In ${cur}</th><th class="r">FX ±5 %</th></tr>
        ${mk.map(m => `<tr><td><b>${esc(m.c)}</b> <span class="muted">${esc(m.name)}</span></td><td class="r">${m.doors}</td><td class="r">${m.eur ? ctx.local(m.local, m.c) : "–"}</td><td class="r">${m.eur ? ctx.money(m.eur) : "–"}</td><td class="r">${m.eur && m.c !== cur ? "± " + ctx.money(m.eur * .05) : "–"}</td></tr>`).join("")}</table></div>
      ${fxShare ? `<p class="mx-note">${Math.round(fxShare / Math.max(1, f.total) * 100)} % of projected turnover is invoiced outside ${cur}: a 5 % currency move shifts the ${cur} total by ± ${ctx.money(fxShare * .05)}. ${mk.some(m => m.c === "GBP" && !m.doors) ? "No UK partner yet: the GBP list is ready for the first one." : ""}</p>` : ""}
      <h4 class="eyebrow" style="margin:4px 0 -6px">Month by month</h4>
      <div class="mx-scroll"><table class="mx-t"><tr><th>Month</th><th class="r">Partners</th><th class="r">Pipeline</th><th class="r">Turnover</th><th class="r">Range</th><th class="r">Cash-in</th></tr>
        ${f.months.map(m => `<tr><td>${monthLabel(m.ym)} <span class="muted">· season ${Intel.SEASON[+m.ym.slice(5, 7) - 1].toFixed(2)}</span></td><td class="r">${ctx.money(m.partners)}</td><td class="r">${ctx.money(m.pipeline)}</td><td class="r"><b>${ctx.money(m.total)}</b></td><td class="r muted">${ctx.short(m.lo)}–${ctx.short(m.hi)}</td><td class="r">${ctx.money(m.cash)}</td></tr>`).join("")}</table></div>
      <h4 class="eyebrow" style="margin:4px 0 -6px">Partner accounts</h4>
      <div class="mx-scroll"><table class="mx-t"><tr><th>Account</th><th class="r">Run-rate / mo</th><th class="r">90-day trend</th><th class="r">Terms</th><th class="r">6-month</th></tr>
        ${f.accounts.slice(0, 12).map(a => `<tr><td><button class="linkish" data-fc-focus="${a.r.id}">${esc(a.r.name)}</button><div class="muted" style="font-size:11.5px">${esc(a.r.city)} · ${esc(a.mk)}${ctx.isDemo(a.r) ? " · demo ledger" : ""}</div></td><td class="r">${ctx.money(a.base)}</td><td class="r">${trend(a.trend)}</td><td class="r">${a.terms} d</td><td class="r"><b>${ctx.money(a.six)}</b></td></tr>`).join("") || `<tr><td colspan="5" class="muted">No partner invoices in the last 12 months.</td></tr>`}</table></div>
      <p class="mx-note">Partners: deseasonalised monthly run-rate from the last 12 months of invoices × local seasonality (Q4 gifting build, ski-resort winters, coastal summers) × damped 90-day reorder-velocity trend × regional purchasing shift. Pipeline: close probability × opening order landing 1–3 months out by stage (meeting, follow-up, discovery set), then reorders at ${ctx.sim.re}/year. Cash: turnover shifted by each account's median payment terms, plus receivables already invoiced (overdue at 85 %). Ledger amounts are EUR; local columns convert at ${ctx.fx.src === "ECB" ? "ECB " + esc(ctx.fx.asof || "") : "reference"} rates.</p>`;
  }
  function forecastCSV() {
    const f = fc.data, cur = ctx.currency, x = v => (v * ctx.fx[cur]).toFixed(2);
    const lines = [["Month", `Partners ${cur}`, `Pipeline ${cur}`, `Turnover ${cur}`, `Low ${cur}`, `High ${cur}`, `Cash-in ${cur}`, ...Object.keys(ctx.markets).map(c => `Market ${c} (local)`)],
      ...f.months.map(m => [m.ym, x(m.partners), x(m.pipeline), x(m.total), x(m.lo), x(m.hi), x(m.cash), ...Object.keys(ctx.markets).map(c => ((m.mk[c] || 0) * ctx.fx[c]).toFixed(2))])];
    download(`forecast-${ctx.today}.csv`, "﻿" + lines.map(l => l.join(",")).join("\r\n"), "text/csv;charset=utf-8");
  }
  function forecastPDF() {
    const f = fc.data, brand = ctx.sim.brand || "Maison Atlas", date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const mk = marketRows(f);
    const body = `<section class="cover" style="height:auto;min-height:0;page-break-after:auto;padding-bottom:4mm">
      <div><div class="brand">${esc(brand)} · Revenue &amp; cash-flow forecast</div><div class="rule"></div></div>
      <div><div class="eyebrow">Board briefing · ${monthLabel(f.months[0].ym)} – ${monthLabel(f.months[5].ym)}</div><h1 style="font-size:30pt">Six-month <em>outlook.</em></h1>
      <div class="kpis gold"><div><span>Turnover</span><b>${ctx.money(f.total)}</b></div><div><span>Range</span><b style="font-size:11pt">${ctx.short(f.lo)} – ${ctx.short(f.hi)}</b></div><div><span>Cash-in</span><b>${ctx.money(f.cash)}</b></div><div><span>Partner share</span><b>${f.total ? Math.round(f.partners / f.total * 100) : 0} %</b></div></div></div></section>
      ${chartSVG(f, true)}
      <p class="meta">Gold = partner reorders · dashed = weighted pipeline · line = cash-in · whiskers = confidence range. Figures in ${ctx.currency}.</p>
      <h3>Month by month</h3><table><tr><th>Month</th><th class="r">Partners</th><th class="r">Pipeline</th><th class="r">Turnover</th><th class="r">Cash-in</th></tr>
      ${f.months.map(m => `<tr><td>${monthLabel(m.ym)}</td><td class="r">${ctx.money(m.partners)}</td><td class="r">${ctx.money(m.pipeline)}</td><td class="r"><b>${ctx.money(m.total)}</b></td><td class="r">${ctx.money(m.cash)}</td></tr>`).join("")}</table>
      <h3>By market</h3><table><tr><th>Market</th><th class="r">Partners</th><th class="r">Local currency</th><th class="r">${ctx.currency}</th></tr>
      ${mk.filter(m => m.eur).map(m => `<tr><td>${esc(m.c)} · ${esc(m.name)}</td><td class="r">${m.doors}</td><td class="r">${ctx.local(m.local, m.c)}</td><td class="r">${ctx.money(m.eur)}</td></tr>`).join("")}</table>
      <h3>Top accounts</h3><table><tr><th>Account</th><th>City</th><th class="r">Run-rate / mo</th><th class="r">Trend</th><th class="r">6-month</th></tr>
      ${f.accounts.slice(0, 15).map(a => `<tr><td>${esc(a.r.name)}</td><td>${esc(a.r.city)}</td><td class="r">${ctx.money(a.base)}</td><td class="r">${a.trend === 1 ? "flat" : (a.trend > 1 ? "+" : "−") + Math.abs(Math.round((a.trend - 1) * 100)) + " %"}</td><td class="r">${ctx.money(a.six)}</td></tr>`).join("")}</table>
      <p class="meta">Method: deseasonalised 12-month invoice run-rate × seasonality × damped velocity trend × regional shift; pipeline weighted by stage probability. Editorial seasonal and regional indices; ${f.accounts.some(a => ctx.isDemo(a.r)) ? "includes the illustrative demo ledger." : "based on the live ledger."}</p>
      <div class="foot"><span>${esc(brand)} · Forecast</span><span>Confidential · ${date} · figures in ${ctx.currency}</span></div>`;
    ctx.toast("Preparing PDF · choose “Save as PDF”");
    Intel.printDocument(`${brand} — Six-month forecast`, body);
  }
  function openForecast() {
    if (!fc) {
      fc = sheetDialog("mx-forecast", "Cash-flow &amp; revenue engine", "Six-month forecast");
      fc.foot.innerHTML = `<button class="btn gold" data-f="pdf">Board PDF</button><button class="btn" data-f="csv">Export CSV</button><span class="sub">Reprices live with € / CHF / £</span>`;
      fc.foot.addEventListener("click", e => { const a = e.target.closest("[data-f]")?.dataset.f; if (a === "pdf") forecastPDF(); else if (a === "csv") forecastCSV(); });
      fc.body.addEventListener("click", e => {
        const s = e.target.closest("[data-fscope]");
        if (s) { fcScope = s.dataset.fscope; renderForecast(); return; }
        const r = e.target.closest("[data-fc-focus]");
        if (r) { fc.close(); ctx.focus(+r.dataset.fcFocus); }
      });
      document.addEventListener("currency:change", () => fc.el.open && renderForecast());
    }
    fc.open();
    renderForecast();
  }

  // ———————————————————————————————— 2 · Legal agreement / NDA generator
  const LEGAL_KEY = "atlas-legal-v1";
  const LAW = {
    FR: ["French law", "the Commercial Court of Paris (Tribunal des activités économiques de Paris)"],
    BE: ["Belgian law", "the Enterprise Court of Brussels"],
    NL: ["Dutch law", "the District Court of Amsterdam"],
    DE: ["German law", "the Regional Court of Frankfurt am Main (Chamber for Commercial Matters)"],
    LU: ["Luxembourg law", "the District Court of Luxembourg"],
    CH: ["Swiss law (Code of Obligations)", "the Commercial Court of the Canton of Zurich"],
  };
  const KINDS = {
    exclusive: "Exclusive Territorial Distribution Agreement",
    selective: "Selective Distribution Agreement",
    nda: "Mutual Non-Disclosure Agreement",
  };
  let ct = null, ctId = null;
  const legal = () => ({ entity: ctx.sim.brand || "Maison Atlas", address: "", signer: "", title: "Founder", term: 24, terms: 30, ...store.get(LEGAL_KEY, {}) });
  const contractNo = r => {
    let h = 0;
    for (const ch of r.crm_key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `MA-${ctx.today.slice(0, 4)}-${r.country}-${(h % 100000).toString().padStart(5, "0")}`;
  };
  function readContract() {
    const f = ct.body.querySelector("form").elements;
    return { kind: f.kind.value, entity: f.entity.value.trim() || "Maison Atlas", address: f.address.value.trim(), signer: f.signer.value.trim(),
      title: f.title.value.trim(), term: Math.max(1, +f.term.value || 24), terms: Math.max(0, +f.terms.value || 30),
      radius: Math.max(.1, +f.radius.value || ctx.zoneKm), law: f.law.value, start: f.start.value || ctx.today };
  }
  function neighbours(r, km) {
    return ctx.data.filter(p => p.id !== r.id && isProtected(p)).map(p => ({ p, km: Intel.km(r, p) })).filter(x => x.km <= km).sort((a, b) => a.km - b.km);
  }
  function contractSummary() {
    const r = ctx.byId(ctId), o = readContract(), L = ctx.priceOf(r), near = neighbours(r, o.radius);
    const s = ct.body.querySelector("[data-csum]");
    s.innerHTML = o.kind === "nda"
      ? `<b>${esc(KINDS.nda)}</b> between ${esc(o.entity)} and ${esc(r.name)} · ${o.term} months · ${esc(LAW[o.law][0])}.`
      : `<b>${esc(KINDS[o.kind])}</b> · wholesale ${ctx.local(L.wholesale, L.c, 2)} HT per unit · MOQ ${ctx.moqFor(r)} units · net ${o.terms} days · ${o.term} months${
        o.kind === "exclusive" ? ` · exclusive radius <b>${o.radius} km</b> around ${esc(r.full_address.split(",")[0])}${near.length ? ` · <span style="color:var(--warn)">${near.length} existing partner${near.length > 1 ? "s" : ""} inside (carved out)</span>` : ""}` : ""}.`;
  }
  function openContract(id) {
    const r = ctx.byId(id);
    if (!r) return;
    ctId = id;
    if (!ct) {
      ct = sheetDialog("mx-contract", "Legal · agreement generator", "");
      ct.foot.innerHTML = `<button class="btn gold" data-c="pdf">Generate PDF</button><span class="sub">Template for counsel review — not legal advice</span>`;
      ct.foot.addEventListener("click", e => e.target.closest("[data-c=pdf]") && contractPDF());
      ct.body.addEventListener("input", () => {
        const o = readContract();
        store.set(LEGAL_KEY, { entity: o.entity, address: o.address, signer: o.signer, title: o.title, term: o.term, terms: o.terms });
        contractSummary();
      });
    }
    const g = legal(), P = isProtected(r);
    ct.title(r.name);
    ct.sub.textContent = `${r.full_address} · ${r.pipeline_status}`;
    ct.body.innerHTML = `<form class="mx-form" onsubmit="return false">
      <label class="wide">Agreement<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${k === (P ? "exclusive" : "nda") ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Supplier legal entity<input name="entity" value="${esc(g.entity)}" autocomplete="organization"></label>
      <label>Supplier registered address<input name="address" value="${esc(g.address)}" placeholder="Street, postcode, city, country" autocomplete="street-address"></label>
      <label>Supplier signatory<input name="signer" value="${esc(g.signer)}" placeholder="Full name" autocomplete="name"></label>
      <label>Signatory title<input name="title" value="${esc(g.title)}"></label>
      <label>Effective date<input name="start" type="date" value="${ctx.today}"></label>
      <label>Term (months)<input name="term" type="number" min="1" step="1" value="${g.term}" inputmode="numeric"></label>
      <label>Payment terms (days net)<input name="terms" type="number" min="0" step="1" value="${g.terms}" inputmode="numeric"></label>
      <label>Exclusive radius (km)<input name="radius" type="number" min="0.1" step="0.1" value="${ctx.zoneKm}" inputmode="decimal"></label>
      <label class="wide">Governing law &amp; venue<select name="law">${Object.entries(LAW).map(([k, v]) => `<option value="${k}"${k === r.country ? " selected" : ""}>${v[0]} · ${v[1]}</option>`).join("")}</select></label>
    </form>
    <div class="mx-sum" data-csum></div>
    <p class="mx-note">Pre-filled from the CRM: store identity and address, decision maker (${esc(r.decision_maker_role)}), the ${esc(ctx.priceOf(r).c)} price list, MOQ and exclusivity radius. Territorial clauses follow Regulation (EU) 2022/720 (VBER) and Art. 5 Swiss Cartel Act: active sales into the territory are restricted, passive and online sales are not; resale prices stay recommended only.</p>`;
    contractSummary();
    ct.open();
  }
  function contractPDF() {
    const r = ctx.byId(ctId), o = readContract(), L = ctx.priceOf(r), p = ctx.msrpFor(r), moq = ctx.moqFor(r), no = contractNo(r);
    const [law, venue] = LAW[o.law], eu = o.law !== "CH", near = neighbours(r, o.radius);
    const date = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const sup = `<b>${esc(o.entity)}</b>${o.address ? `, ${esc(o.address)}` : ""} (the “Supplier”)`;
    const ret = `<b>${esc(r.name)}</b>, ${esc(r.full_address)} (the “${o.kind === "nda" ? "Recipient" : "Retailer"}”)`;
    const sig = `<div class="two" style="margin-top:12mm">
      <div><div class="eyebrow">For the Supplier</div><div style="height:22mm;border-bottom:.6pt solid #1b1a17"></div><p class="meta">${esc(o.signer || "Name")} · ${esc(o.title)}<br>Date and place</p></div>
      <div><div class="eyebrow">For ${esc(r.name)}</div><div style="height:22mm;border-bottom:.6pt solid #1b1a17"></div><p class="meta">Name · ${esc(r.decision_maker_role)}<br>Date and place</p></div></div>`;
    const art = (n, t, body) => `<h3>Article ${n} · ${t}</h3>${body}`;
    const late = eu
      ? "Late payments bear interest at the European Central Bank reference rate plus eight percentage points, and a fixed recovery compensation of EUR 40 per invoice, in accordance with Directive 2011/7/EU as implemented in the governing law."
      : "Late payments bear default interest at 5 % per annum (Art. 104 Swiss Code of Obligations) from the due date without further notice.";
    const incoterm = L.c === "EUR"
      ? "Deliveries are made DAP (Incoterms® 2020) at the Premises. Intra-EU supplies between VAT-registered businesses are invoiced under the reverse-charge mechanism where applicable."
      : `Deliveries are made DAP (Incoterms® 2020) at the Premises. The Retailer acts as importer of record and bears import VAT (${L.m.vat} %); the Supplier states the preferential origin of the Products on each invoice. ${esc(L.m.duty)}`;
    let articles;
    if (o.kind === "nda") {
      articles = [
        art(1, "Purpose", `<p>The parties wish to evaluate a distribution relationship for the Supplier's fragrances at the Retailer's premises (the “Purpose”) and will exchange information for that Purpose only.</p>`),
        art(2, "Confidential information", `<p>“Confidential Information” means any non-public information disclosed by either party, in any form, including formulas, product launches, price lists, margins, sell-through data, customer data, supplier terms and business plans. It excludes information that is or becomes public through no breach, was lawfully known to the recipient before disclosure, is independently developed, or is received from a third party without duty of confidence.</p>`),
        art(3, "Obligations", `<p>Each party shall (a) use the other's Confidential Information solely for the Purpose; (b) disclose it only to employees and advisers who need to know it and are bound by equivalent obligations; (c) protect it with at least reasonable care; (d) not reverse-engineer any sample, tester or formula. Disclosure required by law is permitted after prompt notice to the disclosing party where lawful.</p>`),
        art(4, "Samples &amp; testers", `<p>Discovery sets and testers remain the Supplier's property, are provided for evaluation and in-store sampling only, and may not be resold.</p>`),
        art(5, "Term &amp; return", `<p>This Agreement starts on ${date(o.start)} and lasts ${o.term} months; confidentiality obligations survive for three (3) years after its end. On request, each party returns or destroys the other's Confidential Information, save for copies kept under mandatory retention rules.</p>`),
        art(6, "No licence, no obligation", `<p>No licence to any trade mark, patent or know-how is granted. Neither party is obliged to enter into a distribution agreement.</p>`),
        art(7, "Data protection", `<p>Personal data exchanged is processed in accordance with ${eu ? "Regulation (EU) 2016/679 (GDPR)" : "the Swiss Federal Act on Data Protection (revFADP)"}.</p>`),
        art(8, "Governing law &amp; jurisdiction", `<p>This Agreement is governed by ${esc(law)}. The exclusive venue is ${esc(venue)}.</p>`),
      ];
    } else {
      const excl = o.kind === "exclusive";
      articles = [
        art(1, "Appointment", `<p>The Supplier appoints the Retailer as ${excl ? "its <b>exclusive</b>" : "an <b>authorised selective</b>"} retailer of the Products at ${esc(r.full_address)} (the “Premises”). The Retailer accepts and shall sell the Products only to end consumers and to other authorised retailers of the Supplier's selective network.</p>`),
        art(2, "Products", `<p>The Supplier's fragrance collection${ctx.sim.scent ? `, including <b>${esc(ctx.sim.scent)}</b>` : ""}, as listed in the price list in force (the “Products”). The Supplier may add or discontinue references with 60 days' notice.</p>`),
        art(3, "Territory", excl ? `<p>The Territory is the area within a radius of <b>${o.radius} km</b> of the Premises${r.district ? ` (${esc(r.district)}, ${esc(r.city)})` : ` (${esc(r.city)})`}. During the term the Supplier shall not appoint another retailer with a physical point of sale in the Territory and shall not actively sell the Products to retailers located there.${
            near.length ? ` Existing authorised retailers already located in the Territory are carved out and keep their rights: ${near.map(x => `${esc(x.p.name)} (${x.km.toFixed(1)} km)`).join("; ")}.` : ""}</p>
            <p>In accordance with ${eu ? "Article 4(b) of Regulation (EU) 2022/720" : "Article 5(4) of the Swiss Cartel Act"}, nothing in this Agreement restricts passive sales, including online sales, by any retailer to customers located in the Territory, nor the Retailer's freedom to respond to unsolicited orders from outside it.</p>`
          : `<p>No exclusivity is granted. The Supplier operates a selective distribution system based on the qualitative criteria of Article 6.</p>`),
        art(4, "Prices &amp; minimum order", `<p>Products are invoiced at the Supplier's ${esc(L.m.name)} wholesale price list in ${esc(L.c)}, currently <b>${ctx.local(L.wholesale, L.c, 2)} excluding VAT</b> per unit of the hero reference. The recommended retail price is ${ctx.local(p.v, p.c)} including ${p.vat} % VAT; it is <b>non-binding</b> and the Retailer remains free to set its own resale prices.</p>
          <p>The opening order is <b>${moq} units</b> (${ctx.local(moq * L.wholesale, L.c)} excluding VAT); reorders are placed in case packs of ${ctx.sim.pack} units. Price list changes take effect 60 days after written notice.</p>`),
        art(5, "Orders &amp; delivery", `<p>${incoterm} Title passes on full payment; risk passes on delivery. Shortages or visible damage must be reported within 5 business days of delivery.</p>`),
        art(6, "Selective criteria &amp; brand presentation", `<p>The Retailer shall (a) present the Products in a setting consistent with their prestige, with at least one tester available; (b) ensure that sales staff receive the Supplier's product training; (c) not sell the Products through third-party online marketplaces visibly operated by a third party (CJEU C-230/16, Coty), sales from its own website remaining free; (d) not sell to resellers outside the Supplier's authorised network.</p>`),
        art(7, "Payment", `<p>Invoices are payable <b>${o.terms} days net</b> from invoice date by bank transfer${L.c !== "EUR" ? ` in ${esc(L.c)}` : ""}. ${late} The Supplier may suspend deliveries while any invoice is more than 30 days overdue.</p>`),
        art(8, "Marketing &amp; intellectual property", `<p>The Supplier grants the Retailer a non-exclusive, royalty-free right to use its trade marks and visuals solely to promote the Products at the Premises and on the Retailer's own channels. All rights remain with the Supplier.</p>`),
        art(9, "Confidentiality", `<p>Each party keeps confidential the other's non-public information, including this Agreement's commercial terms, price lists, sell-through data and launch plans, during the term and for three (3) years after it.</p>`),
        art(10, "Term &amp; termination", `<p>This Agreement starts on ${date(o.start)} for an initial term of ${o.term} months and renews for successive 12-month periods unless either party gives three (3) months' written notice before expiry. Either party may terminate with immediate effect upon a material breach not cured within 30 days of notice. On termination the Supplier may buy back saleable stock at the invoiced price.</p>`),
        art(11, "Governing law &amp; jurisdiction", `<p>This Agreement is governed by ${esc(law)}, excluding the UN Convention on Contracts for the International Sale of Goods (CISG). The exclusive venue is ${esc(venue)}.</p>`),
      ];
    }
    const body = `<section class="cover">
      <div><div class="brand">${esc(o.entity)} · ${o.kind === "nda" ? "Confidential" : "Distribution"}</div><div class="rule"></div></div>
      <div><div class="eyebrow">Agreement ${esc(no)}</div><h1>${esc(KINDS[o.kind]).replace(/ (Agreement)$/, "<br><em>$1.</em>")}</h1>
        <p class="lede">Between ${sup}<br>and ${ret}.</p>
        ${o.kind === "nda" ? `<div class="kpis gold"><div><span>Effective</span><b style="font-size:11pt">${date(o.start)}</b></div><div><span>Term</span><b>${o.term} mo</b></div><div><span>Survival</span><b>3 yrs</b></div><div><span>Law</span><b style="font-size:10pt">${esc(law)}</b></div></div>`
          : `<div class="kpis gold"><div><span>Territory</span><b style="font-size:12pt">${o.kind === "exclusive" ? o.radius + " km" : "Selective"}</b></div><div><span>Wholesale HT</span><b style="font-size:12pt">${ctx.local(L.wholesale, L.c, 2)}</b></div><div><span>Opening order</span><b style="font-size:12pt">${moq} u.</b></div><div><span>Payment</span><b style="font-size:12pt">Net ${o.terms}</b></div></div>`}</div>
      <div class="meta">Effective ${date(o.start)} · ${o.term}-month term · ${esc(law)} · CRM ref. ${esc(r.crm_key)}</div></section>
      ${articles.join("")}
      <p class="meta" style="margin-top:6mm">Made in two originals${o.kind === "nda" ? "" : ". Annex 1: price list in force · Annex 2: territory map and carve-outs"}. Template generated from the Supplier's CRM; both parties should obtain independent legal advice before signature.</p>
      ${sig}
      <div class="foot"><span>${esc(o.entity)} · ${esc(no)}</span><span>Confidential · ${esc(r.name)}</span></div>`;
    ctx.toast("Preparing agreement · choose “Save as PDF”");
    Intel.printDocument(`${KINDS[o.kind]} — ${r.name}`, body);
  }

  // ———————————————————————————————— 3 · Webhook & integration center
  // mapEvent / applyOps are the single source of the mapping: the app runs them for replay and pull,
  // and the downloadable worker embeds their source verbatim (Function.prototype.toString).
  function mapEvent(evt, topic, fx) {
    const day = v => !v ? null : typeof v === "number" ? new Date(v * 1000).toISOString().slice(0, 10) : String(v).slice(0, 10);
    const plus = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
    const eur = (v, c) => Math.round(v / ((fx && fx[String(c || "EUR").toUpperCase()]) || 1) * 100) / 100;
    if (evt && evt.object === "event" && evt.type) {
      const o = (evt.data && evt.data.object) || {}, key = (o.metadata && o.metadata.crm_key) || null;
      const C = String(o.currency || "eur").toUpperCase();
      if (evt.type === "invoice.finalized" || evt.type === "invoice.paid") {
        const date = day(o.created) || day(evt.created);
        const inv = { kind: "invoice", no: o.number || o.id, date, due: day(o.due_date) || plus(date, 30), amount: eur((o.subtotal_excluding_tax ?? o.subtotal ?? o.amount_due) / 100, C), status: evt.type === "invoice.paid" ? "Paid" : "Pending" };
        return { source: "stripe", type: evt.type, crm_key: key, ops: evt.type === "invoice.paid" ? [inv, { kind: "paid", no: inv.no }] : [inv] };
      }
      if (evt.type === "checkout.session.completed") {
        const date = day(o.created) || day(evt.created);
        return { source: "stripe", type: evt.type, crm_key: key, ops: [{ kind: "invoice", no: o.invoice || "CS-" + String(o.id || "").slice(-10), date, due: date,
          amount: eur((o.amount_subtotal ?? o.amount_total) / 100, C), status: o.payment_status === "paid" ? "Paid" : "Pending" }] };
      }
      if (evt.type === "invoice.payment_failed") return { source: "stripe", type: evt.type, crm_key: key, ops: [], note: `Payment failed on ${o.number || o.id}: dunning starts, invoice stays pending.` };
      return { source: "stripe", type: evt.type, crm_key: key, ops: [], note: "Event type not mapped to the ledger." };
    }
    const o = evt && evt.payload ? evt.payload : evt, t = (evt && evt.topic) || topic || "";
    if (!o || typeof o !== "object") return null;
    const attrs = Object.fromEntries((o.note_attributes || []).map(a => [a.name, a.value]));
    const tag = String(o.tags || "").split(",").map(s => s.trim()).find(s => s.startsWith("crm:"));
    const key = attrs.crm_key || (tag ? tag.slice(4) : null) || (o.company && o.company.external_id) || o.external_id || null;
    const C = o.currency || o.presentment_currency || "EUR", date = day(o.created_at) || day(new Date().toISOString());
    const sched = o.payment_terms && o.payment_terms.payment_schedules && o.payment_terms.payment_schedules[0];
    if (t === "orders/create" || t === "orders/paid") {
      const inv = { kind: "invoice", no: o.name || String(o.id), date, due: day(sched && sched.due_at) || plus(date, 30),
        amount: eur(+(o.subtotal_price ?? o.total_price ?? 0), C), status: t === "orders/paid" || o.financial_status === "paid" ? "Paid" : "Pending" };
      return { source: "shopify", type: t, crm_key: key, ops: t === "orders/paid" ? [inv, { kind: "paid", no: inv.no }] : [inv] };
    }
    if (t === "orders/fulfilled" || t === "fulfillments/create") {
      const items = o.line_items || [];
      return { source: "shopify", type: t, crm_key: key, ops: items.map(li => ({ kind: "delivery", date: day(o.updated_at) || date, ref: o.name || String(o.order_id || o.id), sku: li.sku || li.title || li.name, units: +li.quantity || 0 })).filter(d => d.units > 0) };
    }
    if (t === "companies/create") return { source: "shopify", type: t, crm_key: key, ops: [], note: `Company ${o.name || o.id} created: set external_id = crm_key to link it.` };
    return { source: "shopify", type: t || "unknown", crm_key: key, ops: [], note: "Topic not mapped to the ledger." };
  }
  // Idempotent merge into a ledger {since, deliveries[], invoices[]}: deliveries by ref + sku, invoices by number
  function applyOps(l, ops) {
    let n = 0;
    ops.forEach(op => {
      if (op.kind === "delivery") {
        if (l.deliveries.some(d => d.ref === op.ref && d.sku === op.sku)) return;
        l.deliveries.push({ date: op.date, ref: op.ref, sku: op.sku, units: op.units }); n++;
      } else if (op.kind === "invoice") {
        const i = l.invoices.find(x => x.no === op.no);
        if (i) { if (op.status === "Paid" && i.status !== "Paid") { i.status = "Paid"; n++; } return; }
        l.invoices.push({ no: op.no, date: op.date, due: op.due, amount: op.amount, status: op.status }); n++;
      } else if (op.kind === "paid") {
        const i = l.invoices.find(x => x.no === op.no);
        if (i && i.status !== "Paid") { i.status = "Paid"; n++; }
      }
    });
    if (!l.since) l.since = [...l.deliveries.map(d => d.date), ...l.invoices.map(i => i.date)].sort()[0] || null;
    return n;
  }

  const INT_KEY = "atlas-integrations-v1";
  let ic = null, icTab = "endpoints";
  const icCfg = () => ({ base: "https://atlas-sync.your-team.workers.dev", token: "", ...store.get(INT_KEY, {}) });
  const ENDPOINTS = () => {
    const b = icCfg().base.replace(/\/+$/, "");
    return [
      { verb: "POST", url: b + "/webhooks/shopify", title: "Shopify B2B", auth: "X-Shopify-Hmac-Sha256 (HMAC-SHA256, base64, app secret)",
        topics: ["orders/create", "orders/paid", "orders/fulfilled", "companies/create"],
        link: "Link a company to Atlas: Company.externalId = crm_key, or order note attribute crm_key, or tag crm:<key>." },
      { verb: "POST", url: b + "/webhooks/stripe", title: "Stripe checkout & invoicing", auth: "Stripe-Signature (t=…, v1=HMAC-SHA256 hex, 5-minute tolerance)",
        topics: ["checkout.session.completed", "invoice.finalized", "invoice.paid", "invoice.payment_failed"],
        link: "Link a payment to Atlas: metadata.crm_key on the Checkout Session or Invoice." },
      { verb: "GET", url: b + "/ledger", title: "Ledger feed for this app", auth: "Authorization: Bearer <ATLAS_TOKEN>",
        topics: ["wholesale.json schema"], link: "“Pull ledger” merges it into the partner drawers (idempotent)." },
    ];
  };
  function samplePartner() {
    return ctx.data.find(r => isProtected(r) && ctx.marketOf(r) === "CHF") || ctx.data.find(isProtected) || ctx.data[0];
  }
  function samples() {
    const r = samplePartner(), L = ctx.priceOf(r), c = L.c, moq = ctx.moqFor(r), unit = +L.wholesale.toFixed(2), sub = +(unit * moq).toFixed(2);
    const now = Math.floor(Date.now() / 1000), iso = new Date().toISOString();
    const due = new Date(Date.now() + 30 * 864e5).toISOString();
    const sku = ctx.sim.scent || "Extrait 50 ml";
    return {
      "orders/create": { topic: "orders/create", payload: { id: 5300000000001, name: "#B2B1042", created_at: iso, currency: c, subtotal_price: String(sub), total_tax: "0.00", total_price: String(sub),
        financial_status: "pending", company: { id: 7340032, location_id: 7340033, external_id: r.crm_key }, note_attributes: [{ name: "crm_key", value: r.crm_key }],
        payment_terms: { payment_terms_name: "Net 30", payment_schedules: [{ due_at: due }] }, line_items: [{ sku, title: sku, quantity: moq, price: String(unit) }] } },
      "orders/fulfilled": { topic: "orders/fulfilled", payload: { id: 5300000000001, name: "#B2B1042", updated_at: iso, currency: c, note_attributes: [{ name: "crm_key", value: r.crm_key }],
        line_items: [{ sku, title: sku, quantity: moq }] } },
      "invoice.paid": { id: "evt_1Q0atlas", object: "event", type: "invoice.paid", created: now, data: { object: { id: "in_1Q0atlas", object: "invoice", number: "MA-0042",
        currency: c.toLowerCase(), subtotal_excluding_tax: Math.round(sub * 100), amount_due: Math.round(sub * 100), created: now, due_date: now + 30 * 86400, status: "paid", metadata: { crm_key: r.crm_key } } } },
      "checkout.session.completed": { id: "evt_1Q0atlas_cs", object: "event", type: "checkout.session.completed", created: now, data: { object: { id: "cs_live_a1b2c3d4e5", object: "checkout.session",
        mode: "payment", currency: c.toLowerCase(), amount_subtotal: Math.round(sub * 100), amount_total: Math.round(sub * 100), payment_status: "paid", invoice: null, created: now, metadata: { crm_key: r.crm_key } } } },
    };
  }
  function shopifyCompanies() {
    const P = ctx.data.filter(isProtected);
    return { _doc: "Shopify Admin GraphQL companyCreate inputs (B2B). One mutation per entry: mutation($input: CompanyCreateInput!) { companyCreate(input: $input) { company { id } userErrors { message } } }",
      companies: P.map(r => {
        const L = ctx.priceOf(r), [street, ...rest] = r.full_address.split(",");
        return { input: { company: { name: r.name, externalId: r.crm_key, note: `${r.segment} · ${r.pipeline_status}` },
          companyLocation: { name: r.district || r.city, externalId: r.crm_key, billingSameAsShipping: true, locale: r.country === "DE" ? "de" : r.country === "NL" ? "nl" : "fr",
            shippingAddress: { address1: street.trim(), city: r.city, zip: r.postcode || "", countryCode: r.country, recipient: r.name },
            buyerExperienceConfiguration: { paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/4", checkoutToDraft: false } } },
          catalog: { currency: L.c, wholesale_unit: +L.wholesale.toFixed(2), moq_units: ctx.moqFor(r), case_pack: ctx.sim.pack } };
      }) };
  }
  function stripeCatalog() {
    const name = `${ctx.sim.brand || "Maison Atlas"} — ${ctx.sim.scent || "Hero SKU"}`;
    return { _doc: "POST /v1/products then one POST /v1/prices per entry (unit_amount in minor units, tax_behavior exclusive for B2B).",
      product: { name, metadata: { source: "maison-atlas" } },
      prices: Object.values(ctx.lists).map(L => ({ currency: L.c.toLowerCase(), unit_amount: Math.round(L.wholesale * 100), tax_behavior: "exclusive",
        lookup_key: `wholesale_${L.c.toLowerCase()}`, nickname: `Wholesale ${L.m.name}`, metadata: { moq_units: String(L.moq), case_pack: String(ctx.sim.pack) } })) };
  }
  function workerScript() {
    const fx = { EUR: 1, CHF: +ctx.fx.CHF.toFixed(4), GBP: +ctx.fx.GBP.toFixed(4) };
    return `// atlas-sync-worker.js — Maison Atlas integration endpoint (Cloudflare Workers, ES modules)
// Receives Shopify B2B and Stripe webhooks, verifies their signatures, maps them onto the wholesale
// ledger (sources/wholesale.json schema) in KV, and serves it to the Atlas app (“Pull ledger”).
//
// wrangler.toml:
//   name = "atlas-sync"
//   main = "atlas-sync-worker.js"
//   compatibility_date = "2026-01-01"
//   kv_namespaces = [{ binding = "ATLAS", id = "<kv-namespace-id>" }]
// Secrets:  wrangler secret put SHOPIFY_WEBHOOK_SECRET · STRIPE_WEBHOOK_SECRET · ATLAS_TOKEN
// Shopify:  Settings → Notifications → Webhooks (or app webhook subscriptions), format JSON, URL …/webhooks/shopify
// Stripe:   Developers → Webhooks → endpoint …/webhooks/stripe, events listed in the Atlas integration center
// KV is last-writer-wins: fine for a boutique wholesale volume; use a Durable Object for high concurrency.

const FX = ${JSON.stringify(fx)};   // EUR per-unit rates at export time; ledger amounts are stored in EUR

${mapEvent.toString()}

${applyOps.toString()}

const enc = new TextEncoder();
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function equal(a, b) {                         // constant-time comparison
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const b64 = u => btoa(String.fromCharCode(...u));
const hex = u => [...u].map(x => x.toString(16).padStart(2, "0")).join("");

async function verifyShopify(req, body, secret) {
  const sig = req.headers.get("X-Shopify-Hmac-Sha256") || "";
  return equal(b64(await hmac(secret, body)), sig);
}
async function verifyStripe(req, body, secret) {
  const parts = Object.fromEntries((req.headers.get("Stripe-Signature") || "").split(",").map(kv => kv.split("=")));
  const t = +parts.t;
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const v1 = (req.headers.get("Stripe-Signature") || "").split(",").filter(kv => kv.startsWith("v1=")).map(kv => kv.slice(3));
  const expected = hex(await hmac(secret, t + "." + body));
  return v1.some(s => equal(expected, s));
}

async function ingest(env, mapped) {
  if (!mapped || !mapped.crm_key || !mapped.ops.length) return { applied: 0, note: mapped && (mapped.note || (!mapped.crm_key ? "No crm_key on the event." : "Nothing to apply.")) };
  const ledger = (await env.ATLAS.get("ledger", "json")) || { demo: false, currency: "EUR", accounts: {} };
  const acc = ledger.accounts[mapped.crm_key] ||= { since: null, deliveries: [], invoices: [] };
  const applied = applyOps(acc, mapped.ops);
  ledger.updated = new Date().toISOString();
  await env.ATLAS.put("ledger", JSON.stringify(ledger));
  return { applied, crm_key: mapped.crm_key };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method === "GET" && url.pathname === "/ledger") {
      if (!equal(req.headers.get("Authorization") || "", "Bearer " + env.ATLAS_TOKEN)) return json({ error: "unauthorized" }, 401);
      return json((await env.ATLAS.get("ledger", "json")) || { demo: false, currency: "EUR", accounts: {} });
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404);
    const body = await req.text();
    if (url.pathname === "/webhooks/shopify") {
      if (!(await verifyShopify(req, body, env.SHOPIFY_WEBHOOK_SECRET))) return json({ error: "bad signature" }, 401);
      return json(await ingest(env, mapEvent(JSON.parse(body), req.headers.get("X-Shopify-Topic"), FX)));
    }
    if (url.pathname === "/webhooks/stripe") {
      if (!(await verifyStripe(req, body, env.STRIPE_WEBHOOK_SECRET))) return json({ error: "bad signature" }, 400);
      return json(await ingest(env, mapEvent(JSON.parse(body), null, FX)));
    }
    return json({ error: "not found" }, 404);
  },
};
`;
  }
  const keyIndex = () => new Map(ctx.data.map(r => [r.crm_key, r]));
  function renderIC() {
    const cfg = icCfg(), tabs = [["endpoints", "Endpoints"], ["payloads", "Payloads"], ["script", "Sync script"], ["replay", "Replay & pull"]];
    let html = `<div class="mx-tabs" role="tablist">${tabs.map(([k, l]) => `<button data-ictab="${k}" aria-pressed="${k === icTab}">${l}</button>`).join("")}</div>`;
    if (icTab === "endpoints") {
      html += `<form class="mx-form" onsubmit="return false"><label class="wide">Deployment base URL<input name="base" value="${esc(cfg.base)}" spellcheck="false" autocomplete="url" inputmode="url"></label></form>
        ${ENDPOINTS().map(e => `<div class="mx-ep"><header><span class="mx-verb${e.verb === "GET" ? " get" : ""}">${e.verb}</span><b>${esc(e.title)}</b><button class="btn sm ghost" style="margin-left:auto" data-copy="${esc(e.url)}">Copy URL</button></header>
          <code>${esc(e.url)}</code><div class="tags">${e.topics.map(t => `<span>${esc(t)}</span>`).join("")}</div>
          <p class="mx-note"><b>Auth.</b> ${esc(e.auth)}<br>${esc(e.link)}</p></div>`).join("")}
        <p class="mx-note">Amounts arriving in CHF or GBP are converted to EUR at the rates in force when the worker was exported, so the ledger stays single-currency like sources/wholesale.json. Shopify sends order totals tax-inclusive or exclusive per shop settings; Atlas books subtotal_price (HT for B2B catalogs).</p>`;
    } else if (icTab === "payloads") {
      const s = samples();
      html += `<p class="mx-note">Live samples built from ${esc(samplePartner().name)} and its ${esc(ctx.priceOf(samplePartner()).c)} price list. Paste one into “Replay &amp; pull” to watch the mapping, or POST it to a test endpoint.</p>
        ${Object.entries(s).map(([k, v]) => `<div class="mx-ep"><header><b class="mx-mono">${esc(k)}</b><button class="btn sm ghost" style="margin-left:auto" data-copy-sample="${esc(k)}">Copy</button><button class="btn sm ghost" data-replay-sample="${esc(k)}">Replay</button></header>
          <pre class="mx-pre">${esc(JSON.stringify(v, null, 2))}</pre></div>`).join("")}
        <div class="mx-row"><button class="btn" data-dl="companies">Shopify B2B companies (${ctx.data.filter(isProtected).length})</button><button class="btn" data-dl="stripe">Stripe catalog (${Object.keys(ctx.lists).length} currencies)</button></div>`;
    } else if (icTab === "script") {
      html += `<ol class="mx-steps"><li>Create a KV namespace and paste its id in <span class="mx-mono">wrangler.toml</span> (header of the script).</li>
          <li>Set the three secrets with <span class="mx-mono">wrangler secret put</span>, then <span class="mx-mono">wrangler deploy</span>.</li>
          <li>Register the Shopify and Stripe endpoints from the Endpoints tab; put the same <span class="mx-mono">ATLAS_TOKEN</span> in Replay &amp; pull.</li></ol>
        <pre class="mx-pre" style="max-height:360px">${esc(workerScript())}</pre>
        <div class="mx-row"><button class="btn gold" data-dl="worker">Download atlas-sync-worker.js</button><button class="btn" data-copy-worker>Copy script</button></div>`;
    } else {
      html += `<form class="mx-form" onsubmit="return false"><label>Shopify topic (raw payloads)<select name="topic">${["orders/create", "orders/paid", "orders/fulfilled", "companies/create"].map(t => `<option>${t}</option>`).join("")}</select></label>
          <label>Ledger token (pull)<input name="token" type="password" value="${esc(cfg.token)}" placeholder="ATLAS_TOKEN" autocomplete="off"></label></form>
        <textarea class="mx-code" data-evt spellcheck="false" placeholder='Paste a Stripe event or Shopify payload ({"topic": "...", "payload": {...}} also works)'></textarea>
        <div class="mx-row"><button class="btn" data-ic="preview">Preview mapping</button><button class="btn gold" data-ic="apply" disabled>Apply to ledger</button><button class="btn" data-ic="pull" style="margin-left:auto">Pull ledger from endpoint</button></div>
        <div data-preview></div>`;
    }
    ic.body.innerHTML = html;
  }
  let pending = null;
  function previewEvent() {
    const out = ic.body.querySelector("[data-preview]"), btn = ic.body.querySelector("[data-ic=apply]");
    pending = null; btn.disabled = true;
    let evt;
    try { evt = JSON.parse(ic.body.querySelector("[data-evt]").value); } catch (e) { out.innerHTML = `<p class="mx-note" style="color:var(--bad)">Invalid JSON: ${esc(e.message)}</p>`; return; }
    const m = mapEvent(evt, ic.body.querySelector("[name=topic]").value, ctx.fx);
    const r = m && m.crm_key ? keyIndex().get(m.crm_key) : null;
    if (!m) { out.innerHTML = `<p class="mx-note">Not a recognised event.</p>`; return; }
    const line = op => op.kind === "delivery" ? `<div><em>Delivery</em>${op.units} × ${esc(op.sku)} · ${esc(op.ref)} · ${esc(op.date)}</div>`
      : op.kind === "invoice" ? `<div><em>Invoice</em>${esc(op.no)} · ${ctx.money(op.amount)} · ${esc(op.date)} → due ${esc(op.due)} · ${esc(op.status)}</div>`
      : `<div><em>Paid</em>${esc(op.no)}</div>`;
    out.innerHTML = `<div class="mx-sum"><b>${esc(m.source)}</b> · ${esc(m.type)} → ${r ? `<b>${esc(r.name)}</b> (${esc(r.pipeline_status)})` : m.crm_key ? `<span style="color:var(--bad)">unknown crm_key ${esc(m.crm_key)}</span>` : `<span style="color:var(--warn)">no crm_key on the event</span>`}${m.note ? `<br>${esc(m.note)}` : ""}</div>
      ${m.ops.length ? `<div class="mx-ops">${m.ops.map(line).join("")}</div>` : ""}`;
    if (r && m.ops.length) { pending = { r, m }; btn.disabled = false; }
  }
  function applyPending() {
    if (!pending) return;
    const { r, m } = pending;
    let n = 0;
    ctx.editLedger(r.id, l => { n = applyOps(l, m.ops); });
    ctx.toast(n ? `${r.name} · ${n} ledger change${n > 1 ? "s" : ""}` : `${r.name} · already up to date`);
    pending = null;
    ic.body.querySelector("[data-ic=apply]").disabled = true;
  }
  async function pullLedger() {
    const cfg = icCfg();
    if (!cfg.token) { ctx.toast("Add the ledger token first"); return; }
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(cfg.base.replace(/\/+$/, "") + "/ledger", { headers: { Authorization: "Bearer " + cfg.token }, signal: ctl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json(), idx = keyIndex();
      let n = 0, skipped = 0;
      Object.entries(j.accounts || {}).forEach(([key, a]) => {
        const r = idx.get(key);
        if (!r) { skipped++; return; }
        const ops = [...(a.deliveries || []).map(d => ({ kind: "delivery", ...d })), ...(a.invoices || []).map(i => ({ kind: "invoice", ...i }))];
        ctx.editLedger(r.id, l => { n += applyOps(l, ops); });
      });
      ctx.toast(`Ledger synced · ${n} change${n === 1 ? "" : "s"}${skipped ? ` · ${skipped} unknown account${skipped > 1 ? "s" : ""}` : ""}`);
    } catch (e) {
      ctx.toast(navigator.onLine ? `Pull failed · ${e.name === "AbortError" ? "timeout" : e.message}` : "Offline · pull when back online");
    } finally { clearTimeout(t); }
  }
  function openIntegrations() {
    if (!ic) {
      ic = sheetDialog("mx-int", "Webhook &amp; integration center", "Shopify B2B · Stripe");
      ic.sub.textContent = "Ready-to-deploy endpoints that keep the wholesale ledger in sync";
      ic.foot.innerHTML = `<span class="sub" style="margin-left:0">Signatures verified server-side · amounts booked in EUR · idempotent by order / invoice number</span>`;
      ic.body.addEventListener("input", e => {
        const f = e.target.name;
        if (f === "base" || f === "token") store.set(INT_KEY, { ...icCfg(), [f]: e.target.value.trim() });
        if (f === "base") ic.body.querySelectorAll(".mx-ep").forEach((el, i) => { const ep = ENDPOINTS()[i]; el.querySelector("code").textContent = ep.url; el.querySelector("[data-copy]").dataset.copy = ep.url; });
        if (e.target.matches("[data-evt]")) { pending = null; const b = ic.body.querySelector("[data-ic=apply]"); if (b) b.disabled = true; }
      });
      ic.body.addEventListener("click", e => {
        const t = e.target.closest("button");
        if (!t) return;
        if (t.dataset.ictab) { icTab = t.dataset.ictab; renderIC(); }
        else if (t.dataset.copy) copy(t.dataset.copy, "URL");
        else if (t.dataset.copySample) copy(JSON.stringify(samples()[t.dataset.copySample], null, 2), "Payload");
        else if (t.dataset.replaySample) {
          const s = samples()[t.dataset.replaySample];
          icTab = "replay"; renderIC();
          ic.body.querySelector("[data-evt]").value = JSON.stringify(s, null, 2);
          previewEvent();
        }
        else if (t.hasAttribute("data-copy-worker")) copy(workerScript(), "Worker script");
        else if (t.dataset.dl === "worker") download("atlas-sync-worker.js", workerScript(), "text/javascript");
        else if (t.dataset.dl === "companies") download("shopify-b2b-companies.json", JSON.stringify(shopifyCompanies(), null, 1) + "\n", "application/json");
        else if (t.dataset.dl === "stripe") download("stripe-catalog.json", JSON.stringify(stripeCatalog(), null, 1) + "\n", "application/json");
        else if (t.dataset.ic === "preview") previewEvent();
        else if (t.dataset.ic === "apply") applyPending();
        else if (t.dataset.ic === "pull") pullLedger();
      });
    }
    renderIC();
    ic.open();
  }

  // ———————————————————————————————— 4 · PWA: service worker, install, offline status
  let installEvt = null, pw = null;
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const iOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const mb = b => b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " kB";
  async function offlineLine() {
    const el = document.getElementById("suite-offline");
    if (!el) return;
    if (!navigator.onLine) { el.textContent = "Offline · working from cache"; return; }
    let size = "";
    try { const e = await navigator.storage?.estimate?.(); if (e?.usage) size = ` · ${mb(e.usage)}`; } catch (e) { /* estimate unsupported */ }
    const ready = navigator.serviceWorker?.controller;
    el.textContent = standalone() ? `Installed${ready ? " · offline ready" : ""}${size}` : ready ? `Offline ready${size}` : "offline for trade shows";
    const b = document.querySelector("#suite-install b");
    if (b) b.textContent = standalone() ? "Offline kit" : "Install app";
  }
  function swMessage(msg) {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) return Promise.resolve(null);
    return new Promise(res => {
      const ch = new MessageChannel(), t = setTimeout(() => res(null), 60000);
      ch.port1.onmessage = e => { clearTimeout(t); res(e.data); };
      sw.postMessage(msg, [ch.port2]);
    });
  }
  async function renderPWA() {
    let est = null, persisted = false;
    try { est = await navigator.storage?.estimate?.(); persisted = await navigator.storage?.persisted?.(); } catch (e) { /* unsupported */ }
    const ready = !!navigator.serviceWorker?.controller;
    const steps = iOS()
      ? `<ol class="mx-steps"><li>Open this page in Safari.</li><li>Tap <b>Share</b> <span class="muted">(square with arrow)</span>.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
      : installEvt ? `<p class="mx-note">This browser can install Maison Atlas as an app: own window, home-screen icon, offline start.</p>`
      : `<ol class="mx-steps"><li>Chrome / Edge: menu <b>⋮</b> → <b>Install Maison Atlas</b> (or the install icon in the address bar).</li><li>Android: menu → <b>Add to Home screen</b>.</li></ol>`;
    const q = est?.quota ? Math.min(100, est.usage / est.quota * 100) : 0;
    pw.body.innerHTML = `
      <div class="mx-kpis"><div class="${ready ? "gold" : ""}"><span>Offline shell</span><b>${ready ? "Ready" : location.protocol.startsWith("http") ? "Starting…" : "Needs https"}</b><small>${ready ? "app + data cached" : "serve over http(s)"}</small></div>
        <div><span>Mode</span><b>${standalone() ? "Installed" : "Browser"}</b><small>${standalone() ? "home-screen app" : "not installed yet"}</small></div>
        <div><span>Cached</span><b>${est?.usage ? mb(est.usage) : "–"}</b><small>${persisted ? "persistent storage" : "best-effort storage"}</small></div>
        <div><span>Network</span><b>${navigator.onLine ? "Online" : "Offline"}</b><small>${navigator.onLine ? "live FX & tiles" : "cached data & tiles"}</small></div></div>
      ${est?.quota ? `<div class="mx-meter" title="${mb(est.usage)} of ${mb(est.quota)}"><i style="width:${q.toFixed(1)}%"></i></div>` : ""}
      ${standalone() ? "" : `<h4 class="eyebrow" style="margin:0">Install</h4>${steps}`}
      <h4 class="eyebrow" style="margin:0">Trade-show kit</h4>
      <p class="mx-note">Caches the app, all ${ctx.data.length} doors, map styles and fonts, then the map tiles for the area on screen (zoom levels up to 3 deeper, ≤ 1 200 tiles). CRM, ledger and sequence edits already live on this device and work without a network; export them once back online.</p>
      <div class="mx-row"><button class="btn gold" data-pw="kit"${ready ? "" : " disabled"}>Prepare offline kit</button>${installEvt && !standalone() ? `<button class="btn" data-pw="install">Install app</button>` : ""}</div>
      <div data-pw-status class="mx-note"></div>`;
  }
  // Basemap tiles covering the view, for the levels a visitor zooms into on the stand
  function tileUrls() {
    const m = ctx.map;
    if (!m) return [];
    const b = m.getBounds(), z0 = Math.max(3, Math.round(m.getZoom())), urls = new Set();
    const tx = (lng, z) => Math.max(0, Math.min(2 ** z - 1, Math.floor((lng + 180) / 360 * 2 ** z)));
    const ty = (lat, z) => { const r = lat * Math.PI / 180; return Math.max(0, Math.min(2 ** z - 1, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z))); };
    ctx.tileTemplates.forEach(t => {
      for (let lz = z0; lz <= z0 + 3; lz++) {
        const z = lz + t.offset;
        if (z < 0 || z > t.max) continue;
        for (let x = tx(b.getWest(), z); x <= tx(b.getEast(), z); x++) for (let y = ty(b.getNorth(), z); y <= ty(b.getSouth(), z); y++) {
          if (urls.size >= 1200) return;
          urls.add(t.url.replace("{z}", z).replace("{x}", x).replace("{y}", y).replace("{s}", "abcd"[(x + y) % 4]));
        }
      }
    });
    return [...urls];
  }
  async function prepareKit() {
    const st = pw.body.querySelector("[data-pw-status]"), btn = pw.body.querySelector("[data-pw=kit]");
    btn.disabled = true; st.textContent = "Caching app shell and data…";
    try { await navigator.storage?.persist?.(); } catch (e) { /* optional */ }
    const tiles = tileUrls();
    const res = await swMessage({ type: "warm", urls: tiles });
    st.textContent = res ? `Offline kit ready · ${res.ok} files cached${res.failed ? ` · ${res.failed} skipped` : ""}.` : "Service worker not ready — reload once, then retry.";
    btn.disabled = false;
    renderPWA().then(() => { const s = pw.body.querySelector("[data-pw-status]"); if (s && res) s.textContent = `Offline kit ready · ${res.ok} files cached${res.failed ? ` · ${res.failed} skipped` : ""}.`; });
    offlineLine();
  }
  async function openPWA() {
    if (installEvt && !standalone() && !pw) {
      installEvt.prompt();
      const { outcome } = await installEvt.userChoice;
      installEvt = null;
      if (outcome === "accepted") { ctx.toast("Maison Atlas installed"); return; }
    }
    if (!pw) {
      pw = sheetDialog("mx-pwa", "App &amp; offline", "Maison Atlas, anywhere");
      pw.sub.textContent = "Home-screen app for iOS and Android · works without a network on the show floor";
      pw.foot.innerHTML = `<span class="sub" style="margin-left:0">Data stays on this device · nothing is uploaded</span>`;
      pw.body.addEventListener("click", async e => {
        const a = e.target.closest("[data-pw]")?.dataset.pw;
        if (a === "kit") prepareKit();
        else if (a === "install" && installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderPWA(); }
      });
    }
    await renderPWA();
    pw.open();
  }
  function initPWA() {
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; offlineLine(); });
    window.addEventListener("appinstalled", () => { installEvt = null; offlineLine(); });
    window.addEventListener("online", () => { offlineLine(); ctx.toast("Back online"); });
    window.addEventListener("offline", () => { offlineLine(); ctx.toast("Offline · working from cache"); });
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").then(reg => {
        navigator.serviceWorker.ready.then(offlineLine);
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          nw?.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) ctx.toast("Update ready · reload to apply"); });
        });
      }).catch(() => { /* private mode / blocked: the app works online as before */ });
      navigator.serviceWorker.addEventListener("controllerchange", offlineLine);
    }
    offlineLine();
  }

  // ———————————————————————————————— Suite bar & wiring
  function pulseLine() {
    const el = document.getElementById("suite-pulse");
    if (!el) return;
    const mi = new Date().getMonth(), win = [1, 2, 3].map(k => MONTHS[(mi + k) % 12]);
    const best = Object.entries(Intel.REGION).sort((a, b) => b[1][0] - a[1][0])[0];
    el.textContent = `window ${win[0]}–${win[2]} · ${best[0]} +${best[1][0]}`;
  }
  function mount() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    document.addEventListener("click", e => {
      const s = e.target.closest("[data-suite]"), c = e.target.closest("[data-contract]");
      if (c) { e.stopPropagation(); openContract(+c.dataset.contract); return; }
      if (!s) return;
      const k = s.dataset.suite;
      if (k === "forecast") openForecast();
      else if (k === "integrations") openIntegrations();
      else if (k === "install") openPWA();
      else if (k === "pulse") document.dispatchEvent(new CustomEvent("sillage:ask", { detail: { chip: "pulse" } }));
    }, true);
    pulseLine();
    initPWA();
  }

  if (window.SillageContext) { ctx = window.SillageContext; mount(); }
  else document.addEventListener("sillage:ready", () => { ctx = window.SillageContext; mount(); }, { once: true });
})();
