#!/usr/bin/env python3
"""Compile the niche perfumery dataset (BE, NL, DE, FR, LU, CH).

Outputs:
  perfumeries.json  canonical dataset
  perfumeries.js    same data as `window.PERFUMERIES` so index.html works from file://

Scores are editorial estimates (curation, prestige, openness to indie brands),
not measured values. Every row carries an exact street address and building-level
coordinates (OpenStreetMap/Nominatim), so `address_confidence` is always "confirmed".
Monobrand flagships (no third-party brands, brand fit = 0) and generic placeholders
are deliberately excluded.
"""
import json
import sys
from pathlib import Path
from urllib.parse import quote_plus

NB, CS, DS = "Niche Boutique", "Independent Concept Store", "Department Store"

TRAITS = {
    "FS": "Allows free sniffing",
    "GS": "Generous samples",
    "ES": "Expert staff",
    "PS": "Pushes sales",
    "TC": "Tourist crowds",
    "IB": "Curated indie brands",
    "MB": "Monobrand",
    "AP": "Appointment-friendly",
    "GW": "Gift wrapping",
    "BW": "Busy weekends",
    "DB": "Discovery bar / blotters",
    "LX": "Luxury service",
}

# (name, type, country, city, address, lat, lng, tier, align, openness,
#  cx_rating, traits, sentiment)
RAW = [
    # ---------------------------------------------------------------- FRANCE
    ("Jovoy Paris", NB, "FR", "Paris", "4 Rue de Castiglione, 75001 Paris, France", 48.86560, 2.32775, 96, 72, "High", 4.6, "ES FS GS IB DB",
     "Widely seen as the temple of independent perfumery; staff are passionate and let visitors explore hundreds of houses at leisure."),
    ("Nose", CS, "FR", "Paris", "20 Rue Bachaumont, 75002 Paris, France", 48.86621, 2.34484, 88, 82, "High", 4.5, "ES FS DB IB AP",
     "Known for its olfactory diagnosis that recommends scents by profile; calm, pedagogic atmosphere with strong indie curation."),
    ("Sens Unique", NB, "FR", "Paris", "13 Rue du Roi de Sicile, 75004 Paris, France", 48.85600, 2.35894, 82, 86, "High", 4.6, "ES FS GS IB",
     "Intimate Marais boutique praised for owners who champion small artisan houses and take time with every customer."),
    ("Marie Antoinette", NB, "FR", "Paris", "5 Rue d'Ormesson, 75004 Paris, France", 48.85517, 2.36283, 80, 84, "High", 4.7, "ES FS IB GS",
     "Tiny jewel-box shop on a Marais square; reviewers love the founder's personal storytelling and rare discoveries."),
    ("Dover Street Parfums Market", CS, "FR", "Paris", "11 bis Rue d'Alger, 75001 Paris, France", 48.86557, 2.32990, 89, 62, "Med", 4.5, "ES FS DB IB LX",
     "Gallery-like space by the Comme des Garçons/DSM team with a sharp, experimental edit; staff are knowledgeable but selective."),
    ("Liquides Bar à Parfums", CS, "FR", "Paris", "9 Rue de Normandie, 75003 Paris, France", 48.86342, 2.36407, 85, 88, "High", 4.7, "ES FS DB IB GS",
     "Bar-style tasting counter where fragrances are served like spirits; beloved for its relaxed, geeky expertise."),
    ("Le Bon Marché Rive Gauche", DS, "FR", "Paris", "24 Rue de Sèvres, 75007 Paris, France", 48.85104, 2.32413, 93, 34, "Low", 4.2, "LX ES FS PS BW",
     "The most refined Paris department store; its beauty hall mixes heritage houses and selected niche, with a calmer crowd than Haussmann."),
    ("Printemps Haussmann", DS, "FR", "Paris", "64 Boulevard Haussmann, 75009 Paris, France", 48.87389, 2.32905, 90, 30, "Low", 3.9, "TC PS LX BW",
     "Huge fragrance floor with exclusive launches; great breadth but very busy and sales-driven at peak times."),
    ("Galeries Lafayette Haussmann", DS, "FR", "Paris", "40 Boulevard Haussmann, 75009 Paris, France", 48.87365, 2.33213, 91, 28, "Low", 3.8, "TC PS BW LX",
     "Iconic dome and Europe's largest beauty hall; impressive choice, but crowded and transactional."),
    ("Galeries Lafayette Champs-Élysées", DS, "FR", "Paris", "60 Avenue des Champs-Élysées, 75008 Paris, France", 48.87078, 2.30644, 88, 32, "Low", 4.0, "TC LX PS IB",
     "Concept-store take on the department store with a curated niche wall; tourist-heavy but more contemporary edit."),
    ("La Samaritaine (DFS)", DS, "FR", "Paris", "9 Rue de la Monnaie, 75001 Paris, France", 48.85921, 2.34235, 90, 25, "Low", 4.1, "LX TC PS",
     "Spectacular Art Nouveau setting with a large beauty floor; polished service, travel-retail pricing and atmosphere."),
    ("BHV Marais", DS, "FR", "Paris", "52 Rue de Rivoli, 75004 Paris, France", 48.85747, 2.35335, 70, 40, "Low", 3.5, "BW PS",
     "Practical central store with a mainstream-leaning beauty floor; occasional pop-ups for emerging brands."),
    ("Galeries Lafayette Nice Masséna", DS, "FR", "Nice", "6 Avenue Jean Médecin, 06000 Nice, France", 43.69845, 7.26953, 74, 30, "Low", 3.7, "TC PS",
     "Main Riviera department store; solid prestige brands, limited niche depth."),
    ("Galeries Lafayette Bordeaux", DS, "FR", "Bordeaux", "11-19 Rue Sainte-Catherine, 33000 Bordeaux, France", 44.84137, -0.57450, 72, 30, "Low", 3.6, "BW PS",
     "Busy city-centre store; useful prestige counters, niche selection rotates."),
    ("Galeries Lafayette Strasbourg", DS, "FR", "Strasbourg", "34 Rue du 22 Novembre, 67000 Strasbourg, France", 48.58257, 7.74480, 72, 30, "Low", 3.6, "PS BW",
     "Largest beauty floor in Alsace; attracts cross-border German shoppers."),
    ("Printemps Lille", DS, "FR", "Lille", "39-41 Rue Nationale, 59000 Lille, France", 50.63634, 3.06122, 70, 32, "Low", 3.6, "PS BW",
     "Elegant regional store close to Belgian border; mainstream prestige with occasional niche corners."),
    ("Galeries Lafayette Marseille Saint-Ferréol", DS, "FR", "Marseille", "40-48 Rue Saint-Ferréol, 13001 Marseille, France", 43.29401, 5.37796, 70, 30, "Low", 3.5, "BW PS",
     "Central Marseille store; prestige counters, limited niche."),
    ("Galeries Lafayette Lyon Part-Dieu", DS, "FR", "Lyon", "17 Rue du Docteur Bouchut (Centre commercial La Part-Dieu), 69003 Lyon, France", 45.76001, 4.85544, 70, 30, "Low", 3.5, "BW PS",
     "High-traffic mall department store; dependable prestige range."),

    # --------------------------------------------------------------- BELGIUM
    ("Senteurs d'Ailleurs", NB, "BE", "Brussels", "Place Stéphanie 1A, 1050 Ixelles, Belgique", 50.83355, 4.35861, 93, 72, "High", 4.6, "ES FS GS IB LX",
     "Belgium's reference for niche perfumery; deep catalogue, elegant setting and staff who know every house."),
    ("Place Vendôme Haute Parfumerie", NB, "BE", "Wezembeek-Oppem", "Leuvensesteenweg 357, 1932 Wezembeek-Oppem, Belgique", 50.86488, 4.43771, 84, 76, "High", 4.6, "ES FS GS IB AP",
     "Out-of-town destination for collectors; reviewers praise generous sampling and personal follow-up."),
    ("Liquides Confidentiels", NB, "BE", "Namur", "Rue de Fer 35, 5000 Namur, Belgique", 50.46571, 4.86461, 78, 85, "High", 4.7, "ES FS GS IB",
     "Small independent shop with a cult following in Wallonia; very open to undiscovered indie houses."),
    ("Skins Antwerpen", CS, "BE", "Antwerp", "Schuttershofstraat 22, 2000 Antwerpen, Belgique", 51.21654, 4.40685, 85, 75, "Med", 4.5, "ES FS IB DB",
     "Minimalist Skins concept with a tight niche edit; staff guide by olfactive family."),
    ("Skins Gent", CS, "BE", "Ghent", "Brabantdam 17, 9000 Gent, Belgique", 51.05063, 3.72714, 83, 75, "Med", 4.5, "ES FS IB",
     "Calm, design-led boutique; appreciated for unhurried advice."),
    ("Parfumerie De Smedt", NB, "BE", "Aalst", "Kattestraat 28, 9300 Aalst, Belgique", 50.93940, 4.03743, 72, 70, "Med", 4.3, "ES FS",
     "Family-run perfumery with loyal local customers and personal service."),
    ("Inno Rue Neuve", DS, "BE", "Brussels", "Rue Neuve 111, 1000 Bruxelles, Belgique", 50.85288, 4.35637, 72, 35, "Low", 3.5, "BW PS TC",
     "Belgium's flagship department store; broad prestige perfumery with a few luxury corners."),
    ("Inno Meir", DS, "BE", "Antwerp", "Meir 78, 2000 Antwerpen, Belgique", 51.21765, 4.41147, 70, 35, "Low", 3.5, "BW PS",
     "Busy high-street store on Antwerp's main shopping axis; mainstream-leaning."),
    ("Graanmarkt 13", CS, "BE", "Antwerp", "Graanmarkt 13, 2000 Antwerpen, Belgique", 51.21624, 4.40874, 86, 62, "Med", 4.5, "IB LX ES",
     "Celebrated concept store-restaurant-apartment; beauty edit is small but very discerning."),
    ("Hunting and Collecting", CS, "BE", "Brussels", "Rue des Chartreux 17, 1000 Bruxelles, Belgique", 50.84889, 4.34673, 78, 65, "Med", 4.3, "IB",
     "Fashion-led concept store in Dansaert with occasional indie fragrance drops."),
    ("Smets Brussels", CS, "BE", "Brussels", "Chaussée de Louvain 650, 1030 Schaerbeek, Belgique", 50.85528, 4.40148, 82, 50, "Med", 4.1, "LX IB",
     "Large luxury concept store; polished, gallery-like and brand-heavy."),

    # ------------------------------------------------------------ NETHERLANDS
    ("Skins Cosmetics Amsterdam", CS, "NL", "Amsterdam", "Runstraat 9, 1016 GJ Amsterdam, Pays-Bas", 52.36881, 4.88377, 89, 80, "Med", 4.6, "ES FS IB DB GS",
     "Pioneer of niche in the Nine Streets; staff are known for spot-on recommendations and generous samples."),
    ("Skins Cosmetics Den Haag", CS, "NL", "The Hague", "Hoogstraat 6, 2513 AR Den Haag, Pays-Bas", 52.07840, 4.30894, 85, 78, "Med", 4.5, "ES FS IB LX",
     "Upmarket clientele near the royal quarter; calm and service-driven."),
    ("Perfume Lounge", NB, "NL", "Amsterdam", "Cornelis Schuytstraat 63, 1071 JG Amsterdam, Pays-Bas", 52.35472, 4.87128, 80, 84, "High", 4.6, "ES FS GS IB",
     "Cosy independent lounge where owners love introducing small houses."),
    ("Babassu Amsterdam", NB, "NL", "Amsterdam", "Cornelis Schuytstraat 40, 1071 GP Amsterdam, Pays-Bas", 52.35466, 4.87142, 80, 80, "High", 4.5, "ES FS IB",
     "Boutique niche perfumery with a warm, advisory approach."),
    ("Babassu Den Haag", NB, "NL", "The Hague", "Dagelijkse Groenmarkt 30, 2513 AL Den Haag, Pays-Bas", 52.07763, 4.30856, 80, 80, "High", 4.5, "ES FS IB",
     "Elegant shop favoured by expats and diplomats; strong personal service."),
    ("Casa Babassu Wassenaar", NB, "NL", "Wassenaar", "Langstraat 13-15, 2242 KJ Wassenaar, Pays-Bas", 52.14472, 4.39241, 79, 80, "High", 4.6, "ES FS LX",
     "Village boutique with high-end clientele and very personal follow-up."),
    ("Lianne Tio Luxury Parfums", NB, "NL", "The Hague", "Denneweg 64, 2514 CJ Den Haag, Pays-Bas", 52.08503, 4.31246, 80, 75, "High", 4.5, "ES FS IB",
     "Independent luxury perfumery known for personal curation."),
    ("De Bijenkorf Amsterdam", DS, "NL", "Amsterdam", "Dam 1, 1012 JS Amsterdam, Pays-Bas", 52.37335, 4.89394, 88, 35, "Low", 4.0, "LX TC PS BW",
     "The Netherlands' premier department store; deep niche & luxury counters, very busy on Dam square."),
    ("De Bijenkorf Rotterdam", DS, "NL", "Rotterdam", "Coolsingel 105, 3012 AG Rotterdam, Pays-Bas", 51.92025, 4.47887, 85, 35, "Low", 3.9, "LX PS",
     "Modernist landmark with a broad beauty floor; well-stocked niche corners."),
    ("De Bijenkorf Den Haag", DS, "NL", "The Hague", "Wagenstraat 32, 2512 AX Den Haag, Pays-Bas", 52.07650, 4.31244, 84, 35, "Low", 3.9, "LX PS",
     "Art Deco building; calmer than Amsterdam with good counter staff."),
    ("De Bijenkorf Utrecht", DS, "NL", "Utrecht", "Sint-Jacobsstraat 1, 3511 BR Utrecht, Pays-Bas", 52.09329, 5.11489, 82, 35, "Low", 3.8, "BW PS",
     "Modern store on Vredenburg next to the central station; convenient, busy."),
    ("De Bijenkorf Maastricht", DS, "NL", "Maastricht", "Achter het Vleeshuis 26, 6211 GS Maastricht, Pays-Bas", 50.84919, 5.69156, 80, 35, "Low", 3.9, "PS LX",
     "Elegant southern branch drawing Belgian and German shoppers."),
    ("De Bijenkorf Eindhoven", DS, "NL", "Eindhoven", "Piazza 1, 5611 AE Eindhoven, Pays-Bas", 51.44160, 5.47710, 78, 35, "Low", 3.8, "PS BW",
     "Southern branch in the Piazza centre; solid luxury counters."),
    ("X BANK", CS, "NL", "Amsterdam", "Spuistraat 172, 1012 VT Amsterdam, Pays-Bas", 52.37281, 4.88935, 80, 70, "Med", 4.2, "IB",
     "Dutch design concept store in the W Hotel; showcases local makers including fragrance."),

    # ------------------------------------------------------------ LUXEMBOURG
    ("Parfumerie Celeste", NB, "LU", "Luxembourg", "Grand-Rue 41, 1661 Luxembourg", 49.61187, 6.13018, 78, 75, "High", 4.5, "ES FS IB",
     "Boutique niche address in the capital with personal, multilingual service."),
    ("Paris 8 Haute Parfumerie – Grand-Rue", NB, "LU", "Luxembourg", "Grand-Rue 56, 1660 Luxembourg", 49.61233, 6.12877, 80, 60, "Med", 4.3, "ES LX FS GW",
     "Luxembourg's selective multi-brand perfumery chain; Grand-Rue store carries prestige and a growing niche shelf."),
    ("Sephora – Grand-Rue (Place d'Armes)", CS, "LU", "Luxembourg", "Grand-Rue 73, 1661 Luxembourg", 49.61186, 6.12868, 74, 45, "Med", 4.0, "PS BW FS",
     "Busiest beauty address of the old town, steps from Place d'Armes; wide multi-brand range including selective niche labels."),

    # ---------------------------------------------------------------- GERMANY
    ("KaDeWe", DS, "DE", "Berlin", "Tauentzienstraße 21-24, 10789 Berlin, Allemagne", 52.50158, 13.34100, 93, 30, "Low", 4.1, "LX TC PS ES",
     "Continental Europe's most famous department store; huge niche perfume hall, busy but expert counters."),
    ("Apropos The Concept Store Berlin", CS, "DE", "Berlin", "Kurfürstendamm 68, 10707 Berlin, Allemagne", 52.50040, 13.30833, 84, 58, "Med", 4.3, "LX IB",
     "High-fashion concept store in the former Alhambra cinema with a selective fragrance edit."),
    ("Belle Rebelle", NB, "DE", "Berlin", "Bleibtreustraße 42, 10623 Berlin, Allemagne", 52.50339, 13.31991, 80, 82, "High", 4.6, "ES FS GS IB",
     "Indie-minded niche boutique; reviewers highlight the enthusiastic, story-driven staff."),
    ("The Corner Berlin", CS, "DE", "Berlin", "Französische Straße 40, 10117 Berlin, Allemagne", 52.51509, 13.39261, 85, 55, "Med", 4.2, "LX IB",
     "Luxury multi-brand store near Gendarmenmarkt; refined edit including niche fragrance."),
    ("VOO Store", CS, "DE", "Berlin", "Oranienstraße 24, 10999 Berlin, Allemagne", 52.50117, 13.42112, 82, 65, "Med", 4.3, "IB",
     "Kreuzberg concept store in a courtyard; cool, curated, occasional niche fragrance."),
    ("Ludwig Beck", DS, "DE", "Munich", "Marienplatz 11, 80331 München, Allemagne", 48.13716, 11.57667, 86, 40, "Low", 4.2, "ES LX IB",
     "'Kaufhaus der Sinne' with a respected niche perfumery floor; competent staff, central location."),
    ("Oberpollinger", DS, "DE", "Munich", "Neuhauser Straße 18, 80331 München, Allemagne", 48.13953, 11.56785, 90, 30, "Low", 4.0, "LX PS TC",
     "KaDeWe Group's Munich flagship; luxurious beauty hall, polished but commercial."),
    ("Harald Lubner", NB, "DE", "Hamburg", "Große Bleichen 23, 20354 Hamburg, Allemagne", 53.55271, 9.98919, 86, 72, "High", 4.6, "ES FS GS IB",
     "Hamburg's niche institution; deep catalogue and long-standing, knowledgeable team."),
    ("Apropos The Concept Store Hamburg", CS, "DE", "Hamburg", "Neuer Jungfernstieg 16, 20354 Hamburg, Allemagne", 53.55607, 9.99174, 84, 58, "Med", 4.3, "LX IB",
     "Hanseatic outpost of the concept chain; polished and fashion-forward."),
    ("Alsterhaus", DS, "DE", "Hamburg", "Jungfernstieg 16-20, 20354 Hamburg, Allemagne", 53.55304, 9.99128, 88, 30, "Low", 4.0, "LX PS TC",
     "Hamburg's grand department store with an elegant beauty floor on the Alster."),
    ("Parfümerie Schnitzler", NB, "DE", "Düsseldorf", "Königsallee 40 (Sevens Center), 40212 Düsseldorf, Allemagne", 51.22399, 6.77962, 82, 70, "Med", 4.5, "ES FS IB",
     "Respected niche perfumery in fashion-capital Düsseldorf; attentive, expert service."),
    ("Breuninger Düsseldorf", DS, "DE", "Düsseldorf", "Königsallee 2 (Kö-Bogen), 40212 Düsseldorf, Allemagne", 51.22707, 6.78105, 87, 32, "Low", 4.1, "LX PS",
     "Premium department store in the Libeskind-designed Kö-Bogen; strong luxury fragrance."),
    ("Breuninger Stuttgart", DS, "DE", "Stuttgart", "Marktstraße 1-3, 70173 Stuttgart, Allemagne", 48.77497, 9.17974, 88, 32, "Low", 4.1, "LX PS ES",
     "Flagship of Germany's premium department-store chain; excellent niche counters."),
    ("Apropos The Concept Store Cologne", CS, "DE", "Cologne", "Mittelstraße 12, 50672 Köln, Allemagne", 50.93719, 6.94357, 84, 58, "Med", 4.3, "LX IB",
     "Original Apropos store; luxurious and selective."),
    ("Essenza Nobile", NB, "DE", "Mannheim", "O7 4, 68161 Mannheim, Allemagne", 49.48541, 8.47127, 84, 80, "High", 4.6, "ES FS GS IB",
     "Major niche specialist with a vast catalogue; well known for samples and discovery sets."),
    ("Breuninger Freiburg", DS, "DE", "Freiburg", "Kaiser-Joseph-Straße 169, 79098 Freiburg im Breisgau, Allemagne", 47.99606, 7.85166, 80, 32, "Low", 4.0, "LX PS",
     "Draws Swiss and French cross-border shoppers; friendly staff."),

    # ------------------------------------------------------------ SWITZERLAND
    ("Parfumerie Spitzenhaus", NB, "CH", "Zürich", "Börsenstrasse 14, 8001 Zürich, Suisse", 47.36819, 8.54059, 84, 72, "High", 4.5, "ES FS IB",
     "Old-town niche boutique with a loyal Zürich clientele."),
    ("Osswald Parfumerie", NB, "CH", "Zürich", "Bahnhofstrasse 17, 8001 Zürich, Suisse", 47.36908, 8.53935, 88, 55, "Med", 4.4, "LX ES FS",
     "Long-established luxury perfumery on Bahnhofstrasse; formal, expert service."),
    ("Globus Zürich Bahnhofstrasse", DS, "CH", "Zürich", "Schweizergasse 11, 8001 Zürich, Suisse", 47.37577, 8.53799, 88, 30, "Low", 4.1, "LX PS",
     "Switzerland's premium department store; its beauty floor carries strong niche brands."),
    ("Bongénie Zürich", DS, "CH", "Zürich", "Bahnhofstrasse 3, 8001 Zürich, Suisse", 47.36762, 8.53990, 87, 34, "Low", 4.1, "LX ES",
     "Bahnhofstrasse luxury store; refined beauty floor with attentive service."),
    ("Globus Genève", DS, "CH", "Geneva", "Rue du Rhône 48, 1204 Genève, Suisse", 46.20380, 6.14730, 86, 30, "Low", 4.0, "LX TC PS",
     "Lakeside luxury retail; international clientele, refined beauty hall."),
    ("Bongénie Genève", DS, "CH", "Geneva", "Rue du Marché 34, 1204 Genève, Suisse", 46.20297, 6.14728, 89, 34, "Low", 4.2, "LX ES",
     "Bongénie's flagship; elegant beauty floor with selective niche and attentive staff."),
    ("Haute Parfumerie Théodora", NB, "CH", "Geneva", "Grand-Rue 38, 1204 Genève, Suisse", 46.20143, 6.14653, 88, 68, "Med", 4.6, "ES FS LX IB",
     "Exclusive haute-parfumerie salon; very personal, appointment-style service."),
    ("Globus Basel", DS, "CH", "Basel", "Marktplatz 2, 4051 Basel, Suisse", 47.55753, 7.58810, 84, 30, "Low", 4.0, "LX PS",
     "Historic Marktplatz store; reliable luxury fragrance."),
    ("Globus Bern", DS, "CH", "Bern", "Spitalgasse 17-21, 3011 Bern, Suisse", 46.94800, 7.44268, 82, 30, "Low", 3.9, "LX PS",
     "Arcade-lined old-town store; quieter, good service."),
    ("Bongénie Lausanne", DS, "CH", "Lausanne", "Place Saint-François 10, 1003 Lausanne, Suisse", 46.51993, 6.63383, 85, 34, "Low", 4.1, "LX ES",
     "Upscale Lausanne department store with curated perfumery."),
    ("Globus Lausanne", DS, "CH", "Lausanne", "Rue du Pont 5, 1003 Lausanne, Suisse", 46.52116, 6.63345, 82, 30, "Low", 4.0, "LX PS",
     "Downtown Lausanne store; reliable luxury fragrance."),
    ("Globus Luzern", DS, "CH", "Lucerne", "Pilatusstrasse 4, 6003 Luzern, Suisse", 47.05023, 8.30838, 80, 30, "Low", 3.9, "TC LX",
     "Central Lucerne store; frequent tourist traffic."),
]

TYPE_CODES = {NB, CS, DS}
OPENNESS = {"High", "Med", "Low"}
# Loose bounding boxes per country (lat_min, lat_max, lng_min, lng_max)
BBOX = {
    "FR": (41.3, 51.2, -5.2, 9.6), "BE": (49.5, 51.5, 2.5, 6.4), "NL": (50.7, 53.6, 3.3, 7.3),
    "DE": (47.2, 55.1, 5.8, 15.1), "LU": (49.4, 50.2, 5.7, 6.6), "CH": (45.8, 47.9, 5.9, 10.5),
}
COUNTRY_NAMES = {"FR": "France", "BE": "Belgium", "NL": "Netherlands", "DE": "Germany", "LU": "Luxembourg", "CH": "Switzerland"}


def build():
    records, errors = [], []
    seen = set()
    for i, row in enumerate(RAW, 1):
        (name, typ, cc, city, addr, lat, lng, tier, align, openness, cx, traits, sentiment) = row
        key = (name, cc)
        if key in seen:
            errors.append(f"duplicate: {name}")
        seen.add(key)
        if typ not in TYPE_CODES:
            errors.append(f"{name}: bad type {typ}")
        if openness not in OPENNESS:
            errors.append(f"{name}: bad openness {openness}")
        if "MB" in traits.split():
            errors.append(f"{name}: monobrand stores are excluded (brand fit = 0)")
        if not (1 <= tier <= 100 and 0 <= align <= 100 and 1 <= cx <= 5):
            errors.append(f"{name}: score out of range")
        la0, la1, lo0, lo1 = BBOX[cc]
        if not (la0 <= lat <= la1 and lo0 <= lng <= lo1):
            errors.append(f"{name}: coordinates outside {cc}")
        tags = [TRAITS[t] for t in traits.split()]
        query = f"{name}, {addr}"
        records.append({
            "id": i,
            "name": name,
            "type": typ,
            "country": cc,
            "country_name": COUNTRY_NAMES[cc],
            "city": city,
            "address": addr,
            "lat": lat,
            "lng": lng,
            "tier_score": tier,
            "brand_alignment_score": align,
            "single_sku_openness": openness,
            "customer_experience_rating": cx,
            "cx_traits": tags,
            "sentiment_summary": sentiment,
            "address_confidence": "confirmed",
            "google_maps_url": "https://www.google.com/maps/search/?api=1&query=" + quote_plus(query),
            "instagram_search_url": "https://www.instagram.com/explore/search/keyword/?q=" + quote_plus(f"{name} {city}"),
        })
    return records, errors


def main():
    records, errors = build()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    out = Path(__file__).parent
    payload = json.dumps(records, ensure_ascii=False, indent=2)
    (out / "perfumeries.json").write_text(payload + "\n", encoding="utf-8")
    (out / "perfumeries.js").write_text("window.PERFUMERIES = " + payload + ";\n", encoding="utf-8")
    by_country = {}
    for r in records:
        by_country[r["country"]] = by_country.get(r["country"], 0) + 1
    print(f"{len(records)} stores -> perfumeries.json / perfumeries.js")
    print("  " + ", ".join(f"{k}: {v}" for k, v in sorted(by_country.items())))


if __name__ == "__main__":
    main()
