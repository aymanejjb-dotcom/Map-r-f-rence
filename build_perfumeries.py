#!/usr/bin/env python3
"""Compile the niche perfumery dataset (BE, NL, DE, FR, LU, CH).

Outputs:
  perfumeries.json  canonical dataset
  perfumeries.js    same data as `window.PERFUMERIES` so index.html works from file://

Scores are editorial estimates (curation, prestige, openness to indie brands),
not measured values. `address_confidence` tells how much to trust the address:
  verified     landmark / flagship address, stable for years
  approximate  correct street or district, number may differ
  to_verify    store known to exist in that city; street must be checked
Coordinates are geocoded to the street/district level.
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
#  cx_rating, traits, sentiment, address_confidence)
RAW = [
    # ---------------------------------------------------------------- FRANCE
    ("Jovoy Paris", NB, "FR", "Paris", "4 Rue de Castiglione, 75001 Paris", 48.8659, 2.3291, 96, 72, "High", 4.6, "ES FS GS IB DB",
     "Widely seen as the temple of independent perfumery; staff are passionate and let visitors explore hundreds of houses at leisure.", "verified"),
    ("Nose", CS, "FR", "Paris", "20 Rue Bachaumont, 75002 Paris", 48.8655, 2.3449, 88, 82, "High", 4.5, "ES FS DB IB AP",
     "Known for its olfactory diagnosis that recommends scents by profile; calm, pedagogic atmosphere with strong indie curation.", "verified"),
    ("Sens Unique", NB, "FR", "Paris", "13 Rue des Francs-Bourgeois, 75004 Paris", 48.8555, 2.3633, 82, 86, "High", 4.6, "ES FS GS IB",
     "Intimate Marais boutique praised for owners who champion small artisan houses and take time with every customer.", "approximate"),
    ("Marie Antoinette", NB, "FR", "Paris", "5 Rue d'Ormesson, 75004 Paris", 48.8556, 2.3623, 80, 84, "High", 4.7, "ES FS IB GS",
     "Tiny jewel-box shop on a Marais square; reviewers love the founder's personal storytelling and rare discoveries.", "approximate"),
    ("Dover Street Parfums Market", CS, "FR", "Paris", "11 bis Rue d'Alger, 75001 Paris", 48.8653, 2.3304, 89, 62, "Med", 4.5, "ES FS DB IB LX",
     "Gallery-like space by the Comme des Garçons/DSM team with a sharp, experimental edit; staff are knowledgeable but selective.", "verified"),
    ("Liquides Bar à Parfums", CS, "FR", "Paris", "9 Rue de Normandie, 75003 Paris", 48.8622, 2.3641, 85, 88, "High", 4.7, "ES FS DB IB GS",
     "Bar-style tasting counter where fragrances are served like spirits; beloved for its relaxed, geeky expertise.", "verified"),
    ("Officina Profumo-Farmaceutica di Santa Maria Novella", NB, "FR", "Paris", "Rue de l'Abbaye, 75006 Paris (Saint-Germain)", 48.8540, 2.3350, 86, 8, "Low", 4.4, "MB ES GW LX",
     "Historic Florentine apothecary atmosphere; elegant service, but strictly its own catalogue.", "to_verify"),
    ("Le Bon Marché Rive Gauche", DS, "FR", "Paris", "24 Rue de Sèvres, 75007 Paris", 48.8510, 2.3247, 93, 34, "Low", 4.2, "LX ES FS PS BW",
     "The most refined Paris department store; its beauty hall mixes heritage houses and selected niche, with a calmer crowd than Haussmann.", "verified"),
    ("Printemps Haussmann", DS, "FR", "Paris", "64 Boulevard Haussmann, 75009 Paris", 48.8738, 2.3283, 90, 30, "Low", 3.9, "TC PS LX BW",
     "Huge fragrance floor with exclusive launches; great breadth but very busy and sales-driven at peak times.", "verified"),
    ("Galeries Lafayette Haussmann", DS, "FR", "Paris", "40 Boulevard Haussmann, 75009 Paris", 48.8735, 2.3320, 91, 28, "Low", 3.8, "TC PS BW LX",
     "Iconic dome and Europe's largest beauty hall; impressive choice, but crowded and transactional.", "verified"),
    ("Galeries Lafayette Champs-Élysées", DS, "FR", "Paris", "60 Avenue des Champs-Élysées, 75008 Paris", 48.8713, 2.3045, 88, 32, "Low", 4.0, "TC LX PS IB",
     "Concept-store take on the department store with a curated niche wall; tourist-heavy but more contemporary edit.", "verified"),
    ("La Samaritaine (DFS)", DS, "FR", "Paris", "9 Rue de la Monnaie, 75001 Paris", 48.8590, 2.3428, 90, 25, "Low", 4.1, "LX TC PS",
     "Spectacular Art Nouveau setting with a large beauty floor; polished service, travel-retail pricing and atmosphere.", "verified"),
    ("BHV Marais", DS, "FR", "Paris", "52 Rue de Rivoli, 75004 Paris", 48.8576, 2.3536, 70, 40, "Low", 3.5, "BW PS",
     "Practical central store with a mainstream-leaning beauty floor; occasional pop-ups for emerging brands.", "verified"),
    ("Serge Lutens – Palais Royal", NB, "FR", "Paris", "142 Galerie de Valois, 75001 Paris", 48.8649, 2.3378, 95, 5, "Low", 4.7, "MB ES LX FS",
     "Theatrical violet-panelled salon; a pilgrimage site with exclusive bell jars and hushed, expert service.", "verified"),
    ("Frédéric Malle", NB, "FR", "Paris", "37 Rue de Grenelle, 75007 Paris", 48.8541, 2.3265, 93, 5, "Low", 4.6, "MB ES FS LX",
     "Famous smelling columns let you test without spraying skin; precise, unhurried guidance.", "verified"),
    ("Maison Francis Kurkdjian", NB, "FR", "Paris", "5 Rue d'Alger, 75001 Paris", 48.8651, 2.3310, 94, 5, "Low", 4.4, "MB LX TC GW",
     "Luminous flagship with refined service; often busy with visitors seeking Baccarat Rouge 540.", "verified"),
    ("Guerlain – 68 Champs-Élysées", NB, "FR", "Paris", "68 Avenue des Champs-Élysées, 75008 Paris", 48.8716, 2.3038, 93, 5, "Low", 4.2, "MB TC LX GW",
     "Historic flagship with bespoke bee-bottle engraving; grand but very touristic.", "verified"),
    ("Diptyque – Saint-Germain", NB, "FR", "Paris", "34 Boulevard Saint-Germain, 75005 Paris", 48.8508, 2.3524, 86, 5, "Low", 4.4, "MB FS GW",
     "The original 1961 boutique; charming, warm staff and a strong sense of brand heritage.", "verified"),
    ("Ex Nihilo", NB, "FR", "Paris", "352 Rue Saint-Honoré, 75001 Paris", 48.8670, 2.3290, 85, 5, "Low", 4.3, "MB LX AP",
     "Sleek boutique offering on-site personalisation via its Osmologue; upscale and attentive.", "approximate"),
    ("Officine Universelle Buly 1803", NB, "FR", "Paris", "6 Rue Bonaparte, 75006 Paris", 48.8564, 2.3343, 87, 5, "Low", 4.5, "MB GW ES TC",
     "Beautifully staged 19th-century apothecary concept with calligraphy service; queues on weekends.", "verified"),
    ("Hermès – Faubourg Saint-Honoré", NB, "FR", "Paris", "24 Rue du Faubourg Saint-Honoré, 75008 Paris", 48.8686, 2.3207, 95, 3, "Low", 4.3, "MB LX TC",
     "Historic Hermès house; the perfume corner offers the Hermessence line with impeccable service.", "verified"),
    ("Chanel – 31 Rue Cambon", NB, "FR", "Paris", "31 Rue Cambon, 75001 Paris", 48.8680, 2.3268, 97, 2, "Low", 4.3, "MB LX TC",
     "Coco Chanel's original maison; Les Exclusifs available, formal and often busy.", "verified"),
    ("Musée du Parfum Fragonard (Opéra)", NB, "FR", "Paris", "3-5 Square de l'Opéra Louis-Jouvet, 75009 Paris", 48.8714, 2.3299, 65, 5, "Low", 4.3, "MB TC FS",
     "Free museum-shop visit popular with tourists; educational more than curatorial.", "verified"),
    ("Galeries Lafayette Nice Masséna", DS, "FR", "Nice", "6 Avenue Jean Médecin, 06000 Nice", 43.6990, 7.2690, 74, 30, "Low", 3.7, "TC PS",
     "Main Riviera department store; solid prestige brands, limited niche depth.", "approximate"),
    ("Galeries Lafayette Bordeaux", DS, "FR", "Bordeaux", "11-19 Rue Sainte-Catherine, 33000 Bordeaux", 44.8410, -0.5740, 72, 30, "Low", 3.6, "BW PS",
     "Busy city-centre store; useful prestige counters, niche selection rotates.", "approximate"),
    ("Galeries Lafayette Strasbourg", DS, "FR", "Strasbourg", "34 Rue du 22 Novembre, 67000 Strasbourg", 48.5830, 7.7440, 72, 30, "Low", 3.6, "PS BW",
     "Largest beauty floor in Alsace; attracts cross-border German shoppers.", "approximate"),
    ("Printemps Lille", DS, "FR", "Lille", "39-41 Rue Nationale, 59000 Lille", 50.6360, 3.0610, 70, 32, "Low", 3.6, "PS BW",
     "Elegant regional store close to Belgian border; mainstream prestige with occasional niche corners.", "approximate"),
    ("Fragonard – Usine Historique", NB, "FR", "Grasse", "20 Boulevard Fragonard, 06130 Grasse", 43.6577, 6.9246, 70, 5, "Low", 4.4, "MB TC FS",
     "Free factory tours in the perfume capital; friendly, educational, coach-tour crowds.", "verified"),
    ("Molinard", NB, "FR", "Grasse", "60 Boulevard Victor Hugo, 06130 Grasse", 43.6560, 6.9200, 68, 5, "Low", 4.4, "MB FS AP",
     "Historic Grasse house with create-your-own-perfume workshops; warm, hands-on hosts.", "approximate"),
    ("Galeries Lafayette Marseille Saint-Ferréol", DS, "FR", "Marseille", "40-48 Rue Saint-Ferréol, 13001 Marseille", 43.2930, 5.3780, 70, 30, "Low", 3.5, "BW PS",
     "Central Marseille store; prestige counters, limited niche.", "approximate"),
    ("Galeries Lafayette Lyon Part-Dieu", DS, "FR", "Lyon", "Centre commercial La Part-Dieu, 69003 Lyon", 45.7610, 4.8560, 70, 30, "Low", 3.5, "BW PS",
     "High-traffic mall department store; dependable prestige range.", "approximate"),

    # --------------------------------------------------------------- BELGIUM
    ("Senteurs d'Ailleurs", NB, "BE", "Brussels", "Place Stéphanie 1A, 1050 Ixelles", 50.8331, 4.3582, 93, 72, "High", 4.6, "ES FS GS IB LX",
     "Belgium's reference for niche perfumery; deep catalogue, elegant setting and staff who know every house.", "approximate"),
    ("Senteurs d'Ailleurs Knokke", NB, "BE", "Knokke-Heist", "Kustlaan, 8300 Knokke-Heist", 51.3500, 3.2880, 86, 65, "Med", 4.4, "ES LX FS",
     "Seaside outpost for an affluent clientele; refined, seasonal crowd.", "to_verify"),
    ("Place Vendôme", NB, "BE", "Wezembeek-Oppem", "Wezembeek-Oppem, 1970 (village centre)", 50.8467, 4.4920, 84, 76, "High", 4.6, "ES FS GS IB AP",
     "Out-of-town destination for collectors; reviewers praise generous sampling and personal follow-up.", "to_verify"),
    ("Liquides Confidentiels", NB, "BE", "Namur", "Namur city centre, 5000 Namur", 50.4649, 4.8650, 78, 85, "High", 4.7, "ES FS GS IB",
     "Small independent shop with a cult following in Wallonia; very open to undiscovered indie houses.", "to_verify"),
    ("Skins Cosmetics Antwerp", CS, "BE", "Antwerp", "Antwerp centre (Meir / Wilde Zee district), 2000 Antwerpen", 51.2180, 4.4050, 85, 75, "Med", 4.5, "ES FS IB DB",
     "Minimalist Skins concept with a tight niche edit; staff guide by olfactive family.", "to_verify"),
    ("Skins Cosmetics Ghent", CS, "BE", "Ghent", "Ghent centre, 9000 Gent", 51.0530, 3.7230, 83, 75, "Med", 4.5, "ES FS IB",
     "Calm, design-led boutique; appreciated for unhurried advice.", "to_verify"),
    ("Skins Cosmetics Brussels", CS, "BE", "Brussels", "Brussels (Louise / Sablon area), 1000 Bruxelles", 50.8380, 4.3570, 84, 75, "Med", 4.4, "ES FS IB",
     "Brussels outpost of the Dutch concept, focused on skincare plus a curated niche wall.", "to_verify"),
    ("Parfumerie De Smedt", NB, "BE", "Flanders", "Flanders (verify branch address)", 51.0000, 4.0000, 72, 70, "Med", 4.3, "ES FS",
     "Family-run perfumery with loyal local customers and personal service.", "to_verify"),
    ("Inno Rue Neuve", DS, "BE", "Brussels", "Rue Neuve 111, 1000 Bruxelles", 50.8530, 4.3560, 72, 35, "Low", 3.5, "BW PS TC",
     "Belgium's flagship department store; broad prestige perfumery with a few luxury corners.", "approximate"),
    ("Inno Meir", DS, "BE", "Antwerp", "Meir 78, 2000 Antwerpen", 51.2180, 4.4070, 70, 35, "Low", 3.5, "BW PS",
     "Busy high-street store on Antwerp's main shopping axis; mainstream-leaning.", "approximate"),
    ("Inno Louise", DS, "BE", "Brussels", "Avenue Louise / Chaussée d'Ixelles area, 1050 Ixelles", 50.8350, 4.3600, 72, 35, "Low", 3.6, "PS LX",
     "Upscale branch in the Louise district with luxury perfumery corners.", "to_verify"),
    ("Graanmarkt 13", CS, "BE", "Antwerp", "Graanmarkt 13, 2000 Antwerpen", 51.2165, 4.4080, 86, 62, "Med", 4.5, "IB LX ES",
     "Celebrated concept store-restaurant-apartment; beauty edit is small but very discerning.", "verified"),
    ("Hunting and Collecting", CS, "BE", "Brussels", "Rue des Chartreux 17, 1000 Bruxelles", 50.8487, 4.3470, 78, 65, "Med", 4.3, "IB",
     "Fashion-led concept store in Dansaert with occasional indie fragrance drops.", "approximate"),
    ("Smets Brussels", CS, "BE", "Brussels", "Chaussée de Louvain 650, 1030 Schaerbeek", 50.8550, 4.4000, 82, 50, "Med", 4.1, "LX IB",
     "Large luxury concept store; polished, gallery-like and brand-heavy.", "approximate"),
    ("Inno Liège", DS, "BE", "Liège", "Vinâve d'Île, 4000 Liège", 50.6420, 5.5710, 66, 35, "Low", 3.4, "BW PS",
     "Main Walloon department store; mainstream-prestige perfumery.", "approximate"),
    ("Inno Gent", DS, "BE", "Ghent", "Veldstraat, 9000 Gent", 51.0520, 3.7230, 66, 35, "Low", 3.4, "BW PS",
     "Busy Veldstraat store; good for prestige basics.", "approximate"),

    # ------------------------------------------------------------ NETHERLANDS
    ("Skins Cosmetics Amsterdam", CS, "NL", "Amsterdam", "Runstraat 9, 1016 GJ Amsterdam", 52.3693, 4.8857, 89, 80, "Med", 4.6, "ES FS IB DB GS",
     "Pioneer of niche in the Nine Streets; staff are known for spot-on recommendations and generous samples.", "verified"),
    ("Skins Cosmetics Rotterdam", CS, "NL", "Rotterdam", "Van Oldenbarneveltstraat, 3012 Rotterdam", 51.9190, 4.4740, 85, 78, "Med", 4.5, "ES FS IB",
     "Spacious modern store with an excellent fragrance wall; relaxed atmosphere.", "approximate"),
    ("Skins Cosmetics Utrecht", CS, "NL", "Utrecht", "Utrecht centre (Oudegracht area), 3511 Utrecht", 52.0910, 5.1200, 84, 78, "Med", 4.5, "ES FS IB",
     "Canal-side branch with friendly, well-trained staff.", "to_verify"),
    ("Skins Cosmetics The Hague", CS, "NL", "The Hague", "Hoogstraat / Noordeinde area, 2513 Den Haag", 52.0800, 4.3080, 85, 78, "Med", 4.5, "ES FS IB LX",
     "Upmarket clientele near the royal quarter; calm and service-driven.", "to_verify"),
    ("Skins Cosmetics Laren", CS, "NL", "Laren", "Laren village centre, 1251 Laren", 52.2570, 5.2270, 82, 76, "Med", 4.5, "ES FS LX",
     "Village boutique serving 't Gooi's wealthy shoppers; personal and attentive.", "to_verify"),
    ("Skins Cosmetics Den Bosch", CS, "NL", "'s-Hertogenbosch", "Den Bosch centre, 5211 's-Hertogenbosch", 51.6890, 5.3040, 82, 76, "Med", 4.5, "ES FS IB",
     "Southern branch with a loyal local base; helpful, not pushy.", "to_verify"),
    ("Perfume Lounge", NB, "NL", "Amsterdam", "Amsterdam centre (verify street)", 52.3600, 4.8900, 80, 84, "High", 4.6, "ES FS GS IB",
     "Cosy independent lounge where owners love introducing small houses.", "to_verify"),
    ("Babassu Amsterdam", NB, "NL", "Amsterdam", "Amsterdam (verify street)", 52.3580, 4.8800, 80, 80, "High", 4.5, "ES FS IB",
     "Boutique niche perfumery with a warm, advisory approach.", "to_verify"),
    ("Babassu The Hague", NB, "NL", "The Hague", "Den Haag centre (verify street)", 52.0790, 4.3100, 80, 80, "High", 4.5, "ES FS IB",
     "Elegant shop favoured by expats and diplomats; strong personal service.", "to_verify"),
    ("Babassu Wassenaar", NB, "NL", "Wassenaar", "Wassenaar village centre, 2242 Wassenaar", 52.1430, 4.4010, 79, 80, "High", 4.6, "ES FS LX",
     "Village boutique with high-end clientele and very personal follow-up.", "to_verify"),
    ("De Bijenkorf Amsterdam", DS, "NL", "Amsterdam", "Dam 1, 1012 JS Amsterdam", 52.3733, 4.8936, 88, 35, "Low", 4.0, "LX TC PS BW",
     "The Netherlands' premier department store; deep niche & luxury counters, very busy on Dam square.", "verified"),
    ("De Bijenkorf Rotterdam", DS, "NL", "Rotterdam", "Coolsingel 105, 3012 AG Rotterdam", 51.9200, 4.4770, 85, 35, "Low", 3.9, "LX PS",
     "Modernist landmark with a broad beauty floor; well-stocked niche corners.", "verified"),
    ("De Bijenkorf The Hague", DS, "NL", "The Hague", "Wagenstraat 32, 2512 AX Den Haag", 52.0767, 4.3122, 84, 35, "Low", 3.9, "LX PS",
     "Art Deco building; calmer than Amsterdam with good counter staff.", "verified"),
    ("De Bijenkorf Utrecht", DS, "NL", "Utrecht", "Stationsplein, 3511 Utrecht (Hoog Catharijne)", 52.0905, 5.1110, 82, 35, "Low", 3.8, "BW PS",
     "Modern store attached to the central station; convenient, busy.", "approximate"),
    ("De Bijenkorf Maastricht", DS, "NL", "Maastricht", "Achter het Vleeshuis 26, 6211 Maastricht", 50.8500, 5.6920, 80, 35, "Low", 3.9, "PS LX",
     "Elegant southern branch drawing Belgian and German shoppers.", "approximate"),
    ("X BANK", CS, "NL", "Amsterdam", "Spuistraat 172, 1012 VT Amsterdam", 52.3740, 4.8910, 80, 70, "Med", 4.2, "IB",
     "Dutch design concept store in the W Hotel; showcases local makers including fragrance.", "approximate"),
    ("De Bijenkorf Eindhoven", DS, "NL", "Eindhoven", "Piazza 1, 5611 AE Eindhoven", 51.4400, 5.4780, 78, 35, "Low", 3.8, "PS BW",
     "Southern branch in the Piazza centre; solid luxury counters.", "approximate"),

    # ------------------------------------------------------------ LUXEMBOURG
    ("Parfumerie Celeste", NB, "LU", "Luxembourg", "Luxembourg-Ville centre (verify street)", 49.6110, 6.1300, 78, 75, "High", 4.5, "ES FS IB",
     "Boutique niche address in the capital with personal, multilingual service.", "to_verify"),
    ("Place des Parfums", NB, "LU", "Luxembourg", "Luxembourg-Ville (verify street)", 49.6100, 6.1290, 76, 72, "Med", 4.4, "ES FS",
     "Selective perfumery serving the capital's international clientele.", "to_verify"),
    ("Smets Luxembourg", CS, "LU", "Luxembourg", "Luxembourg-Ville (verify street)", 49.6000, 6.1330, 82, 50, "Med", 4.1, "LX IB",
     "Luxury lifestyle concept store; fragrance edit sits alongside high-end fashion.", "to_verify"),
    ("Grand-Rue Luxury Perfumery Corner", CS, "LU", "Luxembourg", "Grand-Rue, 1660 Luxembourg", 49.6116, 6.1300, 72, 55, "Med", 4.0, "LX PS",
     "High-street luxury beauty along Luxembourg's main shopping street.", "to_verify"),

    # ---------------------------------------------------------------- GERMANY
    ("KaDeWe", DS, "DE", "Berlin", "Tauentzienstraße 21-24, 10789 Berlin", 52.5015, 13.3412, 93, 30, "Low", 4.1, "LX TC PS ES",
     "Continental Europe's most famous department store; huge niche perfume hall, busy but expert counters.", "verified"),
    ("Apropos The Concept Store Berlin", CS, "DE", "Berlin", "Berlin Mitte (verify street)", 52.5250, 13.4000, 84, 58, "Med", 4.3, "LX IB",
     "High-fashion concept store with a selective fragrance edit.", "to_verify"),
    ("Belle Rebelle", NB, "DE", "Berlin", "Berlin (verify street)", 52.5200, 13.4050, 80, 82, "High", 4.6, "ES FS GS IB",
     "Indie-minded niche boutique; reviewers highlight the enthusiastic, story-driven staff.", "to_verify"),
    ("The Corner Berlin", CS, "DE", "Berlin", "Französische Straße 40, 10117 Berlin", 52.5145, 13.3920, 85, 55, "Med", 4.2, "LX IB",
     "Luxury multi-brand store near Gendarmenmarkt; refined edit including niche fragrance.", "approximate"),
    ("Frau Tonis Parfum", NB, "DE", "Berlin", "Zimmerstraße 13, 10969 Berlin", 52.5074, 13.3922, 74, 20, "Low", 4.6, "MB FS ES AP",
     "Local perfume house near Checkpoint Charlie; personal consultations and a strong Berlin identity.", "approximate"),
    ("Harry Lehmann", NB, "DE", "Berlin", "Kantstraße 106, 10627 Berlin", 52.5059, 13.3051, 70, 15, "Low", 4.7, "MB FS ES",
     "Century-old family shop selling perfume by weight; nostalgic charm and very kind service.", "verified"),
    ("Aus Liebe zum Duft Berlin", NB, "DE", "Berlin", "Berlin (verify street)", 52.5000, 13.3200, 82, 78, "High", 4.5, "ES FS GS IB",
     "Large niche specialist with a vast catalogue and good sample culture.", "to_verify"),
    ("VOO Store", CS, "DE", "Berlin", "Oranienstraße 24, 10999 Berlin", 52.5010, 13.4190, 82, 65, "Med", 4.3, "IB",
     "Kreuzberg concept store in a courtyard; cool, curated, occasional niche fragrance.", "verified"),
    ("Ludwig Beck", DS, "DE", "Munich", "Marienplatz 11, 80331 München", 48.1370, 11.5770, 86, 40, "Low", 4.2, "ES LX IB",
     "'Kaufhaus der Sinne' with a respected niche perfumery floor; competent staff, central location.", "verified"),
    ("Oberpollinger", DS, "DE", "Munich", "Neuhauser Straße 18, 80331 München", 48.1391, 11.5664, 90, 30, "Low", 4.0, "LX PS TC",
     "KaDeWe Group's Munich flagship; luxurious beauty hall, polished but commercial.", "verified"),
    ("Apropos The Concept Store Munich", CS, "DE", "Munich", "Munich centre (verify street)", 48.1400, 11.5800, 84, 58, "Med", 4.3, "LX IB",
     "Luxury concept store with selective fragrance; affluent clientele.", "to_verify"),
    ("Harald Lubner", NB, "DE", "Hamburg", "Hamburg centre (verify street)", 53.5530, 9.9900, 86, 72, "High", 4.6, "ES FS GS IB",
     "Hamburg's niche institution; deep catalogue and long-standing, knowledgeable team.", "to_verify"),
    ("Apropos The Concept Store Hamburg", CS, "DE", "Hamburg", "Hamburg centre (verify street)", 53.5520, 9.9930, 84, 58, "Med", 4.3, "LX IB",
     "Hanseatic outpost of the concept chain; polished and fashion-forward.", "to_verify"),
    ("Alsterhaus", DS, "DE", "Hamburg", "Jungfernstieg 16-20, 20354 Hamburg", 53.5524, 9.9925, 88, 30, "Low", 4.0, "LX PS TC",
     "Hamburg's grand department store with an elegant beauty floor on the Alster.", "verified"),
    ("Parfümerie Schnitzler", NB, "DE", "Düsseldorf", "Düsseldorf (verify street)", 51.2250, 6.7800, 82, 70, "Med", 4.5, "ES FS IB",
     "Respected niche perfumery in fashion-capital Düsseldorf; attentive, expert service.", "to_verify"),
    ("Breuninger Düsseldorf", DS, "DE", "Düsseldorf", "Königsallee 2, 40212 Düsseldorf (Kö-Bogen)", 51.2263, 6.7788, 87, 32, "Low", 4.1, "LX PS",
     "Premium department store in the Libeskind-designed Kö-Bogen; strong luxury fragrance.", "verified"),
    ("Breuninger Stuttgart", DS, "DE", "Stuttgart", "Marktstraße 1-3, 70173 Stuttgart", 48.7758, 9.1786, 88, 32, "Low", 4.1, "LX PS ES",
     "Flagship of Germany's premium department-store chain; excellent niche counters.", "verified"),
    ("Apropos The Concept Store Cologne", CS, "DE", "Cologne", "Mittelstraße 12, 50672 Köln", 50.9370, 6.9430, 84, 58, "Med", 4.3, "LX IB",
     "Original Apropos store; luxurious and selective.", "approximate"),
    ("Essenza Nobile", NB, "DE", "Mannheim", "Mannheim (verify street)", 49.4875, 8.4660, 84, 80, "High", 4.6, "ES FS GS IB",
     "Major niche specialist with a vast catalogue; well known for samples and discovery sets.", "to_verify"),
    ("Frankfurt Niche Hub (Goethestraße)", NB, "DE", "Frankfurt", "Goethestraße, 60313 Frankfurt am Main", 50.1150, 8.6750, 80, 65, "Med", 4.2, "LX ES",
     "Frankfurt's luxury street concentrates high-end fragrance retail.", "to_verify"),
    ("Breuninger Nürnberg", DS, "DE", "Nuremberg", "Ludwigsplatz 1, 90403 Nürnberg", 49.4500, 11.0720, 82, 32, "Low", 4.0, "LX PS",
     "Franconian Breuninger with a well-kept luxury beauty floor.", "approximate"),
    ("Breuninger Leipzig", DS, "DE", "Leipzig", "Höfe am Brühl, 04109 Leipzig", 51.3440, 12.3760, 80, 32, "Low", 4.0, "LX PS",
     "Eastern Germany's premium department store address.", "approximate"),
    ("Breuninger Freiburg", DS, "DE", "Freiburg", "Kaiser-Joseph-Straße, 79098 Freiburg", 47.9950, 7.8500, 80, 32, "Low", 4.0, "LX PS",
     "Draws Swiss and French cross-border shoppers; friendly staff.", "approximate"),

    # ------------------------------------------------------------ SWITZERLAND
    ("Parfumerie Spitzenhaus", NB, "CH", "Zürich", "Zürich Altstadt (verify street)", 47.3720, 8.5420, 84, 72, "High", 4.5, "ES FS IB",
     "Old-town niche boutique with a loyal Zürich clientele.", "to_verify"),
    ("Osswald Parfumerie", NB, "CH", "Zürich", "Bahnhofstrasse, 8001 Zürich", 47.3700, 8.5390, 88, 55, "Med", 4.4, "LX ES FS",
     "Long-established luxury perfumery on Bahnhofstrasse; formal, expert service.", "approximate"),
    ("Globus Zürich Bahnhofstrasse", DS, "CH", "Zürich", "Schweizergasse 11, 8001 Zürich", 47.3754, 8.5384, 88, 30, "Low", 4.1, "LX PS",
     "Switzerland's premium department store; its beauty floor carries strong niche brands.", "verified"),
    ("Globus Genève", DS, "CH", "Geneva", "Rue du Rhône 48, 1204 Genève", 46.2030, 6.1475, 86, 30, "Low", 4.0, "LX TC PS",
     "Lakeside luxury retail; international clientele, refined beauty hall.", "verified"),
    ("Globus Basel", DS, "CH", "Basel", "Marktplatz 2, 4051 Basel", 47.5584, 7.5880, 84, 30, "Low", 4.0, "LX PS",
     "Historic Marktplatz store; reliable luxury fragrance.", "verified"),
    ("Globus Bern", DS, "CH", "Bern", "Spitalgasse 17-21, 3011 Bern", 46.9480, 7.4410, 82, 30, "Low", 3.9, "LX PS",
     "Arcade-lined old-town store; quieter, good service.", "approximate"),
    ("Bongénie Genève", DS, "CH", "Geneva", "Rue du Marché 34, 1204 Genève", 46.2033, 6.1478, 89, 34, "Low", 4.2, "LX ES",
     "Bongénie Grieder's flagship; elegant beauty floor with selective niche and attentive staff.", "approximate"),
    ("Bongénie Lausanne", DS, "CH", "Lausanne", "Rue du Pont, 1003 Lausanne", 46.5210, 6.6320, 85, 34, "Low", 4.1, "LX ES",
     "Upscale Lausanne department store with curated perfumery.", "approximate"),
    ("Haute Parfumerie Théodora", NB, "CH", "Geneva", "Geneva centre (verify street)", 46.2020, 6.1460, 88, 68, "Med", 4.6, "ES FS LX IB",
     "Exclusive haute-parfumerie salon; very personal, appointment-style service.", "to_verify"),
    ("Lianne Tio Luxury Parfums", NB, "CH", "Switzerland", "Switzerland (verify city & street)", 47.0500, 8.3100, 80, 75, "High", 4.5, "ES FS IB",
     "Independent luxury perfumery known for personal curation.", "to_verify"),
    ("Bongénie Grieder Zürich", DS, "CH", "Zürich", "Bahnhofstrasse 30, 8001 Zürich", 47.3700, 8.5395, 87, 34, "Low", 4.1, "LX ES",
     "Bahnhofstrasse luxury store; refined beauty floor with attentive service.", "approximate"),
    ("Globus Luzern", DS, "CH", "Lucerne", "Pilatusstrasse 4, 6003 Luzern", 47.0500, 8.3070, 80, 30, "Low", 3.9, "TC LX",
     "Central Lucerne store; frequent tourist traffic.", "approximate"),
    ("Globus Lausanne", DS, "CH", "Lausanne", "Rue Centrale 5, 1003 Lausanne", 46.5205, 6.6330, 82, 30, "Low", 4.0, "LX PS",
     "Downtown Lausanne store; reliable luxury fragrance.", "approximate"),
]

TYPE_CODES = {NB, CS, DS}
OPENNESS = {"High", "Med", "Low"}
CONFIDENCE = {"verified", "approximate", "to_verify"}
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
        (name, typ, cc, city, addr, lat, lng, tier, align, openness, cx, traits, sentiment, conf) = row
        key = (name, cc)
        if key in seen:
            errors.append(f"duplicate: {name}")
        seen.add(key)
        if typ not in TYPE_CODES:
            errors.append(f"{name}: bad type {typ}")
        if openness not in OPENNESS:
            errors.append(f"{name}: bad openness {openness}")
        if conf not in CONFIDENCE:
            errors.append(f"{name}: bad confidence {conf}")
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
            "address_confidence": conf,
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
