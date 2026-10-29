# Niche Perfumery Atlas

Interactive map + table of niche perfumeries, independent concept stores and luxury
department stores in **BE, NL, DE, FR, LU, CH** (104 stores).

## Files
| File | Role |
|---|---|
| `build_perfumeries.py` | Source dataset + validation; writes `perfumeries.json` and `perfumeries.js` |
| `perfumeries.json` | Canonical dataset |
| `perfumeries.js` | Same data as `window.PERFUMERIES` (lets `index.html` open from `file://`) |
| `index.html` | Leaflet (OSM tiles) + Tabulator app |

## Usage
```bash
python3 build_perfumeries.py   # rebuild after editing RAW
open index.html                # or: python3 -m http.server
```

## Schema
`name, type, country, country_name, city, address, lat, lng, tier_score (1-100),
brand_alignment_score (0-100), single_sku_openness (High/Med/Low),
customer_experience_rating (1-5), cx_traits[], sentiment_summary,
address_confidence, google_maps_url, instagram_search_url`

## Data caveats
- Scores and sentiment summaries are **editorial estimates**, not scraped reviews.
- `address_confidence`: `verified` (flagship/landmark), `approximate` (street right,
  number may differ), `to_verify` (store exists in that city; street must be checked —
  markers sit at city/district centre). Check `to_verify` rows via the Maps link before outreach.
- Monobrand flagships (Chanel, Serge Lutens, Malle…) are included for prestige benchmarking
  but scored ~0 on brand alignment — they don't stock third-party brands.
- Known closures excluded: Jelmoli Zürich (2025), Galeries Lafayette Berlin (2024).

## Map
- Marker colour = store type, radius = tier score.
- Filters: country, type, min tier, min alignment, single-SKU openness, live text search,
  "only in view" (table follows map viewport).
- Click a row → map flies to store; click a marker → row highlighted.
