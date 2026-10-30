"""Lexicon-based FR/EN aspect sentiment on reviews: overall polarity plus
longevity (tenue), sillage and price aspects, each in -1..1 (NULL = not discussed)."""
import re

from .core import connect, norm

FR_STOP = {"le", "la", "les", "et", "est", "un", "une", "des", "tres", "pas", "je", "il", "elle", "sur", "pour", "avec", "mais", "que", "qui", "ce", "mon", "ma"}
EN_STOP = {"the", "and", "is", "it", "a", "very", "not", "i", "this", "for", "with", "but", "that", "my", "on", "of", "smells", "scent"}

POS = set("""
love loved lovely amazing beautiful gorgeous wonderful excellent perfect great good nice fantastic stunning
divine delicious elegant sublime favorite favourite best addictive incredible gorgeous unique compliments
compliment recommend obsessed happy pleased magical sophisticated fresh classy sexy warm cosy cozy
adore adoré adore magnifique sublime superbe parfait parfaite excellent excellente genial geniale
merveilleux merveilleuse bon bonne beau belle top divin divine envoutant envoutante addictif addictive
coup coeur recommande ravi ravie elegant elegante raffine raffinee delicieux delicieuse sensuel sensuelle
tenace incroyable original originale unique compliments plaisir bravo merci signature
""".split())
NEG = set("""
bad terrible awful horrible disappointing disappointed disappointment cheap synthetic headache sickening
weak boring hate hated harsh sour chemical smells off overpriced pricey fades faded vanish vanishes
generic nauseating unpleasant meh poor regret refund broken leaked leak missing worst flat
decu decue decevant decevante deception mauvais mauvaise horrible chimique synthetique ecoeurant ecoeurante
migraine fade banal banale faible cher chere dommage regret rembourse casse fuite pire plat plate
desagreable entetant entetante lourd lourde vulgaire bof moyen moyenne
""".split())
NEGATORS = {"not", "no", "never", "dont", "doesnt", "didnt", "isnt", "wasnt", "without", "hardly",
            "pas", "ne", "jamais", "aucun", "aucune", "sans", "plus", "guere", "n"}
BOOST = {"very": 1.5, "really": 1.4, "so": 1.3, "extremely": 1.8, "super": 1.5, "tres": 1.5, "vraiment": 1.4,
         "trop": 1.3, "tellement": 1.5, "absolutely": 1.6, "totalement": 1.5, "incredibly": 1.7}

ASPECTS = {
    "longevity": {
        "kw": r"tenue|tient|tenir|tiens|dure|durer|duree|longevit\w*|longevity|lasts?|lasting|staying power|"
              r"wear time|hours?|heures?|evapor\w*|fades?|fading|vanish\w*|disappear\w*|disparai\w*|s estompe|"
              r"all day|toute la journee|stays|reste",
        "pos": r"(long lasting|lasts? (all|the whole|for) (day|night|hours)|lasts? (forever|ages)|"
               r"(\d{1,2}|ten|twelve|eight|several|many) ?\+? hours?|all day|toute la journee|"
               r"(bonne|excellente|tres bonne|belle|super|grande|incroyable) tenue|tenue (incroyable|excellente|"
               r"parfaite|exceptionnelle|remarquable|top|longue|de folie)|tient (tres bien|bien|longtemps|toute)|"
               r"(\d{1,2}) ?h(eures)?|great longevity|good longevity|excellent longevity|beast|lendemain|next day)",
        "neg": r"(fades? (quickly|fast|away|after|within)|doesn ?t last|does not last|didn ?t last|not last|"
               r"short ?lived|poor longevity|weak longevity|bad longevity|no longevity|gone (after|in|within)|"
               r"(disappears?|vanish\w*|evaporates?) (quickly|fast|after|within|in)|only lasts?|barely lasts?|"
               r"ne tient pas|tient pas|aucune tenue|tenue (faible|decevante|mediocre|moyenne|nulle|courte)|"
               r"(faible|mauvaise|petite|courte) tenue|s evapore|disparait (vite|rapidement|tres vite|en)|"
               r"ne dure pas|dure pas|trop vite|too fast|very fast|wish it lasted|"
               r"(1|2|une|deux|one|two|30|20) ?(min\w*|heures?|hours?|h) (max|maximum|seulement|only|tops))",
    },
    "sillage": {
        "kw": r"sillage|projection|projects?|projecting|trail|beast mode|skin scent|close to (the )?skin|"
              r"discret|discrete|intimate|intime|compliments?|remarque|noticed|room|piece|entoure|enveloppe|"
              r"puissant|powerful|strong|loud|subtle|subtil",
        "pos": r"(beau sillage|joli sillage|grand sillage|bon sillage|sillage (incroyable|magnifique|"
               r"superbe|enorme|puissant|present|genial|top)|great projection|good projection|strong projection|"
               r"projects? (well|beautifully|nicely)|beast mode|compliments?|remarque|noticed|fills? the room|"
               r"people (ask|stop|notice)|on me demande|on m a demande|leaves? a (beautiful )?trail)",
        "neg": r"(skin scent|close to (the )?skin|sits close|no projection|weak projection|poor projection|"
               r"little projection|barely project|doesn ?t project|aucun sillage|pas de sillage|peu de sillage|"
               r"sillage (faible|inexistant|leger|discret|decevant|nul)|trop discret|too (subtle|light|weak|soft)|"
               r"can ?t smell it|cannot smell it|ne le sens plus|sens plus rien|too (strong|loud|overpowering)|"
               r"trop (fort|puissant|entetant))",
    },
    "price": {
        "kw": r"prix|cher|chere|onereux|price|priced|pricey|expensive|cost|costs|value|worth|vaut|money|"
              r"budget|investissement|investment|rapport qualite|qualite prix|\$|€|euros?|dollars?",
        "pos": r"(worth (every|the) (penny|price|money|cent)|worth it|good value|great value|value for money|"
               r"bon rapport qualite|excellent rapport|vaut (le coup|son prix|chaque|largement)|"
               r"prix (raisonnable|correct|abordable|doux|juste)|affordable|reasonabl\w* priced|well priced|"
               r"bargain|good price|great price|bonne affaire|pas cher)",
        "neg": r"(overpriced|over priced|too expensive|very expensive|so expensive|pricey|not worth|isn ?t worth|"
               r"wasn ?t worth|waste of money|rip ?off|trop cher|tres cher|bien cher|un peu cher|hors de prix|"
               r"prix (eleve|excessif|exorbitant|abusif)|ne vaut pas|vaut pas|pas a ce prix|for (the|this) price|"
               r"a ce prix|for that price|price is (too )?(high|steep)|cher pour|expensive for)",
    },
}
_ASP = {k: {kk: re.compile(r"\b(?:" + v + r")", re.I) for kk, v in a.items()} for k, a in ASPECTS.items()}


def lang(text):
    w = set(norm(text).split())
    fr, en = len(w & FR_STOP), len(w & EN_STOP)
    return "fr" if fr > en else "en" if en else None


def polarity(text):
    toks = norm(text).split()
    score, hits = 0.0, 0
    for i, t in enumerate(toks):
        v = 1 if t in POS else -1 if t in NEG else 0
        if not v:
            continue
        window = toks[max(0, i - 3):i]
        if any(w in NEGATORS for w in window):
            v = -v * 0.8
        if window and window[-1] in BOOST:
            v *= BOOST[window[-1]]
        score += v
        hits += 1
    return 0.0 if not hits else max(-1.0, min(1.0, score / (hits + 1) * 1.5))


def aspect(sentences, name, rating):
    pats = _ASP[name]
    vals = []
    for s in sentences:
        n = norm(s)
        if not pats["kw"].search(n):
            continue
        pos, neg = bool(pats["pos"].search(n)), bool(pats["neg"].search(n))
        if pos != neg:
            vals.append(1.0 if pos else -1.0)
        else:
            p = polarity(s)
            if abs(p) < 0.15 and rating is not None:
                p = (rating - 3) / 2 * 0.5
            vals.append(p)
    return None if not vals else round(sum(vals) / len(vals), 3)


def analyse(body, title=None, rating=None):
    text = f"{title or ''}. {body}"
    sents = [s for s in re.split(r"(?<=[.!?;])\s+|\n+|,\s+(?:but|mais)\s+", text) if s.strip()]
    pol = polarity(text)
    if rating is not None:
        pol = 0.6 * pol + 0.4 * ((rating - 3) / 2)  # blend text with star rating
    return {"sentiment": round(pol, 3), "lang": lang(text),
            **{f"asp_{k}": aspect(sents, k, rating) for k in ("longevity", "sillage", "price")}}


def run():
    con = connect()
    rows = con.execute("SELECT id, title, body, rating, lang FROM reviews").fetchall()
    for r in rows:
        a = analyse(r["body"], r["title"], r["rating"])
        con.execute("UPDATE reviews SET sentiment=?, lang=COALESCE(lang, ?), asp_longevity=?, asp_sillage=?,"
                    " asp_price=? WHERE id=?",
                    (a["sentiment"], a["lang"], a["asp_longevity"], a["asp_sillage"], a["asp_price"], r["id"]))
    # NLP-derived tenue / sillage (0-5) where the brand declares none: 2.5 + 2.5 * mean aspect
    con.execute("""
      UPDATE master_perfumes SET
        longevity = COALESCE(longevity, (SELECT ROUND(2.5 + 2.5 * AVG(asp_longevity), 1) FROM reviews
                    WHERE perfume_id = master_perfumes.id AND asp_longevity IS NOT NULL)),
        sillage = COALESCE(sillage, (SELECT ROUND(2.5 + 2.5 * AVG(asp_sillage), 1) FROM reviews
                    WHERE perfume_id = master_perfumes.id AND asp_sillage IS NOT NULL))
    """)
    con.commit()
    return len(rows)


if __name__ == "__main__":
    print(run(), "reviews analysed")
