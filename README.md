# Niche Perfumery Atlas

Interactive map + table of niche perfumeries, independent concept stores and luxury
department stores in **BE, NL, DE, FR, LU, CH**.

## Files
| File | Role |
|---|---|
| `harvest_osm.py` | Network step: harvests stockists from OpenStreetMap into `sources/osm_raw.json` |
| `sources/cities.json` | Cached bounding boxes of the target cities |
| `sources/osm_raw.json` | Raw OSM harvest (everything looked at, before filtering) |
| `build_perfumeries.py` | Offline: curated rows + filtered OSM rows → validation → `perfumeries.json` / `.js` |
| `perfumeries.json` | Canonical dataset |
| `perfumeries.js` | Same data as `window.PERFUMERIES` (lets `index.html` open from `file://`) |
| `index.html` | Leaflet (canvas renderer, OSM tiles) + Tabulator app |

## Usage
```bash
python3 harvest_osm.py         # refresh OSM data (slow: Overpass + Nominatim rate limits)
python3 build_perfumeries.py   # rebuild after editing RAW or the harvest
open index.html                # or: python3 -m http.server
```

## Pipeline
1. **Curated** (`RAW` in `build_perfumeries.py`): flagships whose exact address was checked
   one by one. They win over any OSM duplicate (same name within 150 m).
2. **OSM harvest**:
   - every `shop=perfumery` / `shop=department_store`, and beauty shops whose name says
     perfume, inside ~100 target cities (Paris → Courchevel, Knokke, Laren, Sylt, Gstaad…);
   - luxury networks country-wide by name (Galeries Lafayette, Printemps, INNO, De Bijenkorf,
     Breuninger, Globus, Manor, Bongénie, Skins, Paris 8, Apropos…).
3. **Filtering** (`classify`): known networks get a network profile; mass-market chains
   (Douglas, Sephora, Marionnaud, ICI Paris XL, Rituals…) and monobrand houses (Chanel,
   Guerlain, Diptyque, Le Labo…, brand fit = 0) are dropped; remaining perfumeries are
   kept as *independent perfumeries* with a neutral profile.
4. **Validation**: type/openness enums, score ranges, coordinates inside the country,
   street + house number + postcode present, no duplicates, no monobrand. The build fails
   on any error.

## Schema
`id, name, type, country, country_name, city, full_address, lat, lng, tier_score (1-100),
brand_alignment_score (0-100), single_sku_openness (High/Med/Low),
customer_experience_rating (1-5 or null), cx_traits[], sentiment_summary, network,
address_confidence, address_source, source, google_maps_url, instagram_search_url`

## Data caveats
- `address_confidence` is always `confirmed`: every row has street, house number and
  postcode, and coordinates on the building. `address_source` says where it came from:
  `curated` (checked by hand), `osm_tags` (the shop's own OSM address),
  `osm_reverse` (shop had no address tags; number taken from the building it sits in).
- `source` is `curated` or `osm:<type>/<id>`; the popup links to the OSM object.
- Scores are **editorial estimates**. OSM rows inherit their network's profile;
  independent perfumeries get a neutral default (tier 62, fit 72, High) and no CX rating
  until reviewed. Their niche depth is not assessed — check before outreach.
- OSM can lag behind closures. Known closures excluded: Jelmoli Zürich (2025),
  Galeries Lafayette Berlin (2024).

## Map
- Marker colour = store type, radius = tier score; canvas renderer keeps 300+ markers smooth.
- Filters: country toggles, type, min tier, min alignment, single-SKU openness, source (curated/OSM), debounced
  text search (name, city, street, network), "only in view" (table follows map viewport).
- Click a column header to sort (tier, fit, CX…). Click a row → map flies to store.

---

# Perfume Intelligence (`perfume_db/`, `dashboard.html`)

Master fragrance base + review corpus for French niche / emerging houses, NLP friction
analysis and White Space detection. `index.html` (atlas) links to `dashboard.html`.

## Run
```bash
python3 -m perfume_db.pipeline              # inbox import → collection → NLP → dashboard data
python3 -m perfume_db.pipeline --offline    # re-analyse + rebuild without network
python3 -m perfume_db.pipeline "Lutens"     # collect a single brand
python3 -m perfume_db.importer file.csv     # merge one file now (CSV / JSON / JSONL / HTML)
```
Drop files in `data/inbox/`: every pipeline run merges them, then moves them to `data/inbox/done/`.

## Files
| File | Role |
|---|---|
| `perfume_db/schema.sql` | `master_perfumes` (pyramid, nose, tenue, sillage, price/ml…) + `reviews` (with NLP columns) |
| `perfume_db/core.py` | SQLite access, dedup fingerprint `brand|name|concentration`, merge-on-insert |
| `perfume_db/importer.py` | CSV/JSON/HTML import, FR/EN column aliases, no-duplicate merge |
| `perfume_db/sources.py` | Brand list (domain, segment, country) |
| `perfume_db/collect.py` | Brand catalogues (Shopify `products.json`, schema.org JSON-LD via sitemap) + public review widgets (Judge.me, Okendo, Yotpo) |
| `perfume_db/extract.py` | Notes lexicon (FR/EN → canonical), pyramid, nose, year, declared tenue/sillage, family |
| `perfume_db/nlp.py` | Lexicon aspect sentiment FR/EN: overall, tenue, sillage, prix (−1..1) |
| `perfume_db/analytics.py` | Friction rates by brand/perfume, family × €/ml White Space grid |
| `data/perfumes.sqlite` | The database |
| `perfumes_data.js` | Dashboard payload (`window.PERFUME_DASH`) |

## Dedup rules
- Perfume key: normalised brand + name (sizes, "eau de parfum", "sample"… stripped) + concentration.
  A record without concentration joins the single stored variant of that scent.
  On merge, existing values are kept, empty fields filled, `sources` / `notes_all` unioned.
- Review key: `sha1(source | perfume | normalised body)`.

## Sources & compliance
- Only first-party brand sites and the public review widgets they embed; `robots.txt` honoured,
  ~1 request/s per host, responses cached in `data/raw/` (git-ignored). Reviewer names are not stored.
- **Not collected**: Parfumo (its robots.txt blocks AI agents and disallows its search/API),
  Fragrantica, Jovoy, Luckyscent, Skins (no open product/review feed; not scraped).
  Data from those can still be added by hand through `data/inbox/` (CSV/JSON/HTML export).
- Unreachable/closed to automation at run time: Frédéric Malle (403), L'Artisan Parfumeur and
  Parfum d'Empire (no product JSON-LD), see `data/run.log`.

## Method caveats
- Notes come from brand copy; a full pyramid exists only where the brand publishes tiers.
- Tenue / sillage: declared value when the brand gives one, else `2.5 + 2.5 × mean aspect score`
  from reviews (needs reviews that mention it).
- Friction = share of mentions with aspect score < −0.2 (≥ 3 mentions required).
- White Space (0–100) = scarcity of French supply in the family × €/ml cell ×
  (0.45 demand [review volume] + 0.25 satisfaction + 0.30 tenue/sillage pain + bonus if only foreign brands sit there).
- Brand-site reviews skew positive (moderated, buyers only): read friction rates relatively, brand vs brand.
