"""SQLite store for master_perfumes + reviews, with dedup/merge on insert."""
import hashlib
import html
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT.parent / "data" / "perfumes.sqlite"

CONCENTRATIONS = [
    ("Extrait", r"extrait|parfum extrait|pure perfume|\bextract\b|elixir"),
    ("EDP", r"eau de parfum|\bedp\b"),
    ("EDT", r"eau de toilette|\bedt\b"),
    ("Cologne", r"eau de cologne|cologne|\bedc\b"),
    ("Huile", r"huile de parfum|perfume oil|\boil\b"),
]
JSON_FIELDS = ("notes_top", "notes_heart", "notes_base", "notes_all", "sources")


def connect(path=DB_PATH):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript((ROOT / "schema.sql").read_text())
    return con


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def strip_html(s):
    s = re.sub(r"<(br|/p|/li|/div|/h\d)[^>]*>", "\n", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s).replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", s)).strip()


def detect_concentration(*texts):
    t = " ".join(norm(x) for x in texts if x)
    for label, pat in CONCENTRATIONS:
        if re.search(pat, t):
            return label
    return None


# Words removed from names before fingerprinting so "Ambre Sultan Eau de Parfum 50ml"
# and "Ambre Sultan" merge.
_NAME_NOISE = re.compile(
    r"\b(eau de parfum|eau de toilette|eau de cologne|extrait de parfum|extrait|parfum|edp|edt|"
    r"spray|vaporisateur|refill|recharge|\d+(?:[ .,]\d+)?\s*ml|\d+(?:[ .,]\d+)?\s*(?:fl )?oz|travel|"
    r"sample|echantillon|miniature|mini|vial|tester|flacon|bottle|new|nouveau)\b")


def clean_name(name, brand=""):
    n = norm(name)
    b = norm(brand)
    if b and n.startswith(b + " "):
        n = n[len(b) + 1:]
    n = _NAME_NOISE.sub(" ", n)
    return re.sub(r"\s+", " ", n).strip() or norm(name)


def fingerprint(brand, name, concentration=None):
    return "|".join([norm(brand), clean_name(name, brand), (concentration or "").lower()])


def _merge_json(a, b):
    out = list(json.loads(a) if isinstance(a, str) else (a or []))
    for x in (json.loads(b) if isinstance(b, str) else (b or [])):
        if x not in out:
            out.append(x)
    return out


def upsert_perfume(con, rec):
    """Insert or merge a perfume. Existing non-empty values are kept, empty ones filled,
    list fields unioned. Returns the row id."""
    rec = {k: v for k, v in rec.items() if v not in (None, "", [], {})}
    fp = rec.get("fingerprint") or fingerprint(rec["brand"], rec["name"], rec.get("concentration"))
    rec["fingerprint"] = fp
    row = con.execute("SELECT * FROM master_perfumes WHERE fingerprint=?", (fp,)).fetchone()
    if row is None and rec.get("concentration"):
        # same scent previously stored without concentration: adopt it
        loose = fingerprint(rec["brand"], rec["name"], None)
        row = con.execute("SELECT * FROM master_perfumes WHERE fingerprint=?", (loose,)).fetchone()
        if row:
            con.execute("UPDATE master_perfumes SET fingerprint=?, concentration=? WHERE id=?",
                        (fp, rec["concentration"], row["id"]))
    if row is None and not rec.get("concentration"):
        # no concentration given: join the single stored variant of that scent, if unambiguous
        cands = con.execute("SELECT * FROM master_perfumes WHERE fingerprint LIKE ?",
                            (fp.rstrip("|").replace("%", "") + "|%",)).fetchall()
        if len(cands) == 1:
            row = cands[0]
            fp = rec["fingerprint"] = row["fingerprint"]
    for f in JSON_FIELDS:
        if f in rec and not isinstance(rec[f], str):
            rec[f] = json.dumps(rec[f], ensure_ascii=False)
    if row is None:
        cols = list(rec)
        con.execute(f"INSERT INTO master_perfumes ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                    [rec[c] for c in cols])
        return con.execute("SELECT id FROM master_perfumes WHERE fingerprint=?", (fp,)).fetchone()[0]
    upd = {}
    for k, v in rec.items():
        if k in ("fingerprint",):
            continue
        if k in ("sources", "notes_all"):
            merged = json.dumps(_merge_json(row[k], v), ensure_ascii=False)
            if merged != row[k]:
                upd[k] = merged
        elif row[k] in (None, "", "[]"):
            upd[k] = v
    if upd:
        upd["updated_at"] = None
        sets = ",".join(f"{k}=?" if k != "updated_at" else "updated_at=datetime('now')" for k in upd)
        con.execute(f"UPDATE master_perfumes SET {sets} WHERE id=?",
                    [v for k, v in upd.items() if k != "updated_at"] + [row["id"]])
    return row["id"]


def review_hash(source, perfume_id, body):
    return hashlib.sha1(f"{source}|{perfume_id}|{norm(body)[:400]}".encode()).hexdigest()


def add_review(con, perfume_id, source, body, rating=None, title=None, lang=None,
               verified=None, review_date=None):
    body = strip_html(body)
    if len(body) < 3:
        return False
    h = review_hash(source, perfume_id, body)
    cur = con.execute(
        "INSERT OR IGNORE INTO reviews (review_hash, perfume_id, source, rating, title, body, lang,"
        " verified, review_date) VALUES (?,?,?,?,?,?,?,?,?)",
        (h, perfume_id, source, rating, title, body, lang, verified, review_date))
    return cur.rowcount == 1


def refresh_ratings(con):
    con.execute("""
      UPDATE master_perfumes SET
        rating_count = (SELECT COUNT(*) FROM reviews r WHERE r.perfume_id = master_perfumes.id),
        rating_avg = COALESCE((SELECT ROUND(AVG(rating), 2) FROM reviews r
                               WHERE r.perfume_id = master_perfumes.id AND rating IS NOT NULL), rating_avg)
    """)
