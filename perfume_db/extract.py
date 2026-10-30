"""Pulls olfactory pyramid, nose, year, declared longevity/sillage out of free text."""
import re

from .core import norm

# canonical note -> (family, aliases FR/EN)
NOTES = {
    "bergamote": ("hesperide", ["bergamot", "bergamote"]),
    "citron": ("hesperide", ["lemon", "citron", "yuzu", "cedrat", "citrus"]),
    "orange": ("hesperide", ["orange", "bitter orange", "orange amere", "mandarin", "mandarine", "clementine"]),
    "pamplemousse": ("hesperide", ["grapefruit", "pamplemousse"]),
    "neroli": ("floral", ["neroli", "petitgrain", "petit grain"]),
    "fleur d'oranger": ("floral", ["orange blossom", "fleur d oranger", "orange flower"]),
    "rose": ("floral", ["rose", "roses", "rosa damascena", "rose de mai", "centifolia"]),
    "jasmin": ("floral", ["jasmine", "jasmin", "sambac"]),
    "tubereuse": ("floral", ["tuberose", "tubereuse"]),
    "iris": ("floral", ["iris", "orris"]),
    "violette": ("floral", ["violet", "violette", "violet leaf", "feuille de violette"]),
    "ylang-ylang": ("floral", ["ylang", "ylang ylang"]),
    "magnolia": ("floral", ["magnolia"]),
    "pivoine": ("floral", ["peony", "pivoine"]),
    "muguet": ("floral", ["lily of the valley", "muguet"]),
    "mimosa": ("floral", ["mimosa"]),
    "osmanthus": ("floral", ["osmanthus"]),
    "geranium": ("floral", ["geranium"]),
    "heliotrope": ("floral", ["heliotrope"]),
    "lavande": ("aromatique", ["lavender", "lavande", "lavandin"]),
    "romarin": ("aromatique", ["rosemary", "romarin"]),
    "sauge": ("aromatique", ["sage", "sauge", "clary sage"]),
    "menthe": ("aromatique", ["mint", "menthe"]),
    "basilic": ("aromatique", ["basil", "basilic"]),
    "the": ("aromatique", ["tea", "the noir", "the vert", "black tea", "green tea", "mate"]),
    "figue": ("vert", ["fig", "figue", "figuier"]),
    "galbanum": ("vert", ["galbanum"]),
    "herbe": ("vert", ["grass", "herbe", "green notes", "notes vertes"]),
    "poivre": ("epice", ["pepper", "poivre", "pink pepper", "baies roses", "black pepper"]),
    "cardamome": ("epice", ["cardamom", "cardamome"]),
    "safran": ("epice", ["saffron", "safran"]),
    "cannelle": ("epice", ["cinnamon", "cannelle"]),
    "gingembre": ("epice", ["ginger", "gingembre"]),
    "clou de girofle": ("epice", ["clove", "girofle"]),
    "muscade": ("epice", ["nutmeg", "muscade"]),
    "encens": ("ambre", ["incense", "encens", "olibanum", "frankincense"]),
    "ambre": ("ambre", ["amber", "ambre", "ambergris", "ambre gris", "ambroxan", "ambrette"]),
    "labdanum": ("ambre", ["labdanum", "ciste", "cistus"]),
    "benjoin": ("ambre", ["benzoin", "benjoin"]),
    "myrrhe": ("ambre", ["myrrh", "myrrhe"]),
    "oud": ("boise", ["oud", "agarwood", "bois d agar", "oudh"]),
    "santal": ("boise", ["sandalwood", "santal", "bois de santal"]),
    "cedre": ("boise", ["cedar", "cedre", "cedarwood"]),
    "vetiver": ("boise", ["vetiver"]),
    "patchouli": ("boise", ["patchouli"]),
    "gaiac": ("boise", ["guaiac", "gaiac"]),
    "cypres": ("boise", ["cypress", "cypres"]),
    "pin": ("boise", ["pine", "pin ", "aiguilles de pin", "pine needles", "fir", "sapin"]),
    "bouleau": ("cuir", ["birch", "bouleau"]),
    "cuir": ("cuir", ["leather", "cuir", "suede", "daim"]),
    "tabac": ("cuir", ["tobacco", "tabac"]),
    "mousse de chene": ("chypre", ["oakmoss", "mousse de chene", "moss", "mousse"]),
    "vanille": ("gourmand", ["vanilla", "vanille"]),
    "tonka": ("gourmand", ["tonka", "feve tonka"]),
    "caramel": ("gourmand", ["caramel", "praline", "praline", "toffee"]),
    "cacao": ("gourmand", ["cocoa", "cacao", "chocolate", "chocolat"]),
    "cafe": ("gourmand", ["coffee", "cafe", "espresso"]),
    "miel": ("gourmand", ["honey", "miel"]),
    "amande": ("gourmand", ["almond", "amande", "pistachio", "pistache"]),
    "rhum": ("gourmand", ["rum", "rhum", "cognac", "whisky", "whiskey"]),
    "coco": ("gourmand", ["coconut", "coco"]),
    "musc": ("musque", ["musk", "musc", "muscs", "white musk"]),
    "aldehydes": ("musque", ["aldehyde", "aldehydes"]),
    "notes marines": ("frais", ["marine", "sea salt", "sel marin", "ocean", "aquatic", "iode", "algue"]),
    "fruits rouges": ("fruite", ["raspberry", "framboise", "blackcurrant", "cassis", "berries", "fruits rouges", "cherry", "cerise", "strawberry", "fraise"]),
    "peche": ("fruite", ["peach", "peche", "apricot", "abricot", "plum", "prune"]),
    "poire": ("fruite", ["pear", "poire", "apple", "pomme"]),
    "fruits exotiques": ("fruite", ["mango", "mangue", "pineapple", "ananas", "passion fruit", "fruit de la passion", "lychee", "litchi"]),
}

FAMILY_LABEL = {
    "hesperide": "Hespéridé", "floral": "Floral", "aromatique": "Aromatique", "vert": "Vert",
    "epice": "Épicé", "ambre": "Ambré", "boise": "Boisé", "cuir": "Cuir", "chypre": "Chypré",
    "gourmand": "Gourmand", "musque": "Musqué", "frais": "Aquatique", "fruite": "Fruité",
}

_ALIAS = sorted(((norm(a), canon) for canon, (_, al) in NOTES.items() for a in al),
                key=lambda x: -len(x[0]))
_ALIAS_RE = re.compile(r"\b(" + "|".join(re.escape(a) for a, _ in _ALIAS) + r")\b")
_ALIAS_MAP = dict(_ALIAS)


def find_notes(text):
    out = []
    for m in _ALIAS_RE.finditer(norm(text)):
        c = _ALIAS_MAP[m.group(1)]
        if c not in out:
            out.append(c)
    return out


_TIER = {
    "top": r"(?:notes? de t[eê]te|top notes?|head notes?|t[eê]te|opening|d[ée]part)",
    "heart": r"(?:notes? de c(?:oe|œ)ur|heart notes?|middle notes?|c(?:oe|œ)ur|heart)",
    "base": r"(?:notes? de fond|base notes?|fond|base|dry ?down)",
}


def pyramid(text):
    """Return {'top': [...], 'heart': [...], 'base': [...]} when the text spells out tiers."""
    res = {}
    for tier, pat in _TIER.items():
        m = re.search(pat + r"\s*[:\-–]\s*([^\n]{3,220})", text, re.I)
        if m:
            seg = re.split(r"(?:" + "|".join(_TIER.values()) + r")\s*[:\-–]", m.group(1), flags=re.I)[0]
            notes = find_notes(seg)
            if notes:
                res[tier] = notes
    return res


_NOSE = re.compile(
    r"(?:parfumeu(?:r|se)s?|perfumers?|nez|noses?|cr[ée]{1,2}e? par|created by|composed by|compos[ée]e? par|signed by|sign[ée]e? par)"
    r"\s*[:\-–]?\s*((?:[A-ZÀ-Ý][\w'’\-]+\.?\s?){1,4}(?:\s?(?:&|et|and|,)\s?(?:[A-ZÀ-Ý][\w'’\-]+\s?){1,4})?)")
_NOT_A_NAME = {"Paris", "The", "Le", "La", "Les", "Eau", "Parfum", "Maison", "Notre", "Our", "This", "Ce", "Cette"}


def nose(text):
    for m in _NOSE.finditer(text or ""):
        cand = m.group(1).strip(" ,.&")
        words = cand.split()
        if len(words) >= 2 and words[0] not in _NOT_A_NAME:
            return cand
    return None


def year(text):
    m = re.search(r"\b(?:launched|lanc[ée]|created|cr[ée]{1,2}e?|since|depuis|en|in)\s+(19[5-9]\d|20[0-2]\d)\b", text or "", re.I)
    return int(m.group(1)) if m else None


def declared_level(text, kind):
    """Declared longevity/sillage on a 0-5 scale, e.g. 'Tenue : 4/5', 'Sillage: intense'."""
    pat = {"longevity": r"(?:tenue|longevity|lasting|longev)", "sillage": r"(?:sillage|projection|trail)"}[kind]
    m = re.search(pat + r"\s*[:\-–]?\s*(\d(?:[.,]\d)?)\s*/\s*(5|10)", text or "", re.I)
    if m:
        v = float(m.group(1).replace(",", "."))
        return round(v / (2 if m.group(2) == "10" else 1), 1)
    m = re.search(pat + r"\s*[:\-–]\s*(tr[eè]s (?:forte?|longue|intense)|very (?:strong|long)|intense|forte?|longue|long|moder[ée]e?|moderate|moyenne?|medium|l[ée]g[eè]re?|light|discr[eè]te?|soft|intime|intimate)", text or "", re.I)
    if m:
        w = norm(m.group(1))
        for keys, v in (((
            "tres", "very"), 5), (("intense", "fort", "long"), 4), (("moder", "moyen", "medium"), 3),
                ((("leg", "light", "soft")), 2), (("discr", "intim"), 1.5)):
            if any(k in w for k in keys):
                return float(v)
    return None


def family(notes):
    """Dominant family: base/heart notes weigh more than top."""
    score = {}
    for tier, w in (("top", 1), ("heart", 1.5), ("base", 2), ("all", 1)):
        for n in notes.get(tier, []):
            f = NOTES.get(n, ("autre",))[0]
            score[f] = score.get(f, 0) + w
    if not score:
        return None
    return FAMILY_LABEL.get(max(score, key=score.get), "Autre")


def size_ml(text):
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*ml\b", text or "", re.I)
    if m:
        return float(m.group(1).replace(",", "."))
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:fl\.?\s*)?oz\b", text or "", re.I)
    return round(float(m.group(1).replace(",", ".")) * 29.57) if m else None
