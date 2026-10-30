"""Brand sources. `kind`: shopify (public /products.json catalogue) or sitemap
(schema.org JSON-LD on product pages). Segment: niche_fr = French niche house,
niche_emergent = French house founded ~2015+, niche_intl = foreign benchmark."""

BRANDS = [
    # brand, domain, kind, segment, country
    ("Maison Violet", "www.maisonviolet.com", "shopify", "niche_emergent", "FR"),
    ("Une Nuit Nomade", "www.unenuitnomade.com", "sitemap", "niche_emergent", "FR"),
    ("Versatile Paris", "www.versatileparis.com", "shopify", "niche_emergent", "FR"),
    ("Serge Lutens", "www.sergelutens.com", "shopify", "niche_fr", "FR"),
    ("Frédéric Malle", "www.fredericmalle.com", "sitemap", "niche_fr", "FR"),
    ("L'Artisan Parfumeur", "www.artisanparfumeur.com", "sitemap", "niche_fr", "FR"),
    ("Parfum d'Empire", "www.parfumdempire.com", "sitemap", "niche_fr", "FR"),
    ("Goutal", "www.goutalparis.com", "shopify", "niche_fr", "FR"),
    ("Etat Libre d'Orange", "www.etatlibredorange.com", "shopify", "niche_fr", "FR"),
    ("Atelier Materi", "www.atelier-materi.com", "shopify", "niche_emergent", "FR"),
    ("Marc-Antoine Barrois", "www.marcantoinebarrois.com", "shopify", "niche_emergent", "FR"),
    ("Maison Crivelli", "www.maisoncrivelli.com", "shopify", "niche_emergent", "FR"),
    ("Essential Parfums", "www.essentialparfums.com", "shopify", "niche_emergent", "FR"),
    ("Matière Première", "www.matiere-premiere.com", "shopify", "niche_emergent", "FR"),
    ("BDK Parfums", "www.bdkparfums.com", "shopify", "niche_emergent", "FR"),
    ("Histoires de Parfums", "www.histoiresdeparfums.com", "shopify", "niche_fr", "FR"),
    ("Atelier des Ors", "www.atelierdesors.com", "shopify", "niche_emergent", "FR"),
    ("Memo Paris", "www.memoparis.com", "shopify", "niche_fr", "FR"),
    ("Maison Matine", "www.maisonmatine.com", "shopify", "niche_emergent", "FR"),
    ("Hermetica", "www.hermetica.com", "shopify", "niche_emergent", "FR"),
    ("Parfums de Marly", "www.parfums-de-marly.com", "shopify", "niche_fr", "FR"),
    ("Atelier Flou", "www.atelier-flou.com", "shopify", "niche_emergent", "FR"),
    ("Bon Parfumeur", "www.bonparfumeur.com", "shopify", "niche_emergent", "FR"),
    ("Initio Parfums Privés", "www.initioparfums.com", "shopify", "niche_fr", "FR"),
    ("Juliette Has a Gun", "www.juliettehasagun.com", "shopify", "niche_fr", "FR"),
    ("Caron", "www.parfumscaron.com", "shopify", "niche_fr", "FR"),
    ("Molinard", "www.molinard.com", "shopify", "niche_fr", "FR"),
    ("Pernoire", "www.pernoire.com", "shopify", "niche_emergent", "FR"),
    ("Parfums Berry", "www.parfumsberry.com", "shopify", "niche_emergent", "FR"),
    ("Nissaba", "www.nissaba.com", "shopify", "niche_emergent", "FR"),
    ("Maison Tahité", "www.maisontahite.com", "shopify", "niche_emergent", "FR"),
    ("Oriza L. Legrand", "www.orizalegrand.com", "shopify", "niche_fr", "FR"),
    ("Ex Nihilo", "www.ex-nihilo-paris.com", "sitemap", "niche_fr", "FR"),
    ("Diptyque", "www.diptyqueparis.com", "shopify", "niche_fr", "FR"),
    # foreign benchmarks for white-space comparison
    ("Amouage", "www.amouage.com", "shopify", "niche_intl", "OM"),
    ("Xerjoff", "www.xerjoff.com", "shopify", "niche_intl", "IT"),
    ("Ormonde Jayne", "www.ormondejayne.com", "shopify", "niche_intl", "GB"),
    ("Zoologist", "www.zoologistperfumes.com", "shopify", "niche_intl", "CA"),
    ("Mizensir", "www.mizensir.com", "shopify", "niche_intl", "CH"),
    ("Nasomatto", "www.nasomatto.com", "shopify", "niche_intl", "NL"),
    ("Goldfield & Banks", "www.goldfieldandbanks.com", "shopify", "niche_intl", "AU"),
    ("Fragrance du Bois", "www.fragrancedubois.com", "shopify", "niche_intl", "CH"),
]

# Rough FX to EUR for shops not selling in EUR.
FX_EUR = {"EUR": 1.0, "USD": 0.92, "GBP": 1.17, "CHF": 1.05, "AUD": 0.6, "CAD": 0.67, "AED": 0.25}
