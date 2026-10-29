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
