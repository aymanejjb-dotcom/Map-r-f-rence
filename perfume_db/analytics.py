"""Friction zones (tenue / sillage / prix) and White Space detection → dashboard payload."""
import json
from collections import defaultdict

from .core import connect

PRICE_BANDS = [(0, 1.5, "< 1,5 €/ml"), (1.5, 2.5, "1,5–2,5 €/ml"), (2.5, 4, "2,5–4 €/ml"), (4, 1e9, "> 4 €/ml")]
MIN_MENTIONS = 3


def band(ppm):
    if ppm is None:
        return None
    return next(l for lo, hi, l in PRICE_BANDS if lo <= ppm < hi)


def _friction(rows):
    """Per aspect: share of mentions that are negative (aspect < -0.2) and mention rate."""
    out = {"reviews": len(rows)}
    for a in ("longevity", "sillage", "price"):
        vals = [r[f"asp_{a}"] for r in rows if r[f"asp_{a}"] is not None]
        out[f"{a}_mentions"] = len(vals)
        out[f"{a}_friction"] = round(sum(v < -0.2 for v in vals) / len(vals), 3) if len(vals) >= MIN_MENTIONS else None
        out[f"{a}_score"] = round(sum(vals) / len(vals), 3) if vals else None
    s = [r["sentiment"] for r in rows if r["sentiment"] is not None]
    out["sentiment"] = round(sum(s) / len(s), 3) if s else None
    rt = [r["rating"] for r in rows if r["rating"] is not None]
    out["rating"] = round(sum(rt) / len(rt), 2) if rt else None
    return out


def build():
    con = connect()
    perfumes = [dict(r) for r in con.execute("SELECT * FROM master_perfumes ORDER BY brand, name")]
    reviews = [dict(r) for r in con.execute(
        "SELECT perfume_id, rating, sentiment, asp_longevity, asp_sillage, asp_price, lang, source FROM reviews")]
    by_p = defaultdict(list)
    for r in reviews:
        by_p[r["perfume_id"]].append(r)
    pmap = {p["id"]: p for p in perfumes}

    for p in perfumes:
        for k in ("notes_top", "notes_heart", "notes_base", "notes_all", "sources"):
            p[k] = json.loads(p[k]) if p[k] else []
        p.update({f"f_{k}": v for k, v in _friction(by_p[p["id"]]).items()})
        p["price_band"] = band(p["price_per_ml"])
        p.pop("description", None)
        p.pop("fingerprint", None)

    by_brand = defaultdict(list)
    for r in reviews:
        by_brand[pmap[r["perfume_id"]]["brand"]].append(r)
    brands = []
    for b in sorted({p["brand"] for p in perfumes}):
        ps = [p for p in perfumes if p["brand"] == b]
        ppm = [p["price_per_ml"] for p in ps if p["price_per_ml"]]
        brands.append({"brand": b, "segment": ps[0]["segment"], "perfumes": len(ps),
                       "median_ppm": round(sorted(ppm)[len(ppm) // 2], 2) if ppm else None,
                       **_friction(by_brand[b])})

    # White space: family × price band. Supply = French perfumes in the cell; demand signal =
    # reviews & satisfaction across the whole market (incl. foreign benchmarks); unmet need =
    # friction on tenue/sillage among what exists.
    cells = defaultdict(lambda: {"fr": 0, "intl": 0, "rows": []})
    for p in perfumes:
        if not p["family"] or not p["price_band"]:
            continue
        c = cells[(p["family"], p["price_band"])]
        c["intl" if p["segment"] == "niche_intl" else "fr"] += 1
        c["rows"] += by_p[p["id"]]
    families = sorted({f for f, _ in cells})
    max_fr = max([c["fr"] for c in cells.values()] or [1])
    max_rev = max([len(c["rows"]) for c in cells.values()] or [1])
    grid = []
    for f in families:
        for _, _, bl in PRICE_BANDS:
            c = cells.get((f, bl), {"fr": 0, "intl": 0, "rows": []})
            fr = _friction(c["rows"])
            demand = (len(c["rows"]) / max_rev) ** 0.5 if max_rev else 0
            sat = ((fr["rating"] or 3.5) - 1) / 4
            pain = max(fr["longevity_friction"] or 0, fr["sillage_friction"] or 0)
            scarcity = 1 - (c["fr"] / max_fr) ** 0.5
            ws = round(100 * scarcity * (0.45 * demand + 0.25 * sat + 0.3 * pain + (0.15 if c["intl"] and not c["fr"] else 0)), 1)
            grid.append({"family": f, "band": bl, "fr": c["fr"], "intl": c["intl"], "reviews": len(c["rows"]),
                         "rating": fr["rating"], "longevity_friction": fr["longevity_friction"],
                         "sillage_friction": fr["sillage_friction"], "price_friction": fr["price_friction"],
                         "white_space": ws})
    top_ws = sorted(grid, key=lambda g: -g["white_space"])[:8]

    note_stats = defaultdict(lambda: {"n": 0, "fr": 0, "rev": 0, "rating": []})
    for p in perfumes:
        for n in set(p["notes_all"] + p["notes_top"] + p["notes_heart"] + p["notes_base"]):
            s = note_stats[n]
            s["n"] += 1
            s["fr"] += p["segment"] != "niche_intl"
            s["rev"] += p["f_reviews"]
            if p["f_rating"]:
                s["rating"].append(p["f_rating"])
    notes = sorted(({"note": n, "perfumes": s["n"], "fr": s["fr"], "reviews": s["rev"],
                     "rating": round(sum(s["rating"]) / len(s["rating"]), 2) if s["rating"] else None}
                    for n, s in note_stats.items()), key=lambda x: -x["perfumes"])

    totals = {"perfumes": len(perfumes), "reviews": len(reviews), "brands": len(brands),
              "fr_perfumes": sum(p["segment"] != "niche_intl" for p in perfumes),
              "fr_reviews": sum(1 for r in reviews if pmap[r["perfume_id"]]["segment"] != "niche_intl"),
              "with_pyramid": sum(bool(p["notes_top"] or p["notes_base"]) for p in perfumes),
              "with_nose": sum(bool(p["nose"]) for p in perfumes),
              "langs": {str(l): sum(r["lang"] == l for r in reviews) for l in {r["lang"] for r in reviews}},
              "market": _friction(reviews)}
    return {"totals": totals, "brands": brands, "perfumes": perfumes, "grid": grid, "top_white_space": top_ws,
            "families": families, "bands": [b[2] for b in PRICE_BANDS], "notes": notes[:40]}
