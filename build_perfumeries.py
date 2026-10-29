#!/usr/bin/env python3
"""Compile the niche perfumery dataset (BE, NL, DE, FR, LU, CH).

Two inputs, merged and validated offline:
  RAW                    hand-curated flagships (exact addresses checked individually)
  sources/osm_raw.json   OpenStreetMap harvest (harvest_osm.py), filtered to luxury
                         networks + independent perfumeries; curated rows win on overlap

Outputs:
  perfumeries.json  canonical dataset
  perfumeries.js    same data as `window.PERFUMERIES` so index.html works from file://

Scores are editorial estimates (curation, prestige, openness to indie brands),
not measured values; OSM rows inherit their network's profile, independents get a
neutral default and no CX rating. Every row carries street + house number + postcode
and building-level coordinates, so `address_confidence` is always "confirmed".
Monobrand flagships (no third-party brands, brand fit = 0) and generic placeholders
are deliberately excluded.
"""
import json
import math
import re
import sys
import unicodedata
from collections import Counter
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
    ("Jovoy Paris", NB, "FR", "Paris", "4 Rue de Castiglione, 75001 Paris, France", 48.86560, 2.32775, 95, 72, "High", 4.6, "ES FS GS IB DB",
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
    ("Le Bon Marché Rive Gauche", DS, "FR", "Paris", "24 Rue de Sèvres, 75007 Paris, France", 48.85104, 2.32413, 98, 34, "Low", 4.2, "LX ES FS PS BW",
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
    ("Senteurs d'Ailleurs", NB, "BE", "Brussels", "Place Stéphanie 1A, 1050 Ixelles, Belgique", 50.83355, 4.35861, 92, 72, "High", 4.6, "ES FS GS IB LX",
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
    ("Skins Cosmetics Amsterdam", CS, "NL", "Amsterdam", "Runstraat 9, 1016 GJ Amsterdam, Pays-Bas", 52.36881, 4.88377, 92, 80, "Med", 4.6, "ES FS IB DB GS",
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
COUNTRY_SUFFIX = {"FR": "France", "BE": "Belgique", "NL": "Pays-Bas", "DE": "Allemagne", "LU": "Luxembourg", "CH": "Suisse"}

# ------------------------------------------------------------------ OSM harvest
# Rows from sources/osm_raw.json (see harvest_osm.py) are kept only when they match
# a known luxury network (CHAIN_PROFILES) or are independent perfumeries, and never
# when they belong to a mass-market chain or a monobrand house.
#   regex on name/brand -> (canonical chain, type, tier, align, openness, cx, traits, blurb)
CHAIN_PROFILES = [
    (r"^le bon march", "Le Bon Marché", DS, 98, 36, "Low", 4.3, "LX ES FS PS",
     "Paris's most refined department store; heritage houses plus a selective niche edit."),
    (r"samaritaine", "La Samaritaine (DFS)", DS, 90, 25, "Low", 4.1, "LX TC PS",
     "LVMH/DFS luxury department store; large beauty floor with travel-retail atmosphere."),
    (r"^galeries lafayette (paris )?haussmann", "Galeries Lafayette", DS, 91, 28, "Low", 3.8, "TC PS BW LX",
     "Flagship beauty hall; very broad prestige and niche choice, crowded and transactional."),
    (r"^galeries lafayette", "Galeries Lafayette", DS, 72, 30, "Low", 3.6, "PS BW",
     "Galeries Lafayette regional store; prestige fragrance counters, niche depth varies by city."),
    (r"^printemps", "Printemps", DS, 74, 32, "Low", 3.6, "PS BW",
     "Printemps department store; prestige beauty floor with selected niche corners."),
    (r"^(le )?bhv", "BHV", DS, 70, 40, "Low", 3.5, "BW PS",
     "Practical department store; mainstream-leaning beauty with emerging-brand pop-ups."),
    (r"^inno\b", "INNO", DS, 72, 35, "Low", 3.5, "BW PS",
     "Belgium's department-store network; broad prestige perfumery with luxury corners."),
    (r"bijenkorf", "De Bijenkorf", DS, 84, 35, "Low", 3.9, "LX PS",
     "Dutch premium department store; deep luxury and niche fragrance counters."),
    (r"^kadewe|kaufhaus des westens", "KaDeWe", DS, 93, 30, "Low", 4.1, "LX TC PS ES",
     "Continental Europe's most famous department store; huge niche perfume hall."),
    (r"^oberpollinger", "Oberpollinger", DS, 90, 30, "Low", 4.0, "LX PS TC",
     "KaDeWe Group's Munich flagship; luxurious beauty hall."),
    (r"^alsterhaus", "Alsterhaus", DS, 88, 30, "Low", 4.0, "LX PS TC",
     "Hamburg's grand department store with an elegant beauty floor."),
    (r"^ludwig beck", "Ludwig Beck", DS, 86, 40, "Low", 4.2, "ES LX IB",
     "'Kaufhaus der Sinne' with a respected niche perfumery floor."),
    (r"^(e\. )?breuninger", "Breuninger", DS, 84, 32, "Low", 4.0, "LX PS",
     "Germany's premium department-store chain; strong luxury fragrance counters."),
    (r"^engelhorn", "Engelhorn", DS, 78, 34, "Low", 4.0, "LX PS",
     "Mannheim's premium fashion house with a luxury beauty department."),
    (r"^konen", "Konen", DS, 76, 34, "Low", 4.0, "LX PS",
     "Munich premium fashion department store with selective beauty."),
    (r"^apropos", "Apropos The Concept Store", CS, 84, 58, "Med", 4.3, "LX IB",
     "Luxury concept store with a selective fragrance edit."),
    (r"^globus", "Globus", DS, 84, 30, "Low", 4.0, "LX PS",
     "Switzerland's premium department store; beauty floors carry strong niche brands."),
    (r"^bong[ée]nie|^bon g[ée]nie", "Bongénie", DS, 86, 34, "Low", 4.1, "LX ES",
     "Swiss luxury fashion & beauty house; curated perfumery and attentive service."),
    (r"^manor\b", "Manor", DS, 68, 32, "Low", 3.7, "PS BW",
     "Swiss department-store network; prestige fragrance corners with selected luxury labels."),
    (r"^loeb\b", "Loeb", DS, 72, 32, "Low", 3.8, "PS LX",
     "Bern's family-owned department store; prestige perfumery floor."),
    (r"^skins", "Skins Cosmetics", CS, 90, 78, "Med", 4.5, "ES FS IB DB",
     "Benelux niche reference; tight edit of indie houses and staff who guide by olfactive family."),
    (r"^paris ?8", "Paris 8 Haute Parfumerie", NB, 80, 60, "Med", 4.3, "ES LX FS GW",
     "Luxembourg's selective multi-brand perfumery chain with a growing niche shelf."),
    (r"aus liebe zum duft", "Aus Liebe zum Duft", NB, 82, 78, "High", 4.5, "ES FS GS IB",
     "Large niche specialist with a vast catalogue and strong sample culture."),
    (r"essenza nobile", "Essenza Nobile", NB, 84, 80, "High", 4.6, "ES FS GS IB",
     "Major niche specialist; known for samples and discovery sets."),
    (r"babassu", "Babassu", NB, 80, 80, "High", 4.5, "ES FS IB",
     "Boutique niche perfumery with a warm, advisory approach."),
    (r"senteurs d.ailleurs", "Senteurs d'Ailleurs", NB, 92, 72, "High", 4.6, "ES FS GS IB LX",
     "Belgium's reference for niche perfumery."),
    (r"^jovoy", "Jovoy", NB, 95, 72, "High", 4.6, "ES FS GS IB DB",
     "Temple of independent perfumery; hundreds of houses to explore."),
    (r"^liquides", "Liquides", NB, 84, 86, "High", 4.7, "ES FS DB IB GS",
     "Bar-style niche counter; relaxed, geeky expertise."),
]
INDEPENDENT = ("Independent perfumery", NB, 62, 72, "High", None, "",
               "Independent perfumery mapped in OpenStreetMap; niche depth not yet assessed.")

# Mass-market networks: high volume, central buying, no realistic single-SKU entry.
MASS = re.compile(
    r"douglas|marionnaud|sephora|ici paris|nocib[ée]|yves rocher|body shop|rituals|\blush\b|kiko|kruidvat|"
    r"\betos\b|rossmann|\bdm\b|m[üu]ller|pieper|flaconi|parfumdreams|\bhema\b|holland ?& ?barrett|nyx|\bmac\b|"
    r"primark|monoprix|galeria|karstadt|kaufhof|woolworth|peek ?& ?cloppenburg|c ?& ?a\b|coop|migros|"
    r"jelmoli|outlet|gourmet|maison et|lafayette maison|du go[uû]t|grande [ée]picerie|\bdi\b|"
    r"parfumerie\.nl|perfume ?shop|parfum ?discount|nuance|beauty ?boutique|thalia|action|normal|"
    r"origines|l'occitane|nuxe|caudalie|clarins|lanc[ôo]me|sisley|kiehl|aesop|lancaster",
    re.I)
# Monobrand houses (brand fit = 0): own catalogue only.
MONO = re.compile(
    r"guerlain|diptyque|chanel|dior|herm[eè]s|le labo|byredo|fragonard|molinard|galimard|kurkdjian|"
    r"artisan parfumeur|goutal|penhaligon|jo malone|creed|acqua di parma|serge lutens|fr[ée]d[ée]ric malle|"
    r"\bm[ée]mo\b|atelier cologne|margiela|ex nihilo|parfums de marly|floris|santa maria novella|buly|"
    r"trudon|caron|lubin|nicolai|histoires de parfums|initio|amouage|xerjoff|roja|kilian|tom ford|crivelli|"
    r"esteban|durance|kenzo|saint laurent|armani|bvlgari|bulgari|cartier|louis vuitton|gucci|prada|montale|"
    r"mancera|ormonde|couvent|goldfield|juliette has a gun|[ée]tat libre|\bbdk\b|mizensir|different company|"
    r"heeley|liquides imaginaires|astier de villatte|jardins d.[ée]crivains|oriza|houbigant|parfum d.empire|"
    r"huiti[eè]me art|pierre guillaume|mad et len|fueguia|frau tonis|harry lehmann|ormaie|21g|jardin retrouv|"
    r"vilhelm|maison francis|lalique|baccarat|annick|sabon|l'eau de paris|nose shop|ella k|maison matine|"
    r"perris|nishane|essential parfums|eight ?& ?bob|boadicea|clive christian|bond no|maison lancier|"
    r"parfumerie generale|parfumerie g[ée]n[ée]rale|lolita lempicka|mugler|givenchy|valentino|celine|"
    r"loewe|chopard|van cleef|boucheron|rouge bunny|kenzo|zadig|sandro|maje|cire|bastille|dyptique|"
    r"maison de parfum berry|j\.f\. schwarzlose|schwarzlose|t\. le clerc|officine|hugh parsons|"
    r"atelier du parfum|studio des parfums|grandiflora",
    re.I)
KEEP_SHOPS = {"perfumery", "cosmetics", "beauty", "department_store", "clothes", "boutique", "fashion",
              "gift", "interior_decoration", "houseware", "variety_store", "fashion_accessories"}


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def dist_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def street_line(cc, street, number):
    return f"{number} {street}" if cc in ("FR", "LU") and not street.lower().startswith("grand-rue") else f"{street} {number}"


def classify(r):
    """Map a harvested OSM row to a profile tuple, or None when it must be dropped."""
    name = (r.get("name") or "").strip()
    label = f"{name} {r.get('brand') or ''}"
    if not name or r.get("shop") not in KEEP_SHOPS:
        return None
    if MONO.search(label):
        return None
    for pattern, chain, *profile in CHAIN_PROFILES:
        if re.search(pattern, name, re.I) or (r.get("brand") and re.search(pattern, r["brand"], re.I)):
            return (chain, *profile)
    if MASS.search(label):
        return None
    if r["shop"] in ("perfumery",) or (r["shop"] in ("cosmetics", "beauty")
                                       and re.search(r"parf|perf|duft|profum|fragr", name, re.I)):
        return INDEPENDENT
    return None


def osm_records():
    path = Path(__file__).parent / "sources" / "osm_raw.json"
    if not path.exists():
        return [], 0
    raw = json.loads(path.read_text(encoding="utf-8"))
    out, dropped = [], 0
    for r in raw:
        prof = classify(r)
        if not prof or not all(r.get(k) for k in ("housenumber", "street", "postcode", "city", "lat", "lng")):
            dropped += 1
            continue
        chain, typ, tier, align, openness, cx, traits, blurb = prof
        cc = r["cc"]
        line = street_line(cc, r["street"], r["housenumber"])
        mall = f"{r['mall']}, " if r.get("mall") else ""
        out.append({
            "name": r["name"].strip(), "type": typ, "country": cc, "city": r["city"],
            "full_address": f"{mall}{line}, {r['postcode']} {r['city']}, {COUNTRY_SUFFIX[cc]}",
            "lat": round(r["lat"], 6), "lng": round(r["lng"], 6),
            "tier_score": tier, "brand_alignment_score": align, "single_sku_openness": openness,
            "customer_experience_rating": cx, "traits": traits, "sentiment_summary": blurb,
            "network": chain, "source": f"osm:{r['osm']}",
            "address_source": "osm_reverse" if r.get("address_from") == "reverse" else "osm_tags",
        })
    return out, dropped


def curated_records():
    out = []
    for row in RAW:
        (name, typ, cc, city, addr, lat, lng, tier, align, openness, cx, traits, sentiment) = row
        out.append({
            "name": name, "type": typ, "country": cc, "city": city, "full_address": addr,
            "lat": lat, "lng": lng, "tier_score": tier, "brand_alignment_score": align,
            "single_sku_openness": openness, "customer_experience_rating": cx, "traits": traits,
            "sentiment_summary": sentiment, "network": None, "source": "curated", "address_source": "curated",
        })
    return out


def same_store(a, b):
    d = dist_m((a["lat"], a["lng"]), (b["lat"], b["lng"]))
    if d > 150:
        return False
    ta, tb = set(slug(a["name"]).split()), set(slug(b["name"]).split())
    generic = {"parfumerie", "parfumeur", "parfums", "parfum", "perfumery", "the", "de", "la", "le", "store",
               "concept", "cosmetics", "paris", "haute", "luxury"}
    shared = (ta & tb) - generic
    return bool(shared) or (a.get("network") and a.get("network") == b.get("network") and d < 80)


def merge():
    curated = curated_records()
    harvested, dropped = osm_records()
    merged = list(curated)
    for h in harvested:
        if any(same_store(h, m) for m in merged):
            continue
        merged.append(h)
    return merged, dropped


def validate(recs):
    errors, seen = [], set()
    for r in recs:
        n = r["name"]
        key = (slug(n), round(r["lat"], 3), round(r["lng"], 3))
        if key in seen:
            errors.append(f"duplicate: {n}")
        seen.add(key)
        if r["type"] not in TYPE_CODES:
            errors.append(f"{n}: bad type {r['type']}")
        if r["single_sku_openness"] not in OPENNESS:
            errors.append(f"{n}: bad openness")
        if "MB" in r["traits"].split():
            errors.append(f"{n}: monobrand stores are excluded (brand fit = 0)")
        cx = r["customer_experience_rating"]
        if not (1 <= r["tier_score"] <= 100 and 0 <= r["brand_alignment_score"] <= 100 and (cx is None or 1 <= cx <= 5)):
            errors.append(f"{n}: score out of range")
        la0, la1, lo0, lo1 = BBOX[r["country"]]
        if not (la0 <= r["lat"] <= la1 and lo0 <= r["lng"] <= lo1):
            errors.append(f"{n}: coordinates outside {r['country']}")
        parts = [x.strip() for x in r["full_address"].split(",")]
        if not any(re.search(r"\d", x) for x in parts if not re.match(r"\d{4,5}\b|\d{4} ?[A-Z]{2}\b", x)):
            errors.append(f"{n}: address has no house number: {r['full_address']}")
        if not re.search(r"\b\d{4}(\s?[A-Z]{2})?\b|\b\d{5}\b", r["full_address"]):
            errors.append(f"{n}: address has no postcode: {r['full_address']}")
    return errors


def build():
    merged, dropped = merge()
    errors = validate(merged)
    merged.sort(key=lambda r: (r["country"], r["city"], -r["tier_score"], r["name"]))
    records = []
    for i, r in enumerate(merged, 1):
        records.append({
            "id": i,
            "name": r["name"],
            "type": r["type"],
            "country": r["country"],
            "country_name": COUNTRY_NAMES[r["country"]],
            "city": r["city"],
            "full_address": r["full_address"],
            "lat": r["lat"],
            "lng": r["lng"],
            "tier_score": r["tier_score"],
            "brand_alignment_score": r["brand_alignment_score"],
            "single_sku_openness": r["single_sku_openness"],
            "customer_experience_rating": r["customer_experience_rating"],
            "cx_traits": [TRAITS[t] for t in r["traits"].split()],
            "sentiment_summary": r["sentiment_summary"],
            "network": r["network"],
            "address_confidence": "confirmed",
            "address_source": r["address_source"],
            "source": r["source"],
            "google_maps_url": "https://www.google.com/maps/search/?api=1&query=" + quote_plus(f"{r['name']}, {r['full_address']}"),
            "instagram_search_url": "https://www.instagram.com/explore/search/keyword/?q=" + quote_plus(f"{r['name']} {r['city']}"),
        })
    return records, errors, dropped


def main():
    records, errors, dropped = build()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    out = Path(__file__).parent
    payload = json.dumps(records, ensure_ascii=False, indent=1)
    (out / "perfumeries.json").write_text(payload + "\n", encoding="utf-8")
    (out / "perfumeries.js").write_text("window.PERFUMERIES = " + payload + ";\n", encoding="utf-8")
    count = lambda k: sorted(Counter(r[k] for r in records).items())
    print(f"{len(records)} stores -> perfumeries.json / perfumeries.js ({dropped} OSM rows filtered out)")
    print("  " + ", ".join(f"{k}: {v}" for k, v in count("country")))
    print("  " + ", ".join(f"{k}: {v}" for k, v in count("type")))
    print("  " + ", ".join(f"{k}: {v}" for k, v in count("source") if k == "curated") +
          f", osm: {sum(r['source'].startswith('osm') for r in records)}")


if __name__ == "__main__":
    main()
