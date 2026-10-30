"""Merge any incoming CSV / JSON / HTML file into master_perfumes + reviews, no duplicates.

Usage: python3 -m perfume_db.importer FILE [FILE ...]   (or drop files into data/inbox/)

Columns / keys are matched loosely (FR or EN): brand|marque, name|nom|parfum, concentration,
nose|nez|perfumer, year|annee, top|tete, heart|coeur, base|fond, notes, longevity|tenue,
sillage, price|prix, size|ml, rating|note, url. A row with review|avis|body|comment also
adds a review. HTML: schema.org JSON-LD Product blocks, else <table> rows with a header.
"""
import csv
import json
import re
import sys
from pathlib import Path

from . import extract
from .collect import _jsonld_products, enrich
from .core import add_review, connect, detect_concentration, norm, refresh_ratings, strip_html, upsert_perfume

INBOX = Path(__file__).resolve().parent.parent / "data" / "inbox"
ALIASES = {
    "brand": ["brand", "marque", "maison", "house", "vendor"],
    "name": ["name", "nom", "parfum", "perfume", "fragrance", "title", "titre"],
    "concentration": ["concentration", "type"],
    "nose": ["nose", "nez", "perfumer", "parfumeur"],
    "year": ["year", "annee", "launch", "lancement"],
    "notes_top": ["top", "tete", "notes de tete", "top notes"],
    "notes_heart": ["heart", "coeur", "middle", "notes de coeur", "heart notes"],
    "notes_base": ["base", "fond", "notes de fond", "base notes"],
    "notes_all": ["notes", "accords", "ingredients"],
    "longevity": ["longevity", "tenue"],
    "sillage": ["sillage", "projection"],
    "price_eur": ["price", "prix", "price eur", "prix eur"],
    "size_ml": ["size", "ml", "contenance", "volume", "size ml"],
    "rating_avg": ["rating", "note", "score", "rating avg"],
    "url": ["url", "link", "lien"],
    "segment": ["segment"],
    "country": ["country", "pays"],
    "review": ["review", "avis", "body", "comment", "commentaire", "review body"],
    "review_rating": ["review rating", "note avis", "stars", "etoiles"],
    "source": ["source"],
}
_LOOKUP = {norm(a): k for k, al in ALIASES.items() for a in al}


def _num(v):
    m = re.search(r"-?\d+(?:[.,]\d+)?", str(v or ""))
    return float(m.group(0).replace(",", ".")) if m else None


def _notes(v):
    if isinstance(v, list):
        return [n for x in v for n in (extract.find_notes(x) or [str(x).strip().lower()])]
    return extract.find_notes(v or "") or [s.strip().lower() for s in re.split(r"[,;/|]", v or "") if s.strip()]


def merge_row(con, raw, source):
    row = {}
    for k, v in raw.items():
        key = _LOOKUP.get(norm(k))
        if key and v not in (None, ""):
            row[key] = v
    if not row.get("brand") or not row.get("name"):
        return 0, 0
    rec = {"brand": str(row["brand"]).strip(), "name": str(row["name"]).strip(),
           "concentration": detect_concentration(row.get("concentration"), row["name"]),
           "nose": row.get("nose"), "url": row.get("url"), "segment": row.get("segment"),
           "country": row.get("country"), "sources": [source]}
    for k in ("notes_top", "notes_heart", "notes_base", "notes_all"):
        if row.get(k):
            rec[k] = _notes(row[k])
    for k in ("year", "longevity", "sillage", "price_eur", "size_ml", "rating_avg"):
        if row.get(k) is not None:
            rec[k] = _num(row[k])
    if rec.get("year"):
        rec["year"] = int(rec["year"])
    if rec.get("price_eur") and rec.get("size_ml"):
        rec["price_per_ml"] = round(rec["price_eur"] / rec["size_ml"], 2)
    rec["family"] = extract.family({"top": rec.get("notes_top", []), "heart": rec.get("notes_heart", []),
                                    "base": rec.get("notes_base", []), "all": rec.get("notes_all", [])})
    pid = upsert_perfume(con, rec)
    rv = 0
    if row.get("review"):
        rv = add_review(con, pid, row.get("source") or source, row["review"],
                        _num(row.get("review_rating")) or rec.get("rating_avg"))
    return 1, rv


def _html_rows(text):
    prods = _jsonld_products(text)
    if prods:
        for p in prods:
            brand = p.get("brand")
            brand = brand.get("name") if isinstance(brand, dict) else brand
            offers = p.get("offers") or {}
            offers = offers[0] if isinstance(offers, list) and offers else offers
            base = {"brand": brand, "name": p.get("name"), "url": p.get("url"),
                    "price": offers.get("price") if isinstance(offers, dict) else None,
                    "rating": (p.get("aggregateRating") or {}).get("ratingValue"),
                    "notes": strip_html(p.get("description") or "")}
            yield base
            for r in p.get("review") or []:
                yield {**base, "review": r.get("reviewBody") or r.get("description"),
                       "review rating": (r.get("reviewRating") or {}).get("ratingValue")}
        return
    for table in re.findall(r"<table.*?</table>", text, re.S | re.I):
        trs = re.findall(r"<tr.*?</tr>", table, re.S | re.I)
        if not trs:
            continue
        head = [strip_html(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", trs[0], re.S | re.I)]
        for tr in trs[1:]:
            cells = [strip_html(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)]
            if cells:
                yield dict(zip(head, cells))


def rows_from(path):
    path = Path(path)
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    suf = path.suffix.lower()
    if suf in (".csv", ".tsv", ".txt"):
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        yield from csv.DictReader(text.splitlines(), dialect=dialect)
    elif suf in (".json", ".jsonl", ".ndjson"):
        if suf != ".json" or text.lstrip().startswith("{") and "\n{" in text:
            data = [json.loads(l) for l in text.splitlines() if l.strip()]
        else:
            data = json.loads(text)
        if isinstance(data, dict):
            data = next((v for v in data.values() if isinstance(v, list)), [data])
        for d in data:
            reviews = d.pop("reviews", None) or d.pop("avis", None)
            yield d
            for r in reviews or []:
                if not isinstance(r, dict):
                    r = {"review": r}
                yield {**d, "review": r.get("review") or r.get("body") or r.get("text") or r.get("avis"),
                       "review rating": r.get("rating") or r.get("note"), "source": r.get("source")}
    elif suf in (".html", ".htm"):
        yield from _html_rows(text)
    else:
        raise ValueError(f"unsupported file type: {path}")


def import_files(paths):
    con = connect()
    tot_p = tot_r = 0
    for p in paths:
        np = nr = 0
        for row in rows_from(p):
            a, b = merge_row(con, row, f"import:{Path(p).name}")
            np += a
            nr += b
        con.commit()
        print(f"{p}: {np} perfume rows merged, {nr} new reviews", file=sys.stderr)
        tot_p += np
        tot_r += nr
    refresh_ratings(con)
    con.commit()
    return tot_p, tot_r


def import_inbox():
    INBOX.mkdir(parents=True, exist_ok=True)
    files = sorted(f for f in INBOX.iterdir() if f.suffix.lower() in (".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".html", ".htm"))
    if not files:
        return 0, 0
    res = import_files(files)
    done = INBOX / "done"
    done.mkdir(exist_ok=True)
    for f in files:
        f.rename(done / f.name)
    return res


if __name__ == "__main__":
    print(import_files(sys.argv[1:]) if len(sys.argv) > 1 else import_inbox())
