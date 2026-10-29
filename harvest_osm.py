#!/usr/bin/env python3
"""Harvest real fragrance stockists from OpenStreetMap into sources/osm_raw.json.

Network step, run rarely; build_perfumeries.py works offline from its output.

  1. Target cities  -> bounding boxes (Nominatim), cached in sources/cities.json
  2. Each city bbox -> Overpass: perfumeries, department stores, beauty/cosmetics
                       shops and named concept stores
  3. Luxury chains  -> Photon name search country-wide (catches branches outside
                       the target cities, e.g. Manor Sion, Breuninger Erfurt)
  4. Rows with no house number are reverse-geocoded (Nominatim, zoom 18) so every
     address has street + number + postcode.

Filtering (mass-market chains, monobrand boutiques) happens in build_perfumeries.py,
so the raw file keeps everything that was looked at.
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "sources"
UA = {"User-Agent": "perfumery-atlas-harvester/1.0 (github.com/aymanejjb-dotcom/Map-r-f-rence)"}
OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass-api.de/api/interpreter"]
OVERPASS_CH = "https://overpass.osm.ch/api/interpreter"  # Swiss mirror, CH only

CITIES = {
    "FR": ["Paris", "Neuilly-sur-Seine", "Boulogne-Billancourt", "Versailles", "Saint-Germain-en-Laye",
           "Lyon", "Marseille", "Bordeaux", "Lille", "Cannes", "Nice", "Strasbourg", "Toulouse", "Nantes",
           "Aix-en-Provence", "Megève", "Courchevel", "Saint-Tropez", "Biarritz", "Montpellier", "Rennes",
           "Annecy", "Deauville"],
    "BE": ["Région de Bruxelles-Capitale", "Antwerpen", "Gent", "Brugge", "Liège", "Namur", "Wezembeek-Oppem",
           "Knokke-Heist", "Hasselt", "Waterloo", "Leuven", "Mechelen", "Kortrijk", "Sint-Martens-Latem", "Aalst"],
    "NL": ["Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Laren", "Wassenaar", "Maastricht", "Eindhoven",
           "Arnhem", "Haarlem", "Amstelveen", "Bloemendaal", "Groningen", "'s-Hertogenbosch", "Breda",
           "Blaricum", "Oosterbeek"],
    "DE": ["Berlin", "München", "Hamburg", "Düsseldorf", "Frankfurt am Main", "Köln", "Stuttgart", "Baden-Baden",
           "Sylt", "Wiesbaden", "Bad Homburg vor der Höhe", "Starnberg", "Hannover", "Bremen", "Essen", "Nürnberg",
           "Leipzig", "Dresden", "Mannheim", "Heidelberg", "Bonn", "Münster", "Freiburg im Breisgau", "Konstanz"],
    "CH": ["Zürich", "Genève", "Lausanne", "Basel", "St. Moritz", "Gstaad", "Luzern", "Lugano", "Bern", "Zug",
           "Montreux", "Crans-Montana", "Verbier", "Davos"],
    "LU": ["Luxembourg", "Strassen", "Bertrange"],
}

# Named concept stores / niche houses tagged with generic shop values (clothes, gift…)
NAMED = ("Apropos|Smets|Graanmarkt 13|Hunting and Collecting|The Corner|Voo Store|Dover Street|Merci|"
         "L'Eclaireur|L'Éclaireur|Andreas Murkudis|X Bank|Baltzar|Skins|Jovoy|Liquides|Senteurs d'Ailleurs|"
         "Place Vendôme|Babassu|Perfume Lounge|Lianne Tio|Aus Liebe zum Duft|Essenza Nobile|Paris 8|"
         "Spitzenhaus|Theodora|Théodora|Celeste|Lubner|Schnitzler|Sens Unique|Nose")

CHAINS = [  # (photon query, osm tags, countries)
    ("Galeries Lafayette", ["shop:department_store"], {"FR"}),
    ("Printemps", ["shop:department_store"], {"FR"}),
    ("Le Bon Marché", ["shop:department_store"], {"FR"}),
    ("Inno", ["shop:department_store"], {"BE"}),
    ("de Bijenkorf", ["shop:department_store"], {"NL"}),
    ("KaDeWe", ["shop:department_store"], {"DE"}),
    ("Oberpollinger", ["shop:department_store"], {"DE"}),
    ("Alsterhaus", ["shop:department_store"], {"DE"}),
    ("Ludwig Beck", ["shop:department_store"], {"DE"}),
    ("Breuninger", ["shop:department_store", "shop:clothes"], {"DE"}),
    ("Engelhorn", ["shop:department_store", "shop:clothes"], {"DE"}),
    ("Konen", ["shop:department_store", "shop:clothes"], {"DE"}),
    ("Apropos", ["shop:clothes", "shop:boutique", "shop:fashion"], {"DE"}),
    ("Globus", ["shop:department_store"], {"CH"}),
    ("Manor", ["shop:department_store"], {"CH"}),
    ("Bongénie", ["shop:department_store", "shop:clothes"], {"CH"}),
    ("Loeb", ["shop:department_store"], {"CH"}),
    ("Skins", ["shop:cosmetics", "shop:perfumery", "shop:beauty"], {"NL", "BE"}),
    ("Skins Cosmetics", ["shop:cosmetics", "shop:perfumery", "shop:beauty"], {"NL", "BE"}),
    ("Paris 8", ["shop:perfumery", "shop:cosmetics", "shop:beauty"], {"LU"}),
    ("Aus Liebe zum Duft", ["shop:perfumery", "shop:cosmetics"], {"DE"}),
    ("Essenza Nobile", ["shop:perfumery", "shop:cosmetics"], {"DE"}),
    ("Babassu", ["shop:perfumery", "shop:cosmetics", "shop:beauty"], {"NL"}),
    ("Senteurs d'Ailleurs", ["shop:perfumery", "shop:cosmetics"], {"BE"}),
]


def get(url, data=None, timeout=180):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def nominatim(params, pause=1.1):
    time.sleep(pause)
    for attempt in range(4):
        try:
            return get("https://nominatim.openstreetmap.org/" + params, timeout=60)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(10 * (attempt + 1))
    return None


def city_bboxes():
    path = SRC / "cities.json"
    cache = json.loads(path.read_text()) if path.exists() else {}
    for cc, cities in CITIES.items():
        for city in cities:
            key = f"{cc}:{city}"
            if key in cache:
                continue
            res = nominatim("search?" + urllib.parse.urlencode(
                {"format": "jsonv2", "limit": 1, "countrycodes": cc.lower(), "q": city,
                 "featureType": "settlement"}))
            if not res:
                res = nominatim("search?" + urllib.parse.urlencode(
                    {"format": "jsonv2", "limit": 1, "countrycodes": cc.lower(), "q": city}))
            if not res:
                print("  ! no bbox for", key, file=sys.stderr)
                continue
            s, n, w, e = map(float, res[0]["boundingbox"])
            cache[key] = [s, w, n, e]
            print("  bbox", key, cache[key])
            path.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    return cache


def overpass(query, cc):
    urls = ([OVERPASS_CH] if cc == "CH" else []) + OVERPASS
    for attempt in range(4):
        url = urls[attempt % len(urls)]
        try:
            return get(url, urllib.parse.urlencode({"data": query}).encode())["elements"]
        except Exception as e:  # mirrors time out / drop connections under load
            print(f"    retry {attempt + 1} ({url.split('/')[2]}): {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("overpass failed: " + query[:120])


def element(e, cc, origin):
    t = e.get("tags", {})
    lat = e.get("lat", e.get("center", {}).get("lat"))
    lon = e.get("lon", e.get("center", {}).get("lon"))
    return {
        "osm": f"{e['type']}/{e['id']}", "cc": cc, "origin": origin, "lat": lat, "lng": lon,
        "name": t.get("name"), "brand": t.get("brand"), "shop": t.get("shop"),
        "housenumber": t.get("addr:housenumber"), "street": t.get("addr:street") or t.get("addr:place"),
        "postcode": t.get("addr:postcode"), "city": t.get("addr:city"),
        "mall": None, "website": t.get("website") or t.get("contact:website"),
        "check_date": t.get("check_date"), "opening_hours": t.get("opening_hours"),
    }


def tiles(s, w, n, e, step=0.06):
    """Split a bbox into ~6 km tiles so dense cities stay under mirror time limits."""
    ny, nx = max(1, round((n - s) / step)), max(1, round((e - w) / step))
    dy, dx = (n - s) / ny, (e - w) / nx
    return [(s + i * dy, w + j * dx, s + (i + 1) * dy, w + (j + 1) * dx) for i in range(ny) for j in range(nx)]


def harvest_cities(bboxes, rows):
    shops = "perfumery|department_store|cosmetics|beauty"
    done_path = SRC / ".tiles_done.json"
    done = set(json.loads(done_path.read_text())) if done_path.exists() else set()
    failed = []
    for key, box in bboxes.items():
        cc, city = key.split(":", 1)
        found = new = 0
        for t in tiles(*box):
            tid = f"{key}:{t[0]:.4f},{t[1]:.4f}"
            if tid in done:
                continue
            bb = "({:.5f},{:.5f},{:.5f},{:.5f})".format(*t)
            q = (f'[out:json][timeout:90];('
                 f'nwr["shop"="perfumery"]{bb};'
                 f'nwr["shop"="department_store"]{bb};'
                 f'nwr["shop"~"^({shops})$"]["name"~"parf|perf|duft|profum|fragr",i]{bb};'
                 f'nwr["shop"]["name"~"^({NAMED})",i]{bb};'
                 f');out center tags;')
            try:
                els = overpass(q, cc)
            except RuntimeError:
                failed.append(tid)
                continue
            found += len(els)
            for el in els:
                if "name" not in el.get("tags", {}):
                    continue
                r = element(el, cc, f"overpass:{city}")
                if r["osm"] not in rows:
                    rows[r["osm"]] = r
                    new += 1
            done.add(tid)
            done_path.write_text(json.dumps(sorted(done)))
            time.sleep(1)
        print(f"  {key}: {found} elements, {new} new")
        save(rows)
    if failed:
        print(f"  ! {len(failed)} tiles failed, rerun to retry: {failed}", file=sys.stderr)


PHOTON_WORDS = {
    "FR": ["parfumerie", "parfums", "parfum", "perfume"],
    "BE": ["parfumerie", "parfums", "parfum", "perfume"],
    "LU": ["parfumerie", "parfums", "parfum"],
    "CH": ["parfumerie", "parfümerie", "parfum", "profumeria"],
    "NL": ["parfumerie", "parfum", "perfume", "parfums"],
    "DE": ["parfümerie", "parfumerie", "parfum", "duft", "perfume"],
}
PHOTON_SHOPS = ["shop:perfumery", "shop:cosmetics", "shop:beauty"]


def photon_row(f, origin):
    p = f["properties"]
    lng, lat = f["geometry"]["coordinates"]
    return {
        "osm": f"{dict(N='node', W='way', R='relation')[p['osm_type']]}/{p['osm_id']}",
        "cc": (p.get("countrycode") or "").upper(), "origin": origin, "lat": lat, "lng": lng,
        "name": p.get("name"), "brand": None, "shop": p.get("osm_value"),
        "housenumber": p.get("housenumber"), "street": p.get("street"), "postcode": p.get("postcode"),
        "city": p.get("city"), "mall": None, "website": None, "check_date": None, "opening_hours": None,
    }


def harvest_photon_cities(bboxes, rows):
    """Overpass fallback: Photon text search per city bbox, restricted to beauty shop tags."""
    for key, (s, w, n, e) in bboxes.items():
        cc, city = key.split(":", 1)
        new = 0
        for word in PHOTON_WORDS[cc]:
            params = [("q", word), ("limit", 50), ("bbox", f"{w},{s},{e},{n}")] + [("osm_tag", t) for t in PHOTON_SHOPS]
            try:
                feats = get("https://photon.komoot.io/api/?" + urllib.parse.urlencode(params), timeout=60)["features"]
            except Exception as ex:
                print(f"    photon {key}/{word}: {ex}", file=sys.stderr)
                continue
            for f in feats:
                if not f["properties"].get("name"):
                    continue
                r = photon_row(f, f"photon-city:{city}")
                if r["cc"] == cc and r["osm"] not in rows:
                    rows[r["osm"]] = r
                    new += 1
            time.sleep(0.5)
        print(f"  {key}: {new} new")
    save(rows)


# Photon caps a query at 50 hits: big networks are searched per region (lon/lat boxes)
REGIONS = {
    "FR": ["-5.2,41.3,2.4,46.5", "2.4,41.3,9.6,46.5", "-5.2,46.5,2.4,51.2", "2.4,46.5,9.6,51.2"],
    "CH": ["5.9,45.8,7.6,47.9", "7.6,45.8,10.5,47.9"],
    "DE": ["5.8,47.2,10.5,51.2", "10.5,47.2,15.1,51.2", "5.8,51.2,10.5,55.1", "10.5,51.2,15.1,55.1"],
}


def harvest_chains(rows):
    for q, tags, ccs in CHAINS:
        feats = []
        boxes = [b for cc in sorted(ccs) for b in REGIONS.get(cc, [None])]
        for box in boxes:
            params = [("q", q), ("limit", 50)] + [("osm_tag", t) for t in tags] + ([("bbox", box)] if box else [])
            feats += get("https://photon.komoot.io/api/?" + urllib.parse.urlencode(params), timeout=60)["features"]
            time.sleep(0.5)
        new = 0
        for f in feats:
            p = f["properties"]
            cc = (p.get("countrycode") or "").upper()
            if cc not in ccs or not p.get("name"):
                continue
            r = photon_row(f, f"photon:{q}")
            if r["osm"] in rows:
                continue
            rows[r["osm"]] = r
            new += 1
        print(f"  chain {q!r}: {len(feats)} hits, {new} new")
        time.sleep(1)


def complete_addresses(rows):
    """Fill missing number / postcode / city from the building the shop sits in."""
    todo = [r for r in rows.values() if not (r["housenumber"] and r["street"] and r["postcode"] and r["city"])
            and not r.get("reverse_done")]
    print(f"  reverse-geocoding {len(todo)} rows")
    for i, r in enumerate(todo, 1):
        res = nominatim("reverse?" + urllib.parse.urlencode(
            {"format": "jsonv2", "lat": r["lat"], "lon": r["lng"], "zoom": 18, "addressdetails": 1}))
        r["reverse_done"] = True
        if not res or "address" not in res:
            continue
        a = res["address"]
        if not r["housenumber"] and a.get("house_number"):
            r["housenumber"] = a["house_number"]
            r["street"] = a.get("road") or a.get("pedestrian") or a.get("square") or r["street"]
            r["address_from"] = "reverse"
        r["street"] = r["street"] or a.get("road") or a.get("pedestrian") or a.get("square")
        r["postcode"] = r["postcode"] or a.get("postcode")
        r["city"] = r["city"] or a.get("city") or a.get("town") or a.get("village") or a.get("municipality")
        r["mall"] = a.get("mall") or a.get("retail") or r["mall"]
        if i % 25 == 0:
            print(f"    {i}/{len(todo)}")
            save(rows)


def save(rows):
    (SRC / "osm_raw.json").write_text(
        json.dumps(sorted(rows.values(), key=lambda r: (r["cc"], r["osm"])), ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8")


def main():
    SRC.mkdir(exist_ok=True)
    path = SRC / "osm_raw.json"
    rows = {r["osm"]: r for r in json.loads(path.read_text())} if path.exists() else {}
    steps = sys.argv[1:] or ["cities", "photon-cities", "chains", "reverse"]
    if "cities" in steps:
        harvest_cities(city_bboxes(), rows)
        save(rows)
    if "cities-ch" in steps:  # Swiss Overpass mirror only (when the global ones are down)
        harvest_cities({k: v for k, v in city_bboxes().items() if k.startswith("CH:")}, rows)
        save(rows)
    if "photon-cities" in steps:
        harvest_photon_cities(city_bboxes(), rows)
    if "chains" in steps:
        harvest_chains(rows)
        save(rows)
    if "reverse" in steps:
        complete_addresses(rows)
        save(rows)
    print(f"{len(rows)} raw OSM rows -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
