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

B2B sales fields (single-SKU launch pipeline) are added to every row:
  launch_priority       derived from the market segment (see `calibrate`)
  decision_maker_role   who to pitch, derived from type + network
  pipeline_status       "Not Contacted" unless sources/crm.json says otherwise
  notes_prospections    free text, from sources/crm.json
sources/crm.json maps `crm_key` -> {pipeline_status, decision_maker_role, notes_prospections};
export it from the map ("Export CRM JSON") so outreach progress survives rebuilds.
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
    ("Dover Street Parfums Market", CS, "FR", "Paris", "11 bis Rue Elzévir, 75003 Paris, France", 48.85873, 2.36188, 89, 62, "Med", 4.5, "ES FS DB IB LX",
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
    ("Parfumerie Celeste", NB, "LU", "Luxembourg", "Grand-Rue 41, L-1661 Luxembourg, Luxembourg", 49.61187, 6.13018, 78, 75, "High", 4.5, "ES FS IB",
     "Boutique niche address in the capital with personal, multilingual service."),
    ("Paris 8 Haute Parfumerie – Grand-Rue", NB, "LU", "Luxembourg", "Grand-Rue 56, L-1660 Luxembourg, Luxembourg", 49.61233, 6.12877, 80, 60, "Med", 4.3, "ES LX FS GW",
     "Luxembourg's selective multi-brand perfumery chain; Grand-Rue store carries prestige and a growing niche shelf."),
    ("Sephora – Grand-Rue (Place d'Armes)", CS, "LU", "Luxembourg", "Grand-Rue 73, L-1661 Luxembourg, Luxembourg", 49.61186, 6.12868, 74, 45, "Med", 4.0, "PS BW FS",
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

# ------------------------------------------------------- priority target boutiques
# Shops from the priority target list that the OSM harvest missed. Each one was located
# on its own OSM object (source) and the house number checked: "curated" when a public
# directory (Visit Lyon, Mappy, acceslibre) gives the same number, "osm_reverse" when it
# comes from the numbered OSM address the shop sits in. No CX rating until reviewed.
# (name, type, country, city, address, lat, lng, tier, align, openness, traits, sentiment,
#  osm object, address source)
TARGET_ROWS = [
    ("KAMS Paris", CS, "FR", "Paris", "6 Avenue de l'Opéra, 75001 Paris, France", 48.864367, 2.335258, 76, 48, "Med", "LX TC",
     "Luxury multi-brand perfume concept by the Louvre, family-run since 1960; international and duty-free clientele.",
     "node/14061309252", "curated"),
    ("Odorem", NB, "FR", "Lyon", "11 Rue Auguste Comte, 69002 Lyon, France", 45.755606, 4.831668, 80, 84, "High", "ES IB DB",
     "Independent haute-parfumerie boutique in Ainay; runs olfactive workshops introducing French niche houses.",
     "node/11244216429", "curated"),
    ("Le Paravent", NB, "FR", "Lyon", "35 Rue Auguste Comte, 69002 Lyon, France", 45.753148, 4.830341, 78, 80, "High", "ES IB",
     "Owner-run Ainay perfumery that makes a point of carrying niche houses alongside its prestige shelf.",
     "node/7002820454", "curated"),
    ("La Mûre Favorite", NB, "FR", "Lyon", "19 Cours Franklin Roosevelt, 69006 Lyon, France", 45.769077, 4.845681, 72, 78, "High", "IB",
     "Independent perfumery in Les Brotteaux (Lyon 6e); niche depth to confirm on a first visit.",
     "node/8035315312", "osm_reverse"),
    ("Ecocentric", CS, "FR", "Lyon", "9 Rue Marcel Gabriel Rivière, 69002 Lyon, France", 45.75946, 4.836063, 70, 74, "Med", "IB",
     "Natural-beauty and perfumery concept store near the Grand Hôtel-Dieu; clean-formula positioning.",
     "node/10758807918", "osm_reverse"),
    ("Smell Fragrance", NB, "FR", "Pau", "26 Rue des Cordeliers, 64000 Pau, France", 43.297214, -0.37172, 72, 80, "High", "IB",
     "Independent niche perfumery in Pau's old town (Hédas); the reference niche door between Bordeaux and Biarritz.",
     "node/11425400152", "osm_reverse"),
    ("Parfumerie du Soleil d'Or", NB, "FR", "Lille", "4 Rue Esquermoise, 59800 Lille, France", 50.637463, 3.062829, 84, 80, "High", "ES IB LX",
     "Historic independent niche perfumery on the Grand-Place corner of Vieux-Lille; deep niche catalogue.",
     "node/5509181269", "curated"),
    ("Muchachos", NB, "FR", "Roubaix", "17 Avenue d'Alsace, 59100 Roubaix, France", 50.698644, 3.162805, 70, 78, "High", "IB",
     "Independent perfumery in Roubaix (Nations Unies); niche depth to confirm on a first visit.",
     "node/12504447931", "osm_reverse"),
]

# Priority target list as briefed (label, zone, store name in the dataset or None, audit note).
# None = no shop of that name could be located (OSM, Photon, public directories): kept here
# so the build log keeps asking for an exact address instead of inventing one.
PRIORITY_TARGETS = [
    ("Univere Parfumerie", "Paris 2e", None, "no listing found — need street address"),
    ("Sens Unique", "Paris 3e", "Sens Unique", "listed at 13 Rue du Roi de Sicile (4e)"),
    ("Marie Antoinette", "Paris 4e", "Marie Antoinette", ""),
    ("Concept Parfum", "Paris 7e", None, "no listing found — need street address"),
    ("Confrérie Parfumée", "Paris 11e", None, "no listing found — need street address"),
    ("DSB Parfums", "Champigny-sur-Marne", None, "no listing found — need street address"),
    ("Le Chimiste", "Saint-Denis", None, "no listing found (93 or 974?) — need street address"),
    ("Kams Paris", "Lyon", "KAMS Paris", "only door found is Paris 1er, mapped there"),
    ("Odorare", "Lyon", None, "no listing found — likely Odorem (11 Rue Auguste Comte)?"),
    ("Sayhar", "Lyon", None, "no listing found — need street address"),
    ("Liquides", "Lyon", "Liquides Bar à Parfums", "no Lyon door found; network present via Paris bar"),
    ("Mayora Parfumerie", "Lyon", None, "no listing found — need street address"),
    ("Vanora", "Lyon", None, "no listing found — need street address"),
    ("Rivora Parfumerie", "Lyon", None, "no listing found — need street address"),
    ("Paravent", "Lyon", "Le Paravent", ""),
    ("La Mûre Favorite", "Lyon", "La Mûre Favorite", ""),
    ("Odorem", "Lyon", "Odorem", ""),
    ("Ecocentric", "Lyon", "Ecocentric", ""),
    ("Smell Fragrance", "Pau", "Smell Fragrance", ""),
    ("Parfum Exclusif", "Le Pontet", None, "no listing found — need street address"),
    ("Soleil d'Or", "Lille", "Parfumerie du Soleil d'Or", ""),
    ("Parfumerie Lehembre", "Lille", "Parfumerie Lehembre", "door is in La Madeleine (Lille metro)"),
    ("Maison Muchachos", "Roubaix", "Muchachos", ""),
    ("Les Passionnez", "Aix-en-Provence", None, "no listing found — need street address"),
    ("Fessin Parfumerie", "Toulouse", None, "no listing found — need street address"),
    ("Olfactions Parfumerie", "Toulouse", None, "no listing found — need street address"),
]
TARGET_NAMES = {t[2] for t in PRIORITY_TARGETS if t[2]}

# ------------------------------------------------------------ wholesale ledger
# sources/wholesale.json, keyed by crm_key: deliveries (stock engagement) and invoices per
# active partner. An entry may carry the account's pipeline_status (Partner Active / Key
# Account); crm.json still wins. The shipped ledger is illustrative ("demo": true) until
# replaced by an export from the map's Wholesale drawer.
LEDGER_FILE = Path(__file__).parent / "sources" / "wholesale.json"
INVOICE_STATUS = {"Paid", "Pending"}
PARTNER_STATUS = {"Partner Active", "Key Account"}

TYPE_CODES = {NB, CS, DS}
OPENNESS = {"High", "Med", "Low"}
# Loose bounding boxes per country (lat_min, lat_max, lng_min, lng_max)
BBOX = {
    "FR": (41.3, 51.2, -5.2, 9.6), "BE": (49.5, 51.5, 2.5, 6.4), "NL": (50.7, 53.6, 3.3, 7.3),
    "DE": (47.2, 55.1, 5.8, 15.1), "LU": (49.4, 50.2, 5.7, 6.6), "CH": (45.8, 47.9, 5.9, 10.5),
}
PIPELINE = ["Not Contacted", "Discovery Set Sent", "Follow-up Required", "Meeting Booked",
            "Partner Active", "Key Account", "Declined"]
# Statuses renamed in the sampling workflow; old crm.json exports still load
LEGACY_STATUS = {"Sample Sent": "Discovery Set Sent"}
ROLES = {"Founder", "Head Buyer", "General Manager"}
# Role renamed in the buyer-contact audit; old crm.json exports still load
LEGACY_ROLE = {"Store Manager": "General Manager"}
# Estimated confidence (%) that the address reaches the shop door, by where it came from
ADDRESS_SCORE = {"curated": 100, "osm_tags": 90, "osm_reverse": 75}
CRM_FIELDS = ("pipeline_status", "decision_maker_role", "notes_prospections")
CRM_FILE = Path(__file__).parent / "sources" / "crm.json"
COUNTRY_NAMES = {"FR": "France", "BE": "Belgium", "NL": "Netherlands", "DE": "Germany", "LU": "Luxembourg", "CH": "Switzerland"}
COUNTRY_SUFFIX = {"FR": "France", "BE": "Belgique", "NL": "Pays-Bas", "DE": "Allemagne", "LU": "Luxembourg", "CH": "Suisse"}
# National postcode formats (the "<postcode> <city>" segment of full_address) and their valid ranges
POSTCODE = {
    "FR": (re.compile(r"^(\d{5}) "), 1000, 98999), "DE": (re.compile(r"^(\d{5}) "), 1001, 99998),
    "BE": (re.compile(r"^(\d{4}) "), 1000, 9992), "NL": (re.compile(r"^(\d{4}) [A-Z]{2} "), 1000, 9999),
    "LU": (re.compile(r"^L-(\d{4}) "), 1009, 9999), "CH": (re.compile(r"^(\d{4}) "), 1000, 9658),
}
# A postcode area (FR/DE: first 2 digits, BE/NL/CH/LU: first digit) must stay this close to its own median
POSTCODE_AREA_KM = {"FR": 160, "DE": 200, "BE": 110, "NL": 140, "CH": 140, "LU": 60}

# ------------------------------------------------------------------ Export Potential Score
# Editorial purchasing-power index: national per-capita retail purchasing power (EUR, 2024 GfK/Eurostat
# order of magnitude) × an affluence multiplier for the municipality or Paris / Brussels district.
# Not a measured statistic: it ranks markets, it does not size them.
PP_NATIONAL = {"CH": 49000, "LU": 36500, "DE": 27800, "NL": 26300, "BE": 25600, "FR": 24300}
PP_CITY = {
    # France
    "Paris": 1.25, "Boulogne-Billancourt": 1.35, "Le Chesnay-Rocquencourt": 1.3, "Issy-les-Moulineaux": 1.2,
    "Vélizy-Villacoublay": 1.15, "Courchevel": 2.2, "Cannes": 1.3, "Biarritz": 1.25, "Saint-Jean-de-Luz": 1.15,
    "Annecy": 1.2, "Aix-en-Provence": 1.15, "Caluire-et-Cuire": 1.15, "Lyon": 1.08, "Bordeaux": 1.05, "Nice": 1.05,
    "Saint-Laurent-du-Var": 1.05, "Strasbourg": 1.02, "La Madeleine": 1.1, "Roubaix": .72, "Romainville": .85,
    "Ivry-sur-Seine": .88, "Fontenay-sous-Bois": .97, "Béziers": .82, "Nîmes": .88, "Le Havre": .88, "Amiens": .88,
    "Beauvais": .9, "Dax": .9, "Agen": .9, "Langon": .9, "Saintes": .92, "La Roche-sur-Yon": .93,
    # Belgium
    "Wezembeek-Oppem": 1.35, "Brasschaat": 1.25, "Schoten": 1.12, "Lochristi": 1.15, "Antwerp": 1.0, "Ghent": 1.02,
    "Bruges": 1.0, "Brussels": .92, "Charleroi": .8, "Liège": .88, "Chênée": .88, "Namur": .97, "Oostende": .95,
    # Netherlands
    "Wassenaar": 1.7, "Laren": 1.7, "Bloemendaal": 1.75, "Amstelveen": 1.25, "Oosterbeek": 1.2, "Soest": 1.15,
    "Amsterdam": 1.08, "The Hague": 1.0, "Leidschendam": 1.05, "Haarlem": 1.08, "Utrecht": 1.05, "Rotterdam": .92,
    "Schiedam": .88, "Den Helder": .88, "Venlo": .92,
    # Germany
    "Starnberg": 1.55, "Rottach-Egern": 1.5, "Gmund": 1.45, "Bad Soden am Taunus": 1.4, "Ismaning": 1.3,
    "Munich": 1.3, "Baden-Baden": 1.2, "Düsseldorf": 1.12, "Hamburg": 1.12, "Frankfurt am Main": 1.1,
    "Wiesbaden": 1.1, "Stuttgart": 1.12, "Ditzingen": 1.2, "Sindelfingen": 1.15, "Ludwigsburg": 1.1,
    "Sulzbach (Taunus)": 1.2, "Eltville am Rhein": 1.1, "Garmisch-Partenkirchen": 1.1, "Heidelberg": 1.02,
    "Potsdam": 1.02, "Berlin": .98, "Cologne": 1.03, "Duisburg": .83, "Leipzig": .9, "Erfurt": .9,
    "Völklingen": .85, "Delmenhorst": .88, "Itzehoe": .92, "Varel": .92, "Bochum": .9, "Witten": .92, "Wuppertal": .9,
    # Switzerland
    "Zug": 1.45, "Vésenaz": 1.45, "Pfäffikon SZ": 1.3, "Zürich": 1.15, "Geneva": 1.1, "Wallisellen": 1.1,
    "Ascona": 1.12, "Lugano": 1.05, "Montreux": 1.05, "Nyon": 1.12, "Morges": 1.08, "Lucerne": 1.05,
    "La Chaux-de-Fonds": .85, "Delémont": .85, "Biasca": .82, "Payerne": .88, "Wattwil": .88,
    # Luxembourg
    "Luxembourg": 1.1, "Bereldange": 1.1, "Helmsange": 1.08, "Dudelange": .92,
}
# Districts outrank their city (Paris arrondissement / Brussels commune)
PP_DISTRICT = {
    "Paris 1er": 1.45, "Paris 2e": 1.3, "Paris 3e": 1.35, "Paris 4e": 1.45, "Paris 5e": 1.45, "Paris 6e": 1.7,
    "Paris 7e": 1.85, "Paris 8e": 1.8, "Paris 9e": 1.3, "Paris 10e": 1.0, "Paris 11e": 1.1, "Paris 12e": 1.12,
    "Paris 13e": 1.0, "Paris 14e": 1.15, "Paris 15e": 1.3, "Paris 16e": 1.9, "Paris 17e": 1.4, "Paris 18e": .95,
    "Paris 19e": .82, "Paris 20e": .88, "Lyon 2e": 1.25, "Lyon 6e": 1.35, "Marseille 8e": 1.15,
    "Brussels – Uccle": 1.35, "Brussels – Woluwe-Saint-Pierre": 1.35, "Brussels – Woluwe-Saint-Lambert": 1.2,
    "Brussels – Ixelles": 1.05, "Brussels – Etterbeek": 1.0, "Brussels – Watermael-Boitsfort": 1.25,
    "Brussels – Saint-Gilles": .85, "Brussels – Schaerbeek": .78, "Brussels – Anderlecht": .72,
}
PP_FLOOR, PP_CEIL = 15000, 60000   # index 0 / 100
# Luxury retail hubs: flagship streets where high-end fragrance clientele concentrates
LUXURY_HUBS = [
    ("Paris – Triangle d'Or", 48.8686, 2.3050), ("Paris – Faubourg Saint-Honoré", 48.8697, 2.3182),
    ("Paris – Saint-Germain", 48.8530, 2.3330), ("Paris – Le Marais", 48.8590, 2.3610),
    ("Cannes – La Croisette", 43.5508, 7.0230), ("Nice – Promenade", 43.6955, 7.2650),
    ("Courchevel 1850", 45.4153, 6.6347), ("Lyon – Presqu'île", 45.7600, 4.8340),
    ("Bordeaux – Triangle", 44.8420, -0.5760), ("Lille – Vieux-Lille", 50.6400, 3.0630),
    ("Biarritz", 43.4832, -1.5586), ("Strasbourg – Grande Île", 48.5830, 7.7480),
    ("Brussels – Avenue Louise", 50.8320, 4.3600), ("Antwerp – Meir / Schuttershof", 51.2170, 4.4080),
    ("Knokke – Kustlaan", 51.3510, 3.2870), ("Ghent – Veldstraat", 51.0520, 3.7230),
    ("Amsterdam – P.C. Hooftstraat", 52.3600, 4.8800), ("The Hague – Denneweg", 52.0850, 4.3150),
    ("Laren / Het Gooi", 52.2560, 5.2280), ("Maastricht – Stokstraat", 50.8490, 5.6930),
    ("Munich – Maximilianstraße", 48.1390, 11.5810), ("Düsseldorf – Königsallee", 51.2230, 6.7790),
    ("Hamburg – Neuer Wall", 53.5510, 9.9910), ("Frankfurt – Goethestraße", 50.1150, 8.6750),
    ("Berlin – Kurfürstendamm", 52.5020, 13.3290), ("Stuttgart – Königstraße", 48.7770, 9.1780),
    ("Cologne – Mittelstraße", 50.9360, 6.9420), ("Baden-Baden", 48.7600, 8.2400), ("Sylt – Kampen", 54.9600, 8.3400),
    ("Zürich – Bahnhofstrasse", 47.3700, 8.5390), ("Geneva – Rue du Rhône", 46.2030, 6.1480),
    ("Basel – Freie Strasse", 47.5570, 7.5890), ("Lucerne – Schwanenplatz", 47.0520, 8.3090),
    ("Lugano – Via Nassa", 46.0030, 8.9500), ("Zug", 47.1700, 8.5150), ("St. Moritz", 46.4980, 9.8390),
    ("Gstaad", 46.4750, 7.2860), ("Luxembourg – Grand-Rue", 49.6118, 6.1300),
]
HUB_HALF_KM = 12        # hub score halves every 12 km from the nearest hub
CLIENTELE_KM = 5        # high-end peers counted within this radius
HIGH_END_TIER = 75
EXPORT_WEIGHTS = {"purchasing_power": .4, "luxury_hub": .3, "clientele_density": .3}

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
INDEPENDENT = ("Independent perfumery", NB, 62, 72, "Med", None, "",
               "Independent perfumery mapped in OpenStreetMap; niche depth not yet assessed.")

# Mass-market networks: high volume, central buying, no realistic single-SKU entry.
MASS = re.compile(
    r"douglas|marionnaud|sephora|ici paris|nocib[ée]|yves rocher|body shop|rituals|\blush\b|kiko|kruidvat|"
    r"\betos\b|rossmann|\bdm\b|m[üu]ller|pieper|flaconi|parfumdreams|\bhema\b|holland ?& ?barrett|nyx|\bmac\b|"
    r"primark|monoprix|galeria|karstadt|kaufhof|woolworth|peek ?& ?cloppenburg|c ?& ?a\b|coop|migros|"
    r"jelmoli|outlet|gourmet|maison et|lafayette maison|du go[uû]t|grande [ée]picerie|\bdi\b|"
    r"parfumerie\.nl|perfume ?shop|parfum ?discount|nuance|beauty ?boutique|thalia|action|normal|"
    r"origines|l'occitane|nuxe|caudalie|clarins|lanc[ôo]me|sisley|kiehl|aesop|lancaster|"
    # discount, dupe-scent and import networks
    r"import parfumerie|\bapril\b|parf[üu]merie becker|\bhc parf|city parf|parf[üu]merie platen|loris|"
    r"duftzwilling|oil de parfum|perfumum|i-n-l-e-t|bargello|pardole|kingdom of perfumes|dubai|"
    r"discount|promo|dhl|paketshop|otto.?s|marjo|omnia|afamya|kelany|bilqis|alkhaled|dimaschki|"
    r"al-jazeera|d.orient|ilire|baridi|parfum\.de|perfect look|dessous|w[äa]sche|lingerie|"
    r"parfum member|braiding|a&m parfums|amica|parfuma\b|beauty parfumerie|sam parf",
    re.I)
# Monobrand houses (brand fit = 0): own catalogue only.
MONO = re.compile(
    r"guerlain|diptyque|chanel|dior|herm[eè]s|le labo|byredo|fragonard|molinard|galimard|kurkdjian|"
    r"artisan parfumeur|mad parfumeur|goutal|penhaligon|jo malone|creed|acqua di parma|serge lutens|fr[ée]d[ée]ric malle|"
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
# Not a fragrance retail floor, even inside a kept network (outlets, food halls, lingerie,
# salons whose name only looks like "perf…"), plus dupe/import/oud discounters and workshops.
EXCLUDE = re.compile(
    r"outlet|lebensmittel|dessous|w[äa]sche|\bsport|\bfood\b|living lab|nails?\b|brows|lash|coiff|"
    r"frank provost|perfect|beautyperformance|my geisha|^bl$|"
    r"[ée]quivalence|lagerverkauf|import ?parf|\bhc.?parf|\boud\b|paradies|\bwelt\b|pien parf|7sky|"
    r"d&p perf|bardi|amarino|mery parfum|alsham|alamir|latakia|jouja|amo.?ash|areej|abuaisha|"
    r"claudi[ao] lopez|^parfum du$|parf[üu]merei 123|workshop|atelier parfum|ateliers du parfumeur|"
    # monobrand houses missed by MONO
    r"guy delforge|4711|bon parfumeur|eau de menton|eau de cassis|parfums de la bastide|"
    r"senteurs du pays basque|hayari|yagan",
    re.I)
KEEP_SHOPS = {"perfumery", "cosmetics", "beauty", "department_store", "clothes", "boutique", "fashion",
              "gift", "interior_decoration", "houseware", "variety_store", "fashion_accessories"}

# ------------------------------------------------------- single-SKU market fit
# The editorial openness/fit in RAW and CHAIN_PROFILES describe how niche-minded a store
# is, not how easily a one-reference indie brand gets listed. `calibrate` re-derives both
# from a market segment: concept stores and department stores need breadth, minimum
# orders or central listing, so only stores verified as micro-brand friendly stay High.
TRUE_INDIE = "True Indie Niche Boutique"
INDIE_TBC = "Indie Niche (to verify)"
SPECIALIST = "Specialist Niche House"
TRADITIONAL = "Traditional Prestige Perfumery"
SELECTIVE = "Selective Concept Store"
DEPT = "Department Store"
SEGMENTS = [TRUE_INDIE, INDIE_TBC, SPECIALIST, TRADITIONAL, SELECTIVE, DEPT]
#   segment -> (openness, entry_barrier, fit cap, launch priority)
SEGMENT_RULES = {
    TRUE_INDIE:  ("High", "Low", 100, "Tier 1 - Quick Win (Indie Niche)"),
    INDIE_TBC:   ("Med", "Med", 68, "Tier 1 - Quick Win (Indie Niche)"),
    SPECIALIST:  ("Med", "High", 72, "Tier 2 - Selective (Specialist / Concept)"),
    TRADITIONAL: ("Low", "High", 45, "Tier 2 - Selective (Specialist / Concept)"),
    SELECTIVE:   ("Low", "High", 55, "Tier 2 - Selective (Specialist / Concept)"),
    DEPT:        ("Low", "Very High", 35, "Tier 3 - Long-term Dept Store"),
}
BARRIERS = ["Low", "Med", "High", "Very High"]
# Owner-run shops known to list single references from micro-brands (consignment,
# discovery shelves, founder buys directly). Editorial verification, by name / network.
VERIFIED_MICRO = {"Sens Unique", "Marie Antoinette", "Liquides Bar à Parfums", "Liquides Confidentiels",
                  "Perfume Lounge", "Belle Rebelle", "Place Vendôme Haute Parfumerie", "Parfumerie Celeste",
                  "Liquides"}
# Large niche catalogues with a buying committee: open to new houses, but want a collection
SPECIALIST_NAMES = {"Jovoy Paris", "Jovoy", "Senteurs d'Ailleurs", "Harald Lubner", "Essenza Nobile",
                    "Aus Liebe zum Duft", "Babassu", "Babassu Amsterdam", "Babassu Den Haag",
                    "Casa Babassu Wassenaar", "Paris 8 Haute Parfumerie", "Paris 8 Haute Parfumerie – Grand-Rue",
                    "Haute Parfumerie Théodora", "Parfümerie Schnitzler", "Parfumerie Spitzenhaus",
                    "Lianne Tio Luxury Parfums"}
TRADITIONAL_NAMES = {"Osswald Parfumerie", "Parfumerie De Smedt"}
# Concept stores whose buyers do take one-off makers (local design, rotating drops): Med
CONCEPT_OPEN = {"Nose", "Hunting and Collecting", "VOO Store", "X BANK", "Skins Cosmetics",
                "Skins Antwerpen", "Skins Gent", "Skins Cosmetics Amsterdam", "Skins Cosmetics Den Haag"}
NICHE_HINT = re.compile(r"duft(?!.*kosmetik)|atelier|niche|haute parf|maison du parf|galerie|nez\b|\bnose\b|"
                        r"\bart\b|kunst|bar [àa] parf|perfumes of|salon de parf|olfact|sillage|essen[cz]", re.I)
BEAUTY_HINT = re.compile(r"kosmetik|institut|beaut|sch[öo]n|schoonheid|esth[ée]ti|spa\b|nagel|wellness", re.I)


def segment_of(r):
    key = r["network"] if r["network"] not in (None, INDEPENDENT[0]) else r["name"]
    if r["name"] in VERIFIED_MICRO or key in VERIFIED_MICRO:
        return TRUE_INDIE
    if r["type"] == DS:
        return DEPT
    if r["type"] == CS:
        return SELECTIVE
    if r["name"] in SPECIALIST_NAMES or key in SPECIALIST_NAMES:
        return SPECIALIST
    if r["name"] in TRADITIONAL_NAMES or BEAUTY_HINT.search(r["name"]):
        return TRADITIONAL
    if r["network"] == INDEPENDENT[0] and not NICHE_HINT.search(r["name"]):
        return TRADITIONAL   # unassessed family perfumery: prestige brands first until a visit says otherwise
    return INDIE_TBC


def calibrate(r):
    seg = segment_of(r)
    openness, barrier, cap, priority = SEGMENT_RULES[seg]
    key = r["network"] if r["network"] not in (None, INDEPENDENT[0]) else r["name"]
    if seg == SELECTIVE and (r["name"] in CONCEPT_OPEN or key in CONCEPT_OPEN):
        openness, cap = "Med", 65
    r.update(segment=seg, single_sku_openness=openness, entry_barrier=barrier, launch_priority=priority,
             openness_verified=seg == TRUE_INDIE,
             brand_alignment_score=min(r["brand_alignment_score"], cap))


# --------------------------------------------------- customer sentiment insights
# Critical consumer insights for sales prep. Store-level rows synthesise recurring themes
# of public reviews (Google, Fragrantica / Basenotes threads, Tripadvisor); they are
# paraphrased patterns, never quotes. Fields: staff, footfall, sampling, atmosphere,
# watch_out (the friction a rep should expect).
INSIGHTS = {
    # FRANCE
    "Jovoy Paris": ("Deeply knowledgeable team, happy to talk for an hour; some reviewers find the pitch towards Jovoy's own line insistent.",
                    "Steady flow of collectors and fragrance tourists; Saturdays crowded around the main tables.",
                    "Blotters freely; skin tests on request; take-home samples are limited and usually tied to a purchase.",
                    "Library-like salon off Rue de Rivoli, hundreds of houses on shelves, warm and theatrical.",
                    "Buying team wants a full story and sell-through proof; one SKU gets lost among 100+ houses."),
    "Nose": ("Diagnostic-led advice on tablets, pedagogic and patient; a few reviews call it formulaic.",
             "Sentier office crowd at lunch, quieter weekday mornings.",
             "Olfactive profile then mouillettes; small samples available against a fee.",
             "Bright apothecary-meets-lab space with a diagnosis counter.",
             "Catalogue organised by olfactive family: pitch where the SKU fits their grid."),
    "Sens Unique": ("Owners know every brand they carry and defend small houses with conviction.",
                    "Marais walk-in traffic, many tourists on weekends but rarely a queue.",
                    "Generous with blotters and skin tests; samples offered to regulars.",
                    "Intimate, slightly cluttered shop; feels like a collector's den.",
                    "Very personal taste: bring the story and the juice, not a deck."),
    "Marie Antoinette": ("Founder-run, storytelling-heavy service praised in nearly every review.",
                         "Tiny shop: three customers fill it; tourist flow from Place du Marché Sainte-Catherine.",
                         "Free sniffing, samples for interested buyers.",
                         "Jewel box on a quiet square, curated like a cabinet of curiosities.",
                         "Shelf space is minuscule; one SKU is ideal but expect consignment terms."),
    "Dover Street Parfums Market": ("Staff are expert but selective in who they engage; several reviews mention a cool, aloof first contact.",
                                    "Fashion crowd and design tourists; calm on weekdays.",
                                    "Self-serve testers; no take-home samples as a rule.",
                                    "White gallery space with experimental installations.",
                                    "Buying aligned with DSM London: listing decisions are not made in store."),
    "Liquides Bar à Parfums": ("Geeky, relaxed bartenders-of-scent; consistently praised for no-pressure advice.",
                               "Haut-Marais regulars and perfume tourists; small and rarely crowded.",
                               "Tasting-bar format: you smell everything; samples generous for serious buyers.",
                               "Zinc bar, glass bells and bottles served like spirits.",
                               "Founder is a brand owner too: be clear on how you differ from their own line."),
    "Le Bon Marché Rive Gauche": ("Brand-employed consultants: expert on their own counter, little cross-brand advice.",
                                  "Affluent Rive Gauche locals plus tourists; calmer than Haussmann.",
                                  "Strict: testers yes, samples mostly with purchase.",
                                  "Refined, bright beauty hall; luxury retail at its most polished.",
                                  "Listing goes through LVMH-owned central buying with launch budgets and staff funding."),
    "Printemps Haussmann": ("Sales-driven counter staff, frequent commission pressure noted in reviews.",
                            "Very heavy tourist footfall; tax-free queues; packed on weekends.",
                            "Samples scarce outside launches.",
                            "Grand, busy and loud beauty floor.",
                            "Brands pay for space and promoters; a single-SKU indie has no route in."),
    "Galeries Lafayette Haussmann": ("Transactional service; multilingual staff focused on conversion.",
                                     "Among the busiest stores in Europe; coach tours under the dome.",
                                     "Testers everywhere, take-home samples rare.",
                                     "Iconic, spectacular, crowded.",
                                     "Corner rental and staffing costs exclude micro-brands."),
    "Galeries Lafayette Champs-Élysées": ("Younger, more conversational team; curated niche wall gets good feedback.",
                                         "Tourist-dominated avenue footfall.",
                                         "Testers open; samples on request at quiet times.",
                                         "Contemporary concept layout, less formal than Haussmann.",
                                         "Still Galeries Lafayette central buying; pop-up slots are the only door."),
    "La Samaritaine (DFS)": ("Polished, travel-retail style service.",
                             "International tourists; strong Asian and Gulf clientele.",
                             "Testers yes, samples minimal.",
                             "Art Nouveau splendour, luxury mall feel.",
                             "DFS buys centrally for travel retail; requires global distribution."),
    "BHV Marais": ("Mixed: helpful but often understaffed.",
                   "Local Parisian shoppers, busy late afternoons.",
                   "Testers; samples rare.",
                   "Practical, mainstream department store.",
                   "Occasional emerging-brand pop-ups are the only realistic entry."),
    "Galeries Lafayette Nice Masséna": ("Counter staff vary by brand; mostly sales-led.",
                                        "Cruise and summer tourists.", "Strict sampling.",
                                        "Standard regional department store.", "Central Paris buying."),
    "Galeries Lafayette Bordeaux": ("Sales-led counters.", "Busy city-centre shoppers.", "Strict sampling.",
                                    "Functional regional store.", "Central Paris buying."),
    "Galeries Lafayette Strasbourg": ("Bilingual staff for German shoppers.", "Cross-border weekend crowds.",
                                      "Strict sampling.", "Large, bright, mainstream.", "Central Paris buying."),
    "Printemps Lille": ("Polite, brand-trained counters.", "Belgian cross-border shoppers on Saturdays.",
                        "Samples with purchase.", "Elegant historic building.", "Central Printemps buying."),
    "Galeries Lafayette Marseille Saint-Ferréol": ("Sales-led counters.", "Busy pedestrian street.", "Strict sampling.",
                                                   "Mainstream.", "Central Paris buying."),
    "Galeries Lafayette Lyon Part-Dieu": ("Sales-led, high-volume.", "Mall traffic, station commuters.", "Strict sampling.",
                                          "Mall department store.", "Central Paris buying."),
    # BELGIUM
    "Senteurs d'Ailleurs": ("Highly expert staff; a minority of reviews mention a snobbish welcome for non-regulars.",
                            "Affluent Louise/Stéphanie clientele, international expats; calm weekdays.",
                            "Free sniffing; samples for good clients, otherwise sparing.",
                            "Elegant, gallery-like flagship with a luxe skincare floor.",
                            "Large catalogue and a demanding buyer: expect collection + marketing questions."),
    "Place Vendôme Haute Parfumerie": ("Owner-led, personal follow-up; repeatedly praised for patience.",
                                       "Destination store: visitors come by car on purpose; no tourist flow.",
                                       "Generous sampling culture, decants for regulars.",
                                       "Warm suburban salon.",
                                       "Owner decides alone: a strong juice and a fair margin win."),
    "Liquides Confidentiels": ("Passionate owner who loves unknown houses.",
                               "Local Namur clientele plus collectors who travel for it.",
                               "Very generous with samples.",
                               "Small, friendly, unpretentious.",
                               "Low volumes: keep MOQ tiny and offer sale-or-return."),
    "Skins Antwerpen": ("Calm, well-trained staff guiding by olfactive family.",
                        "Fashion-district shoppers; busy Saturdays.",
                        "Testers open; samples on request.",
                        "Minimalist Skins concept.",
                        "Skins buys centrally in Amsterdam; store teams only relay."),
    "Skins Gent": ("Unhurried, advisory staff.", "Students and locals, steady weekends.", "Samples on request.",
                   "Design-led and calm.", "Central Skins buying."),
    "Parfumerie De Smedt": ("Loyal, personal service for long-time clients.", "Local town-centre shoppers.",
                            "Samples for regulars.", "Classic family perfumery.",
                            "Shelf is prestige-led (Chanel, Dior…): niche single SKU is a hard sell."),
    "Inno Rue Neuve": ("Understaffed at peaks; mixed reviews on service.", "Huge mainstream footfall on Rue Neuve.",
                       "Strict sampling.", "Busy, mass-prestige.", "Central buying, corner fees."),
    "Inno Meir": ("Sales-led.", "Antwerp's main shopping street.", "Strict sampling.", "Mainstream.", "Central buying."),
    "Graanmarkt 13": ("Knowledgeable, quietly confident staff.", "Design tourists and local fashion insiders.",
                      "Testers only.", "Gallery-like, restaurant downstairs, apartment above.",
                      "Beauty shelf is tiny and visual: packaging must earn its place."),
    "Hunting and Collecting": ("Friendly fashion staff, little fragrance expertise.", "Dansaert fashion crowd.",
                               "Testers when stocked.", "Raw, curated concept space.",
                               "Fragrance is a side category; position as a design object."),
    "Smets Brussels": ("Polished, brand-led service.", "Car-borne affluent shoppers; quiet weekdays.",
                       "Testers only.", "Huge luxury concept warehouse.", "Brand-heavy edit; prefers established labels."),
    # NETHERLANDS
    "Skins Cosmetics Amsterdam": ("Spot-on recommendations, praised in most reviews.", "Nine Streets tourists + locals; very busy weekends.",
                                  "Generous samples on request.", "Compact, white, buzzing.",
                                  "Head office buys for all stores; a single SKU must fit their tight edit."),
    "Skins Cosmetics Den Haag": ("Calm, service-driven.", "Upmarket locals, diplomats.", "Samples on request.",
                                 "Quiet, elegant.", "Central Skins buying."),
    "Perfume Lounge": ("Owners love introducing small houses; personal advice.", "Oud-Zuid locals, low tourist flow.",
                       "Generous samples.", "Cosy lounge, sofa and coffee.", "Small volumes; consignment welcome."),
    "Babassu Amsterdam": ("Warm and advisory.", "Oud-Zuid residents.", "Samples for clients.", "Boutique, calm.",
                          "Babassu buys for its three stores: pitch the group."),
    "Babassu Den Haag": ("Strong personal service, multilingual.", "Expats and diplomats.", "Samples for clients.",
                         "Elegant city-centre shop.", "Group buying."),
    "Casa Babassu Wassenaar": ("Very personal follow-up.", "Wealthy village clientele.", "Samples for clients.",
                               "Villa-like boutique.", "Group buying."),
    "Lianne Tio Luxury Parfums": ("Founder curation, personal.", "Denneweg boutique shoppers.", "Samples on request.",
                                  "Intimate luxury.", "Selective: wants exclusivity in The Hague."),
    "De Bijenkorf Amsterdam": ("Mixed: excellent at niche counters, rushed elsewhere.", "Dam square crowds, very touristy.",
                               "Samples rare.", "Grand, busy.", "Central buying with brand-funded staff."),
    "De Bijenkorf Rotterdam": ("Brand-led counters.", "City shoppers.", "Samples rare.", "Modernist, bright.", "Central buying."),
    "De Bijenkorf Den Haag": ("Good counter staff, calmer.", "Locals.", "Samples rare.", "Art Deco.", "Central buying."),
    "De Bijenkorf Utrecht": ("Busy, brand-led.", "Station traffic.", "Samples rare.", "Modern mall store.", "Central buying."),
    "De Bijenkorf Maastricht": ("Elegant service.", "Belgian/German shoppers.", "Samples rare.", "Refined.", "Central buying."),
    "De Bijenkorf Eindhoven": ("Brand-led.", "Regional shoppers.", "Samples rare.", "Mall-style.", "Central buying."),
    "X BANK": ("Design-savvy staff, little fragrance depth.", "Hotel guests and tourists.", "Testers only.",
               "Dutch design gallery in a former bank.", "Champions local makers: Dutch story helps."),
    # LUXEMBOURG
    "Parfumerie Celeste": ("Personal, multilingual advice.", "Old-town locals and EU workers.", "Samples for clients.",
                           "Intimate boutique.", "Owner buys directly; open to one-reference houses."),
    "Paris 8 Haute Parfumerie – Grand-Rue": ("Professional, prestige-led service.", "High-street footfall.", "Samples with purchase.",
                                             "Classic luxury perfumery.", "Group buyer wants a range and a marketing plan."),
    "Sephora – Grand-Rue (Place d'Armes)": ("Young, sales-focused staff.", "Busiest beauty address in the old town.",
                                            "Samples via loyalty programme only.", "Bright, mass-prestige.",
                                            "Global Sephora listing only."),
    # GERMANY
    "KaDeWe": ("Expert niche counters, but brand-employed; service quality varies by counter.", "Heavy tourist footfall all week.",
               "Samples scarce, strictly with purchase at many counters.", "Vast, glamorous perfume hall.",
               "Listing via KaDeWe Group buyers; brands fund staff and space."),
    "Apropos The Concept Store Berlin": ("Fashion-trained, polished.", "Ku'damm affluent shoppers.", "Testers only.",
                                         "Theatrical former cinema.", "Wants brands with fashion credibility."),
    "Belle Rebelle": ("Enthusiastic, story-driven staff.", "West-Berlin locals and fragrance fans.", "Generous with samples.",
                      "Playful, colourful boutique.", "Owner-led buying; good fit for a single hero SKU."),
    "The Corner Berlin": ("Refined but reserved.", "Luxury tourists near Gendarmenmarkt.", "Testers only.",
                          "Luxury multi-brand.", "Prefers established luxury labels."),
    "VOO Store": ("Cool, knowledgeable fashion staff.", "Kreuzberg creatives and tourists.", "Testers when stocked.",
                  "Courtyard concept store.", "Fragrance is occasional; pitch as limited drop."),
    "Ludwig Beck": ("Competent, long-serving perfumery team.", "Marienplatz tourists and locals.", "Samples on request at niche floor.",
                    "Classic 'Kaufhaus der Sinne'.", "Central buyer; niche floor does test new houses."),
    "Oberpollinger": ("Polished but commercial.", "Very busy pedestrian zone.", "Samples rare.", "Luxurious beauty hall.",
                      "KaDeWe Group central buying."),
    "Harald Lubner": ("Long-standing, knowledgeable team.", "Hamburg regulars and collectors.", "Generous samples.",
                      "Classic niche institution.", "Selective: expects a collection, not a single scent."),
    "Apropos The Concept Store Hamburg": ("Fashion-forward, polished.", "Jungfernstieg shoppers.", "Testers only.",
                                          "Luxe concept store.", "Group buying in Cologne."),
    "Alsterhaus": ("Brand-led counters; formal.", "Jungfernstieg crowds, tourists.", "Samples rare.", "Grand department store.",
                   "KaDeWe Group central buying."),
    "Parfümerie Schnitzler": ("Attentive, expert service.", "Königsallee luxury shoppers.", "Samples for clients.",
                              "Sophisticated perfumery.", "Wants exclusivity on the Kö."),
    "Breuninger Düsseldorf": ("Professional, luxury service.", "Kö-Bogen footfall.", "Samples with purchase.",
                              "Architectural, premium.", "Central buying in Stuttgart."),
    "Breuninger Stuttgart": ("Excellent niche counters.", "Regional affluent shoppers.", "Samples with purchase.",
                             "Flagship luxury.", "Central buying; demanding listing terms."),
    "Apropos The Concept Store Cologne": ("Polished.", "Mittelstraße luxury shoppers.", "Testers only.", "Luxe.", "Group buying."),
    "Essenza Nobile": ("Expert, detailed advice (also online).", "Destination store; most volume online.",
                       "Famous for samples and discovery sets.", "Large niche emporium.",
                       "Strong buying team; e-commerce listing needs content and stock depth."),
    "Breuninger Freiburg": ("Friendly staff.", "Swiss/French cross-border.", "Samples with purchase.", "Premium.", "Central buying."),
    # SWITZERLAND
    "Parfumerie Spitzenhaus": ("Knowledgeable, loyal-client focus.", "Old-town Zürich locals.", "Samples for clients.",
                               "Traditional boutique.", "Buys collections; wants Swiss exclusivity."),
    "Osswald Parfumerie": ("Formal, expert, occasionally stiff with unknown visitors.", "Bahnhofstrasse luxury traffic.",
                           "Samples with purchase.", "Old-school luxury perfumery.",
                           "Prestige houses first; niche entry needs strong references."),
    "Globus Zürich Bahnhofstrasse": ("Professional.", "Very busy, tourists.", "Samples rare.", "Premium department store.",
                                     "Central Globus buying."),
    "Bongénie Zürich": ("Attentive, luxury service.", "Bahnhofstrasse shoppers.", "Samples with purchase.", "Refined.",
                        "Central Bongénie buying in Geneva."),
    "Globus Genève": ("Professional.", "International clientele.", "Samples rare.", "Lakeside luxury.", "Central buying."),
    "Bongénie Genève": ("Attentive, expert staff.", "Wealthy locals and Gulf visitors.", "Samples with purchase.",
                        "Elegant flagship.", "Central buying, exclusive launches."),
    "Haute Parfumerie Théodora": ("Very personal, appointment-style.", "Old-town clientele, low footfall.", "Samples for clients.",
                                  "Exclusive salon.", "Selective: luxury positioning and price point matter."),
    "Globus Basel": ("Professional.", "Marktplatz shoppers.", "Samples rare.", "Historic store.", "Central buying."),
    "Globus Bern": ("Quiet, good service.", "Old-town shoppers.", "Samples rare.", "Arcaded store.", "Central buying."),
    "Bongénie Lausanne": ("Attentive.", "Upscale locals.", "Samples with purchase.", "Upscale.", "Central buying."),
    "Globus Lausanne": ("Professional.", "Downtown traffic.", "Samples rare.", "Premium.", "Central buying."),
    "Globus Luzern": ("Tourist-oriented.", "Heavy tourist traffic.", "Samples rare.", "Central store.", "Central buying."),
}
# Network-level patterns for harvested branches of known networks
NETWORK_INSIGHTS = {
    "Le Bon Marché": INSIGHTS["Le Bon Marché Rive Gauche"],
    "La Samaritaine (DFS)": INSIGHTS["La Samaritaine (DFS)"],
    "Galeries Lafayette": ("Sales-led brand counters; expertise varies by brand.", "City-centre shoppers; busy Saturdays.",
                           "Strict: samples mostly with purchase.", "Regional department store.",
                           "Galeries Lafayette central buying in Paris; corner fees."),
    "Printemps": ("Brand-trained counters.", "City-centre shoppers.", "Samples with purchase.", "Department store.",
                  "Central Printemps buying."),
    "BHV": INSIGHTS["BHV Marais"],
    "INNO": ("Often understaffed; mixed service.", "Mainstream high-street footfall.", "Strict sampling.",
             "Mass-prestige department store.", "Central buying, corner fees."),
    "De Bijenkorf": ("Brand-led counters.", "City shoppers.", "Samples rare.", "Premium department store.", "Central buying."),
    "KaDeWe": INSIGHTS["KaDeWe"], "Oberpollinger": INSIGHTS["Oberpollinger"], "Alsterhaus": INSIGHTS["Alsterhaus"],
    "Ludwig Beck": INSIGHTS["Ludwig Beck"],
    "Breuninger": ("Professional, luxury service.", "Affluent regional shoppers.", "Samples with purchase.",
                   "Premium department store.", "Central buying in Stuttgart; demanding terms."),
    "Engelhorn": ("Fashion-house service, competent.", "Regional shoppers.", "Samples with purchase.", "Premium.", "Central buying."),
    "Konen": ("Polite fashion staff.", "Munich shoppers.", "Samples with purchase.", "Premium fashion house.", "Central buying."),
    "Apropos The Concept Store": INSIGHTS["Apropos The Concept Store Berlin"],
    "Globus": ("Professional.", "City-centre, tourist-exposed.", "Samples rare.", "Premium department store.", "Central buying."),
    "Bongénie": ("Attentive luxury service.", "Upscale locals.", "Samples with purchase.", "Refined.", "Central buying in Geneva."),
    "Manor": ("Friendly but generalist; little niche expertise.", "Mainstream town-centre footfall.", "Strict sampling.",
              "Mass-prestige department store.", "Central buying in Basel; niche rarely listed."),
    "Loeb": ("Courteous, local.", "Bern shoppers.", "Samples with purchase.", "Family department store.", "Central buying."),
    "Skins Cosmetics": ("Well-trained, advisory staff.", "High-street shoppers; busy weekends.", "Samples on request.",
                        "Minimalist concept.", "Central buying in Amsterdam; tight edit."),
    "Paris 8 Haute Parfumerie": INSIGHTS["Paris 8 Haute Parfumerie – Grand-Rue"],
    "Aus Liebe zum Duft": ("Expert, enthusiastic.", "Destination + online.", "Strong sample culture.", "Large niche shop.",
                           "Buying team wants a collection and online content."),
    "Essenza Nobile": INSIGHTS["Essenza Nobile"],
    "Babassu": INSIGHTS["Babassu Amsterdam"],
    "Senteurs d'Ailleurs": INSIGHTS["Senteurs d'Ailleurs"],
    "Jovoy": INSIGHTS["Jovoy Paris"],
    "Liquides": INSIGHTS["Liquides Bar à Parfums"],
}
TOURIST_CITIES = {"Paris", "Nice", "Cannes", "Saint-Tropez", "Monaco", "Courchevel", "Amsterdam", "Brussels", "Bruges",
                  "Berlin", "Munich", "Zürich", "Geneva", "Lucerne", "Interlaken", "Zermatt", "Gstaad", "St. Moritz",
                  "Luxembourg", "Strasbourg", "Cologne", "Hamburg", "Heidelberg", "Baden-Baden", "Sylt", "Knokke-Heist",
                  "Avignon", "Aix-en-Provence", "Bordeaux", "Lyon", "Biarritz", "Dresden", "Frankfurt am Main"}


def derived_insights(r):
    """Profile-based expectations for stores nobody has reviewed for us yet."""
    tourist = r["city"] in TOURIST_CITIES
    footfall = ("Tourist-exposed city: expect walk-in visitors on weekends." if tourist
                else "Local, repeat clientele; footfall depends on the town centre.")
    if r["segment"] == TRADITIONAL:
        return ("Owner or long-serving staff; advice centred on prestige houses.", footfall,
                "Samples typically offered to regulars or with purchase.",
                "Classic town perfumery, often with a beauty cabin.",
                "Shelf is built on Chanel/Dior/Guerlain-type brands: probe niche appetite before pitching.")
    return ("Owner-run: expertise depends on the founder, verify on a first visit.", footfall,
            "Unknown sampling policy: ask whether they decant or keep a discovery shelf.",
            "Independent perfumery with a niche-sounding identity.",
            "Unverified fit: check Instagram for current brands before sending samples.")


def pitch_for(r):
    return {
        TRUE_INDIE: "Founder pitch in person: story, juice on skin, sale-or-return on 3-6 units of the single SKU.",
        INDIE_TBC: "Visit first; if the shelf is niche, offer a consignment trial of the single SKU.",
        SPECIALIST: "Approach the buyer with a mini-collection plan (hero SKU + roadmap), testers and sell-through data.",
        TRADITIONAL: "Low priority: only pitch if the owner shows niche appetite; lead with gifting and margin.",
        SELECTIVE: "Pitch the central buyer as a design object / limited drop; expect exclusivity and visuals requests.",
        DEPT: "Long-term: needs distribution, launch budget and staffing; build indie references first.",
    }[r["segment"]]


def cx_insights(r):
    key = r["network"] if r["network"] not in (None, INDEPENDENT[0]) else None
    if r["source"] == "curated" and r["name"] in INSIGHTS:
        fields, basis = INSIGHTS[r["name"]], "Store-level synthesis of public reviews"
    elif key in NETWORK_INSIGHTS:
        fields, basis = NETWORK_INSIGHTS[key], f"Network pattern ({key}) — confirm for this branch"
    else:
        fields, basis = derived_insights(r), "Derived from store profile & location — verify on visit"
    out = dict(zip(("staff", "footfall", "sampling", "atmosphere", "watch_out"), fields))
    out.update(pitch=pitch_for(r), basis=basis)
    return out


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
    if MONO.search(label) or EXCLUDE.search(label):
        return None
    for pattern, chain, *profile in CHAIN_PROFILES:
        if re.search(pattern, name, re.I) or (r.get("brand") and re.search(pattern, r["brand"], re.I)):
            return (chain, *profile)
    if MASS.search(label):
        return None
    if r["shop"] in ("perfumery",) or (r["shop"] in ("cosmetics", "beauty")
                                       and re.search(r"parf|perfum|duft|profum|fragr", name, re.I)):
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
    for (name, typ, cc, city, addr, lat, lng, tier, align, openness, traits, sentiment, osm, addr_src) in TARGET_ROWS:
        out.append({
            "name": name, "type": typ, "country": cc, "city": city, "full_address": addr,
            "lat": lat, "lng": lng, "tier_score": tier, "brand_alignment_score": align,
            "single_sku_openness": openness, "customer_experience_rating": None, "traits": traits,
            "sentiment_summary": sentiment, "network": None, "source": f"osm:{osm}", "address_source": addr_src,
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


def normalize_address(r):
    """Postal formats per country: NL "1234 AB", LU "L-1234"; strips foreign "CH-" / "D-" prefixes; the
    country name always closes the address."""
    parts = [x.strip() for x in r["full_address"].split(",")]
    if parts[-1] not in COUNTRY_SUFFIX.values():
        parts.append(COUNTRY_SUFFIX[r["country"]])
    seg = re.sub(r"^(?:[A-Z]{1,2}-)?(\d{4,5})", r"\1", parts[-2])
    if r["country"] == "NL":
        seg = re.sub(r"^(\d{4})\s?([A-Za-z]{2})\b", lambda m: f"{m[1]} {m[2].upper()}", seg)
    if r["country"] == "LU":
        seg = re.sub(r"^(\d{4})\b", r"L-\1", seg)
    parts[-2] = seg
    r["full_address"] = ", ".join(parts)


def postcode_of(r):
    rx = POSTCODE[r["country"]][0]
    m = rx.match(r["full_address"].split(",")[-2].strip())
    return m.group(1) if m else None


def validate_postcodes(recs):
    """Format and range per country, then geography: every postcode area must sit near its own median."""
    errors, areas = [], {}
    for r in recs:
        pc = postcode_of(r)
        _, lo, hi = POSTCODE[r["country"]]
        if r.get("lat") is None or r.get("lng") is None:
            errors.append(f"{r['name']}: missing coordinates")
        if not pc:
            errors.append(f"{r['name']}: postcode not in {r['country']} format: {r['full_address']}")
        elif not lo <= int(pc) <= hi:
            errors.append(f"{r['name']}: postcode {pc} outside the {r['country']} range")
        else:
            areas.setdefault((r["country"], pc[:2] if r["country"] in ("FR", "DE") else pc[0]), []).append(r)
    for (cc, area), rows in areas.items():
        mid = (sorted(x["lat"] for x in rows)[len(rows) // 2], sorted(x["lng"] for x in rows)[len(rows) // 2])
        for x in rows:
            if dist_m(mid, (x["lat"], x["lng"])) > POSTCODE_AREA_KM[cc] * 1000:
                errors.append(f"{x['name']}: postcode area {cc}-{area} is {dist_m(mid, (x['lat'], x['lng'])) / 1000:.0f} km from its peers")
    return errors


def export_potential(r, peers):
    """Export Potential Score (0-100): local purchasing power, proximity to a luxury hub and the density of
    high-end doors nearby (a proxy for clientele that already buys luxury fragrance)."""
    pp_eur = PP_NATIONAL[r["country"]] * PP_DISTRICT.get(r["district"] or "", PP_CITY.get(r["city"], 1.0))
    pp = max(0.0, min(100.0, 100 * (pp_eur - PP_FLOOR) / (PP_CEIL - PP_FLOOR)))
    hub, hub_km = min(((h, dist_m((r["lat"], r["lng"]), (la, lo)) / 1000) for h, la, lo in LUXURY_HUBS), key=lambda x: x[1])
    hub_score = 100 * 0.5 ** (hub_km / HUB_HALF_KM)
    n = sum(1 for p in peers if p is not r and p["tier_score"] >= HIGH_END_TIER
            and dist_m((r["lat"], r["lng"]), (p["lat"], p["lng"])) <= CLIENTELE_KM * 1000)
    density = min(100.0, 25 * math.log2(1 + n))
    parts = {"purchasing_power": pp, "luxury_hub": hub_score, "clientele_density": density}
    score = round(sum(EXPORT_WEIGHTS[k] * v for k, v in parts.items()))
    return max(1, min(100, score)), {
        "purchasing_power": round(pp), "purchasing_power_eur": round(pp_eur, -2),
        "luxury_hub": round(hub_score), "nearest_hub": hub, "hub_km": round(hub_km, 1),
        "clientele_density": round(density), "high_end_doors_5km": n,
    }


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


# One spelling per city so the city filter does not split curated and OSM rows
CITY_ALIASES = {
    "Antwerpen": "Antwerp", "Gent": "Ghent", "Brugge": "Bruges", "Bruxelles": "Brussels",
    "Genève": "Geneva", "Luzern": "Lucerne", "St.Gallen": "St. Gallen", "München": "Munich",
    "Köln": "Cologne", "Nürnberg": "Nuremberg", "Freiburg": "Freiburg im Breisgau",
    "Eltville": "Eltville am Rhein", "'s-Gravenhage": "The Hague", "Den Haag": "The Hague",
}
BRUSSELS_COMMUNES = {"Ixelles", "Uccle", "Woluwe-Saint-Lambert", "Woluwe-Saint-Pierre", "Etterbeek",
                     "Saint-Gilles", "Schaerbeek", "Forest", "Auderghem", "Watermael-Boitsfort", "Anderlecht",
                     "Saint-Josse-ten-Noode", "Jette", "Evere", "Molenbeek-Saint-Jean", "Koekelberg",
                     "Ganshoren", "Berchem-Sainte-Agathe"}


def canonical_city(cc, city):
    """(city, commune) — bilingual Belgian names keep the first part; Brussels communes roll up."""
    if cc == "BE" and " - " in city:
        city = city.split(" - ")[0]
    if cc == "BE" and city in BRUSSELS_COMMUNES:
        return "Brussels", city
    return CITY_ALIASES.get(city, city), None


def district(r):
    """Paris / Lyon / Marseille arrondissement from the postcode (75008 -> "Paris 8e"),
    or the Brussels commune."""
    if r.get("commune"):
        return f"Brussels – {r['commune']}"
    m = re.search(r"\b(75|69|13)0(\d\d)\b", r["full_address"])
    city = {"75": "Paris", "69": "Lyon", "13": "Marseille"}.get(m.group(1)) if m else None
    if r["country"] != "FR" or not city or slug(r["city"]) != slug(city):
        return None
    n = int(m.group(2)) or 16  # 75116 -> 16e
    return f"{city} {n}{'er' if n == 1 else 'e'}"


def crm_key(r):
    """Stable across rebuilds (ids are not): name slug + coordinates to ~100 m."""
    return f"{slug(r['name']).replace(' ', '-')}@{r['lat']:.3f},{r['lng']:.3f}"


def decision_maker(r):
    """Who signs the opening order. Chains and department stores buy centrally (Head Buyer); concept-store
    chains delegate the door's assortment to its General Manager; independents are run by their founder."""
    chain = r["network"] not in (None, INDEPENDENT[0])
    if r["type"] == DS or (chain and r["type"] == NB):
        return "Head Buyer"
    return "General Manager" if chain else "Founder"


def load_crm():
    crm = json.loads(CRM_FILE.read_text(encoding="utf-8")) if CRM_FILE.exists() else {}
    for v in crm.values():
        if v.get("pipeline_status") in LEGACY_STATUS:
            v["pipeline_status"] = LEGACY_STATUS[v["pipeline_status"]]
        if v.get("decision_maker_role") in LEGACY_ROLE:
            v["decision_maker_role"] = LEGACY_ROLE[v["decision_maker_role"]]
    errors = [f"crm.json {k}: bad pipeline_status {v['pipeline_status']}"
              for k, v in crm.items() if v.get("pipeline_status", PIPELINE[0]) not in PIPELINE]
    errors += [f"crm.json {k}: bad decision_maker_role {v['decision_maker_role']}"
               for k, v in crm.items() if v.get("decision_maker_role", "Founder") not in ROLES]
    return crm, errors


def load_ledger():
    """sources/wholesale.json -> ({crm_key: entry}, demo flag, errors)."""
    if not LEDGER_FILE.exists():
        return {}, False, []
    raw = json.loads(LEDGER_FILE.read_text(encoding="utf-8"))
    ledger, errors = raw.get("accounts", {}), []
    date = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    for k, e in ledger.items():
        if e.get("pipeline_status", "Partner Active") not in PARTNER_STATUS:
            errors.append(f"wholesale.json {k}: pipeline_status must be Partner Active or Key Account")
        for d in e.get("deliveries", []):
            if not (date.match(d.get("date", "")) and isinstance(d.get("units"), int) and d["units"] > 0):
                errors.append(f"wholesale.json {k}: bad delivery {d}")
        for i in e.get("invoices", []):
            if not (date.match(i.get("date", "")) and date.match(i.get("due", "")) and i.get("status") in INVOICE_STATUS
                    and isinstance(i.get("amount"), (int, float)) and i["amount"] > 0):
                errors.append(f"wholesale.json {k}: bad invoice {i}")
    return ledger, bool(raw.get("demo")), errors


def wholesale(entry, demo):
    """Ledger entry -> record field: raw lines (chronological) plus totals the map and CSV reuse."""
    deliveries = sorted(entry.get("deliveries", []), key=lambda d: d["date"])
    invoices, running = [], 0.0
    for i in sorted(entry.get("invoices", []), key=lambda i: i["date"]):
        running += i["amount"]
        invoices.append({**i, "cumulative": round(running, 2)})
    paid = sum(i["amount"] for i in invoices if i["status"] == "Paid")
    return {
        "demo": demo, "since": entry.get("since") or (deliveries[0]["date"] if deliveries else None),
        "units_delivered": sum(d["units"] for d in deliveries),
        "revenue": round(running, 2), "paid": round(paid, 2), "outstanding": round(running - paid, 2),
        "deliveries": deliveries, "invoices": invoices,
    }


def build():
    merged, dropped = merge()
    crm, crm_errors = load_crm()
    ledger, demo, ledger_errors = load_ledger()
    for r in merged:
        normalize_address(r)
    errors = validate(merged) + validate_postcodes(merged) + crm_errors + ledger_errors
    records = []
    for r in merged:
        r["city"], r["commune"] = canonical_city(r["country"], r["city"])
        calibrate(r)
        r["cx_insights"] = cx_insights(r)
    errors += [f"{r['name']}: curated store has no INSIGHTS entry" for r in merged
               if r["source"] == "curated" and r["name"] not in INSIGHTS]
    errors += [f"{r['name']}: empty cx insight {k}" for r in merged for k, v in r["cx_insights"].items() if not v]
    merged.sort(key=lambda r: (r["country"], r["city"], -r["tier_score"], r["name"]))
    for i, r in enumerate(merged, 1):
        records.append({
            "id": i,
            "name": r["name"],
            "type": r["type"],
            "country": r["country"],
            "country_name": COUNTRY_NAMES[r["country"]],
            "city": r["city"],
            "district": district(r),
            "full_address": r["full_address"],
            "lat": r["lat"],
            "lng": r["lng"],
            "tier_score": r["tier_score"],
            "brand_alignment_score": r["brand_alignment_score"],
            "single_sku_openness": r["single_sku_openness"],
            "openness_verified": r["openness_verified"],
            "segment": r["segment"],
            "entry_barrier": r["entry_barrier"],
            "customer_experience_rating": r["customer_experience_rating"],
            "cx_traits": [TRAITS[t] for t in r["traits"].split()],
            "sentiment_summary": r["sentiment_summary"],
            "cx_insights": r["cx_insights"],
            "network": r["network"],
            "address_confidence": "confirmed",
            "address_confidence_score": ADDRESS_SCORE[r["address_source"]],
            "address_source": r["address_source"],
            "source": r["source"],
            "google_maps_url": "https://www.google.com/maps/search/?api=1&query=" + quote_plus(f"{r['name']}, {r['full_address']}"),
            "instagram_search_url": "https://www.instagram.com/explore/search/keyword/?q=" + quote_plus(f"{r['name']} {r['city']}"),
            "crm_key": crm_key(r),
            "postcode": postcode_of(r),
            "launch_priority": r["launch_priority"],
            "decision_maker_role": decision_maker(r),
            "pipeline_status": PIPELINE[0],
            "notes_prospections": "",
            "priority_target": r["name"] in TARGET_NAMES,
            "wholesale": None,
        })
        rec = records[-1]
        entry = ledger.get(rec["crm_key"])
        if entry:
            rec["pipeline_status"] = entry.get("pipeline_status", "Partner Active")
            rec["wholesale"] = wholesale(entry, demo)
        rec.update({k: v for k, v in crm.get(rec["crm_key"], {}).items() if k in CRM_FIELDS})
        if entry and rec["pipeline_status"] not in PARTNER_STATUS:
            errors.append(f"{rec['name']}: has a wholesale ledger but status {rec['pipeline_status']}")
    for rec in records:
        rec["export_potential_score"], rec["export_potential"] = export_potential(rec, records)
    keys = Counter(r["crm_key"] for r in records)
    errors += [f"duplicate crm_key: {k}" for k, n in keys.items() if n > 1]
    # Stores that left the harvest keep their CRM history in crm.json; only warn
    orphans = [k for k in crm if k not in keys]
    if orphans:
        print(f"warning: {len(orphans)} crm.json entries match no store: {', '.join(orphans[:5])}", file=sys.stderr)
    errors += [f"wholesale.json {k}: matches no store" for k in ledger if k not in keys]
    names = {r["name"] for r in records}
    errors += [f"PRIORITY_TARGETS: {n} is not in the dataset" for n in TARGET_NAMES if n not in names]
    return records, errors, dropped


def audit(records):
    """Terminal summary of the priority target list: present, newly added, still unresolved."""
    by_name = {r["name"]: r for r in records}
    added = {t[0] for t in TARGET_ROWS}
    rows = {"present": [], "added": [], "pending": []}
    for label, zone, name, note in PRIORITY_TARGETS:
        r = by_name.get(name)
        kind = "pending" if not r else "added" if name in added else "present"
        where = f"{r['name']} · {r['full_address']} [{r['address_source']}]" if r else ""
        rows[kind].append(f"{label} ({zone})" + (f" -> {where}" if where else "") + (f"  ({note})" if note else ""))
    print(f"\nPriority target audit ({len(PRIORITY_TARGETS)} boutiques)")
    for kind, title in (("present", "already present"), ("added", "newly added / verified"), ("pending", "unresolved, not mapped")):
        print(f"  {title}: {len(rows[kind])}")
        for line in rows[kind]:
            print(f"    {'✓' if kind == 'present' else '+' if kind == 'added' else '?'} {line}")


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
    print("  " + ", ".join(f"{k}: {v}" for k, v in count("segment")))
    print("  " + ", ".join(f"{k}: {v}" for k, v in count("decision_maker_role")))
    eps = sorted(r["export_potential_score"] for r in records)
    print(f"  export potential: min {eps[0]} · median {eps[len(eps) // 2]} · max {eps[-1]}")
    print("  openness " + ", ".join(f"{k}: {v}" for k, v in count("single_sku_openness")))
    print("  " + ", ".join(f"{k}: {v}" for k, v in count("pipeline_status")))
    print("  " + ", ".join(f"{k}: {v}" for k, v in count("source") if k == "curated") +
          f", osm: {sum(r['source'].startswith('osm') for r in records)}")
    ledgers = [r["wholesale"] for r in records if r["wholesale"]]
    if ledgers:
        print(f"  wholesale ledger{' (demo)' if ledgers[0]['demo'] else ''}: {len(ledgers)} partners, "
              f"{sum(w['units_delivered'] for w in ledgers)} units delivered, "
              f"{sum(w['revenue'] for w in ledgers):,.0f} EUR invoiced, {sum(w['outstanding'] for w in ledgers):,.0f} EUR outstanding")
    audit(records)


if __name__ == "__main__":
    main()
