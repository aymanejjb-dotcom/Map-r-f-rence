"""Autonomous collection: brand catalogues (Shopify / JSON-LD) + public review widgets
(Judge.me, Okendo, Yotpo). Polite: robots.txt honoured, ~1 req/s per host, disk cache."""
import gzip
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

from . import extract
from .core import (add_review, clean_name, connect, detect_concentration, norm, refresh_ratings,
                   strip_html, upsert_perfume)
from .sources import BRANDS, FX_EUR

UA = "Mozilla/5.0 (compatible; PerfumeMarketResearch/1.0)"
CACHE = Path(__file__).resolve().parent.parent / "data" / "raw"
DELAY = 0.8
_last_hit, _robots = {}, {}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def allowed(url):
    host = urllib.parse.urlsplit(url).netloc
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(f"https://{host}/robots.txt", headers={"User-Agent": UA})
            rp.parse(urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "ignore").splitlines())
        except Exception:
            rp.parse([])
        _robots[host] = rp
    return _robots[host].can_fetch(UA, url)


def fetch(url, as_json=False, ttl=7 * 86400, check_robots=True):
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if key.exists() and time.time() - key.stat().st_mtime < ttl:
        raw = gzip.decompress(key.read_bytes()).decode("utf-8", "ignore")
    else:
        if check_robots and not allowed(url):
            log("  robots.txt disallows", url)
            return None
        host = urllib.parse.urlsplit(url).netloc
        wait = DELAY - (time.time() - _last_hit.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        raw = None
        for attempt in range(3):
            _last_hit[host] = time.time()
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    raw = r.read().decode("utf-8", "ignore")
                break
            except urllib.error.HTTPError as e:
                if e.code in (429, 503) and attempt < 2:
                    time.sleep(5 * (attempt + 1))
                    continue
                return None
            except Exception:
                if attempt < 2:
                    time.sleep(2)
                    continue
                return None
        if raw is None:
            return None
        key.write_bytes(gzip.compress(raw.encode()))
    if as_json:
        try:
            return json.loads(raw)
        except ValueError:
            return None
    return raw


# ---------------------------------------------------------------- catalogue filters
EXCLUDE = re.compile(
    r"\b(candle|bougie|soap|savon|body|corps|cream|creme|lotion|gel|shower|douche|hand|mains|gift ?card|"
    r"carte cadeau|coffret|set|discovery|decouverte|sample|echantillon|miniature|mini|travel|voyage|kit|bag|sac|"
    r"diffuser|diffuseur|home|maison spray|room|interieur|hair|cheveux|deodorant|bundle|engraving|gravure|pouch|"
    r"case|etui|pochette|tote|book|livre|calendar|calendrier|advent|atomizer|vaporisateur de sac|refill|recharge|"
    r"recharge|incense sticks|encens a bruler|wax|cire|scented|parfum d interieur|linge|textile|bath|bain moussant|"
    r"oil burner|accessor|gwp|offert|gift|cadeau|test|tester|bougeoir|plateau|vase|scarf|foulard|pillow|"
    r"sachet|stone|pierre|lip|levres|nail|card|fragrance wardrobe|wardrobe|trio|duo|collection box|palette)\b")
INCLUDE = re.compile(r"\b(parfum|perfume|fragrance|eau de|extrait|cologne|edp|edt|attar|elixir)\b")
SMALL = 15  # ml; below this a product is a sample/travel spray


def is_perfume(p):
    blob = norm(" ".join([p["title"], p.get("product_type") or "", p["handle"]]))
    if EXCLUDE.search(blob):
        return False
    tags = norm(" ".join(p.get("tags") or []))
    return bool(INCLUDE.search(blob) or INCLUDE.search(tags) or
                any(extract.size_ml(v.get("title")) for v in p.get("variants", [])))


def shop_currency(domain):
    cart = fetch(f"https://{domain}/cart.js", as_json=True, check_robots=False)
    return (cart or {}).get("currency", "EUR")


# ---------------------------------------------------------------- shopify catalogue
def collect_shopify(con, brand, domain, segment, country):
    products, page = [], 1
    while True:
        d = fetch(f"https://{domain}/products.json?limit=250&page={page}", as_json=True, ttl=86400)
        if not d or not d.get("products"):
            break
        products += d["products"]
        if len(d["products"]) < 250:
            break
        page += 1
    if not products:
        log(f"  {brand}: catalogue unavailable")
        return {}, []
    fx = FX_EUR.get(shop_currency(domain), 1.0)
    by_fp, handle_map = {}, {}
    for p in products:
        name = re.sub(r"\s*[-–|]\s*(eau de parfum|eau de toilette|extrait.*|edp|edt)\s*$", "", p["title"], flags=re.I)
        cname = clean_name(name, brand)
        handle_map[p["handle"]] = cname
        handle_map[str(p["id"])] = cname
        if not is_perfume(p):
            continue
        body = strip_html(p.get("body_html"))
        conc = detect_concentration(p["title"], p.get("product_type"), p["handle"], " ".join(p.get("tags") or []), body[:300])
        sizes = []
        for v in p.get("variants", []):
            ml = extract.size_ml(" ".join(filter(None, [v.get("title"), v.get("option1"), v.get("option2")])))
            ml = ml or extract.size_ml(p["title"]) or extract.size_ml(p["handle"].replace("-", " "))
            if ml and v.get("price"):
                sizes.append((ml, float(v["price"]) * fx))
        full = [s for s in sizes if s[0] >= SMALL]
        if sizes and not full:
            continue  # sample / travel only
        ref = min(full, key=lambda s: abs(s[0] - 100)) if full else None
        fp_key = (cname, conc)
        rec = by_fp.setdefault(fp_key, {
            "brand": brand, "name": name.strip().title() if name.isupper() else name.strip(),
            "concentration": conc, "country": country, "segment": segment, "url": f"https://{domain}/products/{p['handle']}",
            "image_url": (p.get("images") or [{}])[0].get("src"), "description": body[:2000],
            "sources": [f"shopify:{domain}"], "_tags": p.get("tags") or [], "_handles": [], "_ref": None})
        rec["_handles"].append(p["handle"])
        if ref and (rec["_ref"] is None or abs(ref[0] - 100) < abs(rec["_ref"][0] - 100)):
            rec["_ref"] = ref
            rec["url"] = f"https://{domain}/products/{p['handle']}"
    ids = {}
    for (cname, conc), rec in by_fp.items():
        page_txt = strip_html(fetch(rec["url"]) or "")
        enrich(rec, rec["description"] + "\n" + " ".join(rec.pop("_tags")) + "\n" + page_txt)
        ref = rec.pop("_ref")
        if ref:
            rec["size_ml"], rec["price_eur"] = ref[0], round(ref[1], 2)
            rec["price_per_ml"] = round(ref[1] / ref[0], 2)
        handles = rec.pop("_handles")
        pid = upsert_perfume(con, rec)
        for h in handles:
            ids[h] = pid
        ids.setdefault(cname, pid)
    for h, cname in handle_map.items():
        if h not in ids and cname in ids:
            ids[h] = ids[cname]  # samples / sizes sold as separate products
    log(f"  {brand}: {len(products)} products -> {len(by_fp)} perfumes")
    return ids, products


def _page_section(page_txt, start_pat):
    m = re.search(start_pat, page_txt, re.I)
    return page_txt[m.start(): m.start() + 600] if m else ""


def enrich(rec, text):
    pyr = extract.pyramid(text)
    if pyr:
        rec["notes_top"], rec["notes_heart"], rec["notes_base"] = pyr.get("top"), pyr.get("heart"), pyr.get("base")
    notes_txt = _page_section(text, r"notes?\s*(olfactives?|de t[eê]te)|top notes?|key notes|notes? cl[ée]s|ingr[ée]dients? cl[ée]s|olfactory notes") or text
    allnotes = extract.find_notes(notes_txt) or extract.find_notes(text)
    rec["notes_all"] = allnotes[:14]
    rec["family"] = extract.family({**pyr, "all": allnotes})
    rec["nose"] = rec.get("nose") or extract.nose(text)
    rec["year"] = rec.get("year") or extract.year(text)
    rec["longevity"] = extract.declared_level(text, "longevity")
    rec["sillage"] = extract.declared_level(text, "sillage")


# ---------------------------------------------------------------- review widgets
def detect_widgets(domain, sample_handle):
    html = (fetch(f"https://{domain}/") or "") + (fetch(f"https://{domain}/products/{sample_handle}") or "")
    found = {}
    m = re.search(r'Shopify\.shop\s*=\s*"([^"]+)"', html)
    if m and re.search(r"jdgm|judge\.me", html):
        found["judgeme"] = m.group(1)
    m = re.search(r'(?:subscriberId|data-oke-reviews-subscriber-id|okendo-reviews-subscriber-id)["\'=:\s]+["\']?([0-9a-f]{8}-[0-9a-f-]{27})', html)
    if m:
        found["okendo"] = m.group(1)
    m = re.search(r'(?:staticw2\.yotpo\.com|cdn-widgetsrepository\.yotpo\.com/v1/loader)/([A-Za-z0-9]{20,})', html) or \
        re.search(r'data-appkey=["\']([A-Za-z0-9]{20,})', html)
    if m:
        found["yotpo"] = m.group(1)
    return found


def _resolve(ids, brand_key):
    """handle/product-id/name -> perfume id, tolerant to size suffixes."""
    if brand_key in ids:
        return ids[brand_key]
    k = clean_name(brand_key.replace("-", " "))
    return ids.get(k)


def _judgeme_blocks(con, html, ids, default_pid=None):
    n = 0
    for b in html.split("<div class='jdgm-rev ")[1:]:
        handle = re.search(r"/products/([^'?#\"]+)", b)
        pid = (_resolve(ids, handle.group(1)) if handle else None) or default_pid
        body = re.search(r"jdgm-rev__body'>(.*?)</div>", b, re.S)
        if not pid or not body:
            continue
        score = re.search(r"data-score='(\d)'", b)
        title = re.search(r"jdgm-rev__title'>(.*?)</b>", b, re.S)
        date = re.search(r"data-content='(\d{4}-\d{2}-\d{2})", b)
        lang = re.search(r"data-review-language='([a-z]{2})", b)
        n += add_review(con, pid, "judgeme", body.group(1), float(score.group(1)) if score else None,
                        strip_html(title.group(1)) if title else None, lang.group(1) if lang else None,
                        int("data-verified-buyer='true'" in b), date.group(1) if date else None)
    return n


def reviews_judgeme(con, shop, ids, products):
    """Per product (complete), then the shop-wide feed (catches sister-store handles).
    Judge.me repeats its last page past the end, so stop on a repeated first review."""
    n = 0
    for p in products:
        pid = ids.get(p["handle"])
        if not pid:
            continue
        got, page = 0, 0
        while True:
            page += 1
            d = fetch("https://judge.me/reviews/reviews_for_widget?" + urllib.parse.urlencode(
                {"url": shop, "shop_domain": shop, "platform": "shopify", "page": page, "per_page": 100,
                 "product_id": p["id"]}), as_json=True, ttl=3 * 86400, check_robots=False)
            html = (d or {}).get("html") or ""
            k = html.count("<div class='jdgm-rev ")
            if not k:
                break
            n += _judgeme_blocks(con, html, ids, pid)
            got += k
            if got >= int((d or {}).get("total_count") or 0) or page > 50:
                break
        con.commit()
    prev = None
    for page in range(1, 400):
        d = fetch("https://api.judge.me/reviews/all_reviews_js_based?" + urllib.parse.urlencode(
            {"shop_domain": shop, "platform": "shopify", "page": page, "per_page": 25, "review_type": "product-reviews"}),
            as_json=True, ttl=3 * 86400, check_robots=False)
        html = (d or {}).get("html") or ""
        first = re.search(r"data-review-id='([^']+)", html)
        if not first or first.group(1) == prev:
            break
        prev = first.group(1)
        n += _judgeme_blocks(con, html, ids)
        con.commit()
    return n


def reviews_okendo(con, sid, ids, max_pages=400):
    n, url, pages = 0, f"https://api.okendo.io/v1/stores/{sid}/reviews?limit=100", 0
    while url and pages < max_pages:
        pages += 1
        d = fetch(url, as_json=True, ttl=3 * 86400, check_robots=False)
        if not d:
            break
        for r in d.get("reviews", []):
            pid = _resolve(ids, str(r.get("productId", "")).replace("shopify-", "")) or \
                  _resolve(ids, clean_name(r.get("productName", "")))
            if pid:
                n += add_review(con, pid, "okendo", r.get("body") or "", r.get("rating"), r.get("title"),
                                r.get("languageCode"), int(bool((r.get("reviewer") or {}).get("isVerified"))),
                                (r.get("dateCreated") or "")[:10] or None)
        nxt = d.get("nextUrl")
        url = f"https://api.okendo.io/v1{nxt}" if nxt else None
        con.commit()
    return n


def reviews_yotpo(con, key, products, ids):
    n = 0
    for p in products:
        pid = ids.get(p["handle"])
        if not pid:
            continue
        for page in range(1, 20):
            d = fetch(f"https://api-cdn.yotpo.com/v1/widget/{key}/products/{p['id']}/reviews.json?per_page=150&page={page}",
                      as_json=True, ttl=3 * 86400, check_robots=False)
            revs = ((d or {}).get("response") or {}).get("reviews") or []
            for r in revs:
                n += add_review(con, pid, "yotpo", r.get("content") or "", r.get("score"), r.get("title"), None,
                                int(bool(r.get("verified_buyer"))), (r.get("created_at") or "")[:10] or None)
            if len(revs) < 150:
                break
        con.commit()
    return n


# ---------------------------------------------------------------- sitemap / JSON-LD
def _sitemap_urls(url, depth=0):
    xml = fetch(url, ttl=86400)
    if not xml or depth > 2:
        return []
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
    if "<sitemapindex" in xml:
        out = []
        for l in locs:
            if re.search(r"product|produit|perfume|parfum", l, re.I) or len(locs) <= 4:
                out += _sitemap_urls(l, depth + 1)
        return out
    return locs


def _jsonld_products(html):
    out = []
    for blob in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html or "", re.S | re.I):
        try:
            data = json.loads(blob.strip())
        except ValueError:
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            x = stack.pop()
            if isinstance(x, dict):
                t = x.get("@type")
                if t == "Product" or (isinstance(t, list) and "Product" in t):
                    out.append(x)
                stack += [v for k, v in x.items() if k == "@graph" or isinstance(v, (list, dict)) and k != "review"]
            elif isinstance(x, list):
                stack += x
    return out


def collect_sitemap(con, brand, domain, segment, country, limit=250):
    urls = []
    for sm in (f"https://{domain}/sitemap.xml", f"https://{domain}/sitemap_index.xml"):
        urls = _sitemap_urls(sm)
        if urls:
            break
    robots = fetch(f"https://{domain}/robots.txt", check_robots=False) or ""
    for sm in re.findall(r"(?im)^sitemap:\s*(\S+)", robots):
        if not urls or "/fr/" in sm:
            urls = urls or _sitemap_urls(sm)
    urls = list(dict.fromkeys(urls))
    if len(urls) > 500:  # large site: keep product-looking URLs only
        urls = [u for u in urls if re.search(r"/(products?|produits?|p|parfums?|perfumes?|fragrances?)/|\.html$", u)]
    perfumes = reviews = 0
    for u in urls[:limit]:
        html = fetch(u)
        for p in _jsonld_products(html):
            name = strip_html(p.get("name") or "")
            if not name or EXCLUDE.search(norm(name)):
                continue
            offers = p.get("offers") or []
            offers = [o for o in (offers if isinstance(offers, list) else [offers]) if isinstance(o, dict)]
            sized = [(extract.size_ml(" ".join(str(o.get(k) or "") for k in ("name", "sku", "description"))), o) for o in offers]
            sized = [x for x in sized if x[0] and x[0] >= SMALL] or [(None, o) for o in offers[:1]]
            ml_offer, offer = min(sized, key=lambda x: abs((x[0] or 100) - 100)) if sized else (None, {})
            price = offer.get("price") or offer.get("lowPrice")
            desc = strip_html(p.get("description") or "")
            rec = {"brand": brand, "name": name, "concentration": detect_concentration(name, p.get("category"), desc[:300]),
                   "country": country, "segment": segment, "url": u, "description": desc[:2000],
                   "image_url": p["image"][0] if isinstance(p.get("image"), list) else p.get("image"),
                   "sources": [f"jsonld:{domain}"]}
            enrich(rec, desc + "\n" + strip_html(html)[:20000])
            ml = ml_offer or extract.size_ml(name) or extract.size_ml(desc[:400])
            if price:
                try:
                    rec["price_eur"] = float(str(price).replace(",", "."))
                    if ml:
                        rec["size_ml"], rec["price_per_ml"] = ml, round(rec["price_eur"] / ml, 2)
                except ValueError:
                    pass
            agg = p.get("aggregateRating") or {}
            if agg.get("ratingValue"):
                rec["rating_avg"] = float(agg["ratingValue"])
            pid = upsert_perfume(con, rec)
            perfumes += 1
            for r in p.get("review") or []:
                rr = r.get("reviewRating") or {}
                reviews += add_review(con, pid, f"jsonld:{domain}", r.get("reviewBody") or r.get("description") or "",
                                      float(rr["ratingValue"]) if rr.get("ratingValue") else None, r.get("name"),
                                      None, None, (r.get("datePublished") or "")[:10] or None)
        con.commit()
    log(f"  {brand}: {len(urls)} sitemap urls -> {perfumes} product records, {reviews} reviews")
    return perfumes, reviews


def run(only=None):
    con = connect()
    stats = []
    for brand, domain, kind, segment, country in BRANDS:
        if only and norm(only) not in norm(brand):
            continue
        log(f"[{brand}] {domain} ({kind})")
        before = con.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
        try:
            if kind == "shopify":
                ids, products = collect_shopify(con, brand, domain, segment, country)
                con.commit()
                if products:
                    sample = next((p["handle"] for p in products if ids.get(p["handle"])), products[0]["handle"])
                    w = detect_widgets(domain, sample)
                    log(f"  widgets: {w or 'none'}")
                    if "judgeme" in w:
                        reviews_judgeme(con, w["judgeme"], ids, products)
                    if "okendo" in w:
                        reviews_okendo(con, w["okendo"], ids)
                    if "yotpo" in w:
                        reviews_yotpo(con, w["yotpo"], products, ids)
            else:
                collect_sitemap(con, brand, domain, segment, country)
        except Exception as e:  # one brand failing must not stop the run
            log(f"  ERROR {type(e).__name__}: {e}")
        con.commit()
        after = con.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
        n_perf = con.execute("SELECT COUNT(*) FROM master_perfumes WHERE brand=?", (brand,)).fetchone()[0]
        stats.append((brand, n_perf, after - before))
        log(f"  => {n_perf} perfumes, +{after - before} reviews")
    refresh_ratings(con)
    con.commit()
    return stats


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else None)
