# Niche Perfumery Atlas

Interactive map + table of niche perfumeries, independent concept stores and luxury
department stores in **BE, NL, DE, FR, LU, CH**.

## Files
| File | Role |
|---|---|
| `harvest_osm.py` | Network step: harvests stockists from OpenStreetMap into `sources/osm_raw.json` |
| `sources/cities.json` | Cached bounding boxes of the target cities |
| `sources/crm.json` | Optional: pipeline status / decision maker / notes per `crm_key`, exported from the map |
| `sources/wholesale.json` | Wholesale ledger per partner `crm_key`: deliveries + invoices (ships as an illustrative `"demo": true` ledger) |
| `sources/osm_raw.json` | Raw OSM harvest (everything looked at, before filtering) |
| `build_perfumeries.py` | Offline: curated rows + filtered OSM rows → validation → `perfumeries.json` / `.js` |
| `perfumeries.json` | Canonical dataset |
| `perfumeries.js` | Same data as `window.PERFUMERIES` (lets `index.html` open from `file://`) |
| `index.html` | Leaflet (canvas renderer) on OpenFreeMap vector basemaps (MapLibre GL) + Tabulator app |
| `intelligence.js` | Predictive engines: restock & sell-through velocity, territory cannibalization guard, market pulse, 6-month cash-flow forecast, print-grade PDF renderer |
| `modules.js` | Platform modules: revenue forecast panel, legal agreement / NDA generator, webhook & integration center, PWA install + offline kit |
| `ai_assistant.js` | Sillage AI: built-in analytics (pulse-adjusted scores) + optional Anthropic / OpenAI engine |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable PWA: service worker (app shell, libraries, map tiles), manifest, iOS / Android icons |

## Usage
```bash
python3 harvest_osm.py         # refresh OSM data (slow: Overpass + Photon + Nominatim rate limits)
python3 harvest_osm.py photon-cities reverse   # Overpass down: Photon-only refresh
python3 build_perfumeries.py   # rebuild after editing RAW or the harvest
open index.html                # or: python3 -m http.server
```

## Pipeline
1. **Curated** (`RAW` in `build_perfumeries.py`): flagships whose exact address was checked
   one by one. They win over any OSM duplicate (same name within 150 m).
2. **OSM harvest**:
   - every `shop=perfumery` / `shop=department_store`, and beauty shops whose name says
     perfume, inside ~230 target cities and affluent municipalities (all Paris arrondissements,
     Courchevel, Knokke, Laren, Wassenaar, Sylt, Baden-Baden, Gstaad, Zermatt, Esch-sur-Alzette…);
   - Photon text search per city (perfume words + the city's own name), splitting the bbox
     into quadrants whenever a query hits Photon's 50-result cap;
   - luxury networks country-wide by name (Galeries Lafayette, Printemps, INNO, De Bijenkorf,
     Breuninger, Globus, Manor, Bongénie, Skins, Paris 8, Apropos…).
3. **Filtering** (`classify`): known networks get a network profile; mass-market chains
   (Douglas, Sephora, Marionnaud, ICI Paris XL, Rituals…) and monobrand houses (Chanel,
   Guerlain, Diptyque, Le Labo…, brand fit = 0) are dropped; remaining perfumeries are
   kept as *independent perfumeries* with a neutral profile.
   `EXCLUDE` also drops outlets, food halls, lingerie floors, nail/brow salons, dupe/oud/import
   discounters, workshops and monobrand houses the `MONO` list misses.
4. **Addresses**: shops without a house number get one from Nominatim reverse (zoom 18), then
   from the nearest numbered OSM address within 40 m on the same street (Photon reverse).
5. **Validation**: type/openness enums, score ranges, coordinates present and inside the country,
   street + house number + postcode present, no duplicates, no monobrand. The build fails
   on any error.
6. **Postcode audit** (`normalize_address`, `validate_postcodes`): national formats are enforced
   (FR/DE `12345`, BE/CH `1234`, NL `1234 AB`, LU `L-1234`), foreign prefixes stripped, the country
   always closes the address; each postcode must sit in its national range, and every postcode area
   (FR/DE first two digits, others first digit) must lie within 60–200 km of its own median, which
   catches swapped coordinates or a postcode from the wrong city.

## Schema
`id, name, type, country, country_name, city, district (Paris/Lyon/Marseille arrondissement or
Brussels commune, else null), full_address, lat, lng, tier_score (1-100),
brand_alignment_score (0-100), single_sku_openness (High/Med/Low),
openness_verified, segment, entry_barrier, customer_experience_rating (1-5 or null), cx_traits[],
sentiment_summary, cx_insights{staff, footfall, sampling, atmosphere, watch_out, pitch, basis}, network,
address_confidence, address_confidence_score, address_source, source, google_maps_url, instagram_search_url,
crm_key, postcode, launch_priority, decision_maker_role, pipeline_status, notes_prospections, priority_target, wholesale,
export_potential_score (1-100), export_potential{purchasing_power, purchasing_power_eur, luxury_hub, nearest_hub, hub_km,
clientele_density, high_end_doors_5km}`

### Export Potential Score
`export_potential_score = 40 % purchasing power + 30 % luxury-hub proximity + 30 % high-end clientele density`, each 0–100:
- **Purchasing power**: national per-capita retail purchasing power (`PP_NATIONAL`) × an affluence multiplier for the
  municipality (`PP_CITY`) or Paris / Lyon / Marseille arrondissement and Brussels commune (`PP_DISTRICT`), mapped
  linearly from 15 k€ (0) to 60 k€ (100).
- **Luxury hub**: 100 at a flagship luxury street (`LUXURY_HUBS`: Triangle d'Or, Avenue Louise, P.C. Hooftstraat,
  Königsallee, Bahnhofstrasse, Rue du Rhône, Grand-Rue…), halving every 12 km.
- **Clientele density**: doors with tier ≥ 75 within 5 km, `25 × log2(1 + n)`, capped at 100.

All multipliers are editorial estimates: the score ranks markets, it does not size them.

`wholesale` is `null` except for accounts in `sources/wholesale.json`:
`{demo, since, units_delivered, revenue, paid, outstanding, deliveries[{date, ref, sku, units}],
invoices[{no, date, due, amount, status (Paid/Pending), cumulative}]}`.

### Priority target boutiques
`PRIORITY_TARGETS` in `build_perfumeries.py` is the briefed list of high-priority doors; every build
prints an audit: **already present**, **newly added / verified** and **unresolved**. Shops the OSM
harvest missed are added from `TARGET_ROWS`, each pinned on its own OSM object; the house number is
`curated` when a public directory confirms it, `osm_reverse` when taken from the numbered OSM address
the shop sits in. Names that no source could locate stay unresolved (never invented coordinates):
send a street address and add a row to `TARGET_ROWS`.

### B2B sales fields (single-SKU launch)
| Field | Values |
|---|---|
| `launch_priority` | `Tier 1 - Quick Win (Indie Niche)` (true indie + indie to verify), `Tier 2 - Selective (Specialist / Concept)`, `Tier 3 - Long-term Dept Store` |
| `decision_maker_role` | `Founder` (independents), `General Manager` (concept-store chains, door-level assortment), `Head Buyer` (niche chains, department stores; central buying). Legacy `Store Manager` loads as `General Manager` |
| `pipeline_status` | `Not Contacted`, `Discovery Set Sent`, `Follow-up Required`, `Meeting Booked`, `Partner Active`, `Key Account`, `Declined` (legacy `Sample Sent` loads as `Discovery Set Sent`) |
| `notes_prospections` | free text logged after each contact |
| `address_confidence_score` | estimated % that the address reaches the door: curated 100, OSM tags 90, inferred house number 75 |
| `crm_key` | `name-slug@lat,lng` (3 decimals), stable across rebuilds; ids are not |

Defaults are derived in `build_perfumeries.py`; `sources/crm.json` overrides them. The build
fails on an unknown status or role and warns about entries that no longer match a store.

### Single-SKU market fit (`calibrate`)
Editorial openness says how niche-minded a store is, not how easily a one-reference indie
brand gets listed. Every row is re-derived from a market segment:

| Segment | Openness | Entry barrier | Fit cap | Rule |
|---|---|---|---|---|
| True Indie Niche Boutique | High | Low | – | owner-run, editorially verified as micro-brand friendly (`VERIFIED_MICRO`) |
| Indie Niche (to verify) | Med | Med | 68 | independent with a niche identity, not yet checked |
| Specialist Niche House | Med | High | 72 | large niche catalogue with a buyer (Jovoy, Senteurs d'Ailleurs, Paris 8…) |
| Traditional Prestige Perfumery | Low | High | 45 | family perfumery / beauty institute, prestige brands first; default for unassessed OSM independents |
| Selective Concept Store | Low (Med if `CONCEPT_OPEN`) | High | 55 (65) | central buying, exclusivity and breadth requirements |
| Department Store | Low | Very High | 35 | corner fees, launch budgets, distribution minimums |

Only *True Indie* rows are High openness, so the **High-Priority Quick Wins** filter only
surfaces verified micro-brand-friendly shops. The map has a *Market segment* filter.

### Consumer insights (`cx_insights`)
Popups, search and the CSV carry staff, footfall, sampling policy, atmosphere, a
**watch out** (expected friction) and a segment-specific **pitch prep**. `basis` says where
they come from: *store-level synthesis of public reviews* (all 74 curated flagships,
paraphrased recurring themes, no quotes), *network pattern* (harvested branches of known
networks) or *derived from store profile & location — verify on visit* (OSM independents).
The build fails if a curated store has no insight entry.

## Data caveats
- `address_confidence` is always `confirmed`: every row has street, house number and
  postcode, and coordinates on the building. `address_source` says where it came from:
  `curated` (checked by hand), `osm_tags` (the shop's own OSM address),
  `osm_reverse` (shop had no address tags; number taken from the building it sits in).
- `source` is `curated` or `osm:<type>/<id>`; the popup links to the OSM object.
- Scores are **editorial estimates**. OSM rows inherit their network's profile;
  independent perfumeries get a neutral default (tier 62) and no CX rating until reviewed;
  `calibrate` then caps their fit and openness by segment. Their niche depth is not assessed — check before outreach.
- OSM can lag behind closures. Known closures excluded: Jelmoli Zürich (2025),
  Galeries Lafayette Berlin (2024).

## Map
- Design: OLED black canvas, charcoal cards (#121214), hairline frosted borders, champagne accent (#C5A059).
  Apple system type stack (SF Pro) with Playfair Display for store names and headings.
- Floating glass metric widgets (pointer sheen, touch lift; snap carousel on phones), collapsible "Refine" panel.
- Store dossier and margin simulator live in an iOS-style slide-over sheet (right on desktop,
  swipe-to-dismiss bottom sheet on phones); the pitch generator opens as its own sheet.
- Pipeline in three views: Table (inline editing), List and Grid (status picker on each card, instant update).
  Views share filters and sort; the choice is remembered in this browser.
- Basemap: OpenFreeMap vector tiles (no API key) via MapLibre GL — "Noir" (dark) by default,
  Liberty and Positron in the switcher. CARTO Voyager is listed too, but CARTO now watermarks
  tiles requested without an API key. OSM raster fallback without WebGL.
- Custom DOM markers: glowing dot, colour = store type, size = tier score, halo = pipeline status;
  Tier 1 quick wins pulse in champagne. Popups are floating product cards.
- Filters: country, city, type, segment, tier, alignment, openness, source, status, priority, search,
  focus toggles (quick wins, partners & key accounts, sampling in flight, only in view).

## Dual map: Global Target Directory ↔ Ma Carte Partner
A top switch (remembered; `#partners` deep-links) flips the whole app between two maps:
- **Global Target Directory**: all 400+ doors, prospecting dashboard, pitch generator, simulator.
- **Ma Carte Partner**: only `Partner Active` / `Key Account` doors. Pins are sized by invoiced revenue,
  coloured by account level; the top 3 performers carry a rotating gold halo. A champagne **revenue
  heatmap** (leaflet.heat, toggle on the map) shows where it sells, and **Où ça cartonne** ranks cities
  and doors (click to zoom). Widgets: partner doors, stock engaged (units delivered), revenue invoiced,
  collected (paid share), outstanding (overdue = pending past due date), top city. The table swaps
  prospecting columns for Units / Revenue / Outstanding / Last invoice.

### Wholesale Stock & Invoicing drawer
In a partner's dossier: totals, a cumulative-revenue sparkline, itemised invoices (date, due date,
status, amount, running total; tap a status to mark it paid) and the delivery log (stock engagement).
Log new deliveries and invoices in place; edits stay in this browser until **Export ledger JSON**
(save as `sources/wholesale.json`, set `"demo": false`, rebuild). The build validates dates, amounts,
statuses and that every ledger account is still a partner.

## Sales pipeline (CRM)
- Dashboard: total target stores, high-priority (Tier 1) targets and quick wins, active pipeline
  (sample sent + meeting booked + partner active) with a status funnel, average address confidence.
  All tiles follow the filters.
- Filters: pipeline status, launch priority, and a **High-Priority Quick Wins** toggle
  (Tier 1, High single-SKU openness, fit ≥ 70, not yet partner or declined).
- Sampling workflow statuses: Not Contacted → Discovery Set Sent → Follow-up Required →
  Meeting Booked → Partner Active / Key Account (or Declined).
- **Smart pitch generator** (popup, dossier, table): FR/EN outreach email built from the store
  profile, decision-maker role, sampling policy, entry barrier and the simulator economics;
  copy, open in mail app, or mark the discovery set as sent.
- **Single-SKU margin & revenue simulator**: MSRP (TTC), COGS, VAT, retailer coefficient →
  wholesale price, retailer and brand margins, recommended MOQ (case-pack multiple reaching the
  opening-order target, 2× for department stores) and weighted year-1 pipeline revenue by status.
  Inputs are remembered in this browser.
- **Territorial exclusivity**: Partner Active / Key Account stores get an exclusion radius
  (0.5–10 km, default 2 km) drawn on the map when filtering those accounts or with "Show zones";
  stores inside a zone are flagged in the table, dossier and pitch.
- Status, decision maker and notes are editable in the table and dossier; marker rings take the status colour.
  Edits are kept in this browser (localStorage) until exported.
- **Export CSV**: rows currently shown, in table order, for outreach campaigns (UTF-8, Excel-ready).
- **Export CRM JSON**: save as `sources/crm.json` and run `python3 build_perfumeries.py` to bake
  the pipeline into `perfumeries.json` and share it through git.

## Sillage AI (`ai_assistant.js`)
Floating champagne-glass assistant (bottom-right, or ⌘/Ctrl+K) reading the live dataset and
pipeline through `window.SillageContext`. Four built-in analyses run offline: growth cities for
single-SKU, 50-door discovery-set dispatch (CSV + one-click status update), pipeline stagnation &
collections audit, exclusivity-zone conflicts. Store names and cities get a brief. Optional
Anthropic / OpenAI key (⚙︎, kept in this browser only) answers open questions grounded on the
same CRM context. Status changes are dated in `perfumery-touch-v1` to drive the stagnation SLA.

## Multi-currency & export tax engine
- Header toggle **€ / CHF / £** (persisted per browser) re-prices every figure: KPIs, pipeline values,
  margin simulator, wholesale ledger, dossiers, Sillage AI. Ledger and simulator inputs stay in EUR.
- FX: ECB reference rates via Frankfurter (once a day, cached); offline fallback to a reference table.
- Markets: EU (per-country VAT FR 20 · BE/NL 21 · DE 19 · LU 17), Switzerland (CHF list, 8.1 % VAT,
  +8 % price corridor, CHF 1 200 minimum, CHF 1 500 free shipping, ~CHF 65 clearance), UK (GBP list,
  20 % VAT, +5 % corridor, £800 minimum, £1 000 free shipping). Swiss doors always buy on the CHF list.
- MOQ, free-shipping warnings and customs notes follow the selected market; pitches quote each
  store's own price list. Sillage AI adds a "Swiss & Non-EU Export Strategy" analysis and feeds the
  currency context to the LLM.

## Predictive modules (`intelligence.js`)
### Restock & sell-through velocity engine
For every Partner Active / Key Account door with a delivery log: deliveries on the same day form one order; each order
is assumed to sell through before the next lands, so `units ÷ days to next order` is that period's velocity, and the
velocity and reorder cadence are exponentially weighted means (recent orders count most). On-hand stock = last order +
lead-time carry-over − velocity × days since. Cover = on hand ÷ velocity.
- **Reorder now** when cover ≤ 10 days (lead time), **Low stock** when cover ≤ 24 days, **Reorder overdue** when no order
  for 1.5 × the usual cadence; suggested quantity covers the next cycle + lead time, rounded to the simulator case pack.
- Shown on store cards, popups, the table (*Stock* column in Ma Carte Partner, sort *Restock urgency*), a *Sell-through
  forecast* block in the wholesale drawer (per-SKU cover, one-tap "Log N-unit reorder"), the CSV and the PDF.
- Sillage AI shows a red alert counter on its launcher, alert banners in the panel and a *Restock & Sell-Through Forecast*
  analysis. Confidence: Low (1 order), Medium (2–3), High (4+).

### Smart geo-clustering & territory cannibalization guard
Opening any prospect computes the zone it would get if signed (current exclusivity radius) against every protected
account within 3 radii: **Blocked** (inside a partner zone), **High** (its zone would cover ≥ 35 % of partner territory,
lens-area geometry), **Moderate** (any overlap) or **Clear**. The dossier shows a to-scale schematic and the partner list;
the map draws the would-be zone (dashed gold) and the intersecting partner zones until the dossier closes. The pitch and
sequencer repeat the warning before outreach; the CSV carries the risk.

### Automated multi-channel outreach sequencer
The pitch generator has a **3-step sequence** tab (FR / EN): Day 0 initial email (the smart pitch), Day 7 value-add
follow-up with local market stats (high-end doors within 5 km, purchasing-power index, nearest luxury hub, export
potential rank, partner sell-through in that country), Day 14 sample delivery confirmation (adapted to the store's
sampling policy). *Schedule sequence* stores the start date in this browser (`perfumery-seq-v1`); due and late steps
appear on store cards and as Sillage AI alerts (*Outreach Sequences Due Today*). *Mark sent* dates the step in the CRM
notes; sending step 3 moves the store to Discovery Set Sent. *Add to calendar* downloads an `.ics` with the three steps.

### Executive PDF export
*Store PDF* (dossier) and *City overview PDF* (dossier, or *Board PDF* in the header for the current filtered view /
selected city) render an A4 document (Playfair Display + SF Pro, champagne rules) in an off-screen frame and open the
print dialog: choose **Save as PDF** for vector text. The store dossier covers market intelligence, unit economics,
territory, sell-through forecast, ledger and store insights; the city overview carries a to-scale territory map with
exclusivity zones, segment and pipeline mix, restock alerts and the doors ranked by export potential.

## Platform modules
Reached from the suite bar under the hero (and **Forecast** in the nav).

- **Revenue forecast** (`Intel.forecast`): next 6 calendar months. Partners: deseasonalised run-rate from the last 12 months
  of invoices × local seasonality × damped 90-day velocity trend × regional shift. Pipeline: stage probability × opening
  order landing 1–3 months out (meeting / follow-up / discovery set), then reorders. Cash-in: turnover shifted by each
  account's median payment terms (fractional months) plus receivables already invoiced (overdue at 85 %). Split by market
  currency (EUR / CHF / GBP) with ±5 % FX sensitivity; CSV and board PDF.
- **Agreements**: `Contract` / `Agreement` buttons on partner cards, popups and dossiers. Exclusive territorial
  distribution, selective distribution or mutual NDA, pre-filled with store identity, decision maker, local price list,
  MOQ, exclusivity radius (existing partners inside it are carved out) and governing law per country. Territorial clauses
  follow Regulation (EU) 2022/720 and the Swiss Cartel Act (passive / online sales never restricted, RRP non-binding).
  A template for counsel review, not legal advice.
- **Integration center**: Shopify B2B (`orders/create`, `orders/paid`, `orders/fulfilled`, `companies/create`) and Stripe
  (`checkout.session.completed`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`) endpoints, live sample
  payloads, Shopify `companyCreate` inputs and a Stripe multi-currency price catalog. `atlas-sync-worker.js` (download) is a
  Cloudflare Worker that verifies Shopify HMAC / Stripe signatures, maps events onto the ledger in KV and serves
  `GET /ledger`; the mapping code is the same function the app uses for **Replay** and **Pull ledger** (idempotent by
  order / invoice number). Link records with `crm_key` (Shopify company `externalId`, order note attribute or `crm:` tag;
  Stripe `metadata.crm_key`).
- **PWA**: install from the browser (Android / desktop) or Safari *Share → Add to Home Screen* (iOS). The service worker
  precaches the app and all store data, caches libraries / fonts / map tiles, and never caches FX, LLM or sync calls.
  *Prepare offline kit* warms the tiles of the area on screen (3 zoom levels deeper, ≤ 1 200 tiles) for trade shows.
  Bump `VERSION` in `sw.js` when a precached file changes. Needs `http(s)` (`python3 -m http.server` works locally).
- **Market pulse** (`Intel.pulse`): ±12 points added to Sillage AI's placement score from regional purchasing shifts
  (`REGION`), segment momentum, Paris tourist flows, luxury-hub peaks and the seasonal buying window 1–3 months ahead
  (`SEASON`, ski-resort and coastal `RESORTS`). Editorial 2026 indices; recomputed daily. See the *Dynamic Market Pulse* chip.
