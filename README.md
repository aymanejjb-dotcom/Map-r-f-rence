# Niche Perfumery Atlas

Interactive map + table of niche perfumeries, independent concept stores and luxury
department stores in **BE, NL, DE, FR, LU, CH**.

## Files
| File | Role |
|---|---|
| `harvest_osm.py` | Network step: harvests stockists from OpenStreetMap into `sources/osm_raw.json` |
| `sources/cities.json` | Cached bounding boxes of the target cities |
| `sources/crm.json` | Optional: pipeline status / decision maker / notes per `crm_key`, exported from the map |
| `sources/osm_raw.json` | Raw OSM harvest (everything looked at, before filtering) |
| `build_perfumeries.py` | Offline: curated rows + filtered OSM rows → validation → `perfumeries.json` / `.js` |
| `perfumeries.json` | Canonical dataset |
| `perfumeries.js` | Same data as `window.PERFUMERIES` (lets `index.html` open from `file://`) |
| `index.html` | Leaflet (canvas renderer, OSM tiles) + Tabulator app |

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
5. **Validation**: type/openness enums, score ranges, coordinates inside the country,
   street + house number + postcode present, no duplicates, no monobrand. The build fails
   on any error.

## Schema
`id, name, type, country, country_name, city, district (Paris/Lyon/Marseille arrondissement or
Brussels commune, else null), full_address, lat, lng, tier_score (1-100),
brand_alignment_score (0-100), single_sku_openness (High/Med/Low),
customer_experience_rating (1-5 or null), cx_traits[], sentiment_summary, network,
address_confidence, address_confidence_score, address_source, source, google_maps_url, instagram_search_url,
crm_key, launch_priority, decision_maker_role, pipeline_status, notes_prospections`

### B2B sales fields (single-SKU launch)
| Field | Values |
|---|---|
| `launch_priority` | `Tier 1 - Quick Win (Indie Niche)` (niche boutiques), `Tier 2 - Selective Concept Store`, `Tier 3 - Long-term Dept Store` |
| `decision_maker_role` | `Founder` (independents), `Store Manager` (concept-store chains), `Head Buyer` (niche chains, department stores) |
| `pipeline_status` | `Not Contacted`, `Sample Sent`, `Meeting Booked`, `Partner Active`, `Declined` |
| `notes_prospections` | free text logged after each contact |
| `address_confidence_score` | estimated % that the address reaches the door: curated 100, OSM tags 90, inferred house number 75 |
| `crm_key` | `name-slug@lat,lng` (3 decimals), stable across rebuilds; ids are not |

Defaults are derived in `build_perfumeries.py`; `sources/crm.json` overrides them. The build
fails on an unknown status or role and warns about entries that no longer match a store.

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
- Filters: country toggles, city (follows selected countries), type, min tier, min alignment, single-SKU openness, source (curated/OSM), debounced
  text search (name, city, street, network), "only in view" (table follows map viewport).
- Click a column header to sort (tier, fit, CX…). Click a row → map flies to store.

## Sales pipeline (CRM)
- Dashboard: total target stores, high-priority (Tier 1) targets and quick wins, active pipeline
  (sample sent + meeting booked + partner active) with a status funnel, average address confidence.
  All tiles follow the filters.
- Filters: pipeline status, launch priority, and a **High-Priority Quick Wins** toggle
  (Tier 1, High single-SKU openness, fit ≥ 70, not yet partner or declined).
- Status, decision maker and notes are editable in the table; marker rings take the status colour.
  Edits are kept in this browser (localStorage) until exported.
- **Export CSV**: rows currently shown, in table order, for outreach campaigns (UTF-8, Excel-ready).
- **Export CRM JSON**: save as `sources/crm.json` and run `python3 build_perfumeries.py` to bake
  the pipeline into `perfumeries.json` and share it through git.
