/* ———————————————————————————————————————————————————————————————
   Maison Atlas — internationalisation (FR par défaut · EN)
   The app is authored in English. This layer translates every rendered text node and
   user-facing attribute (title, placeholder, aria-label) to French, live, through a
   MutationObserver — tables, popups, sheets, dialogs, Sillage AI and print documents included.
   Originals are kept per node, so switching back to EN restores the source text exactly.
   Order of resolution: exact strings → anchored templates → phrase glossary.
   ——————————————————————————————————————————————————————————————— */
(function () {
  "use strict";
  const KEY = "atlas-lang-v1";
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  let lang = get() === "en" ? "en" : "fr";
  document.documentElement.lang = lang;

  // ———————————————————————————————— 1 · Exact strings
  const EXACT = {
    // Navigation & hero
    "Niche fragrance launch · BE · NL · DE · FR · LU · CH": "Lancement parfum de niche · BE · NL · DE · FR · LU · CH",
    "Map mode": "Mode carte",
    "Global Target Directory": "Annuaire des cibles",
    "every door, for prospecting": "toutes les portes, pour prospecter",
    "Ma Carte Partner": "Ma Carte Partenaires",
    "active accounts & wholesale": "comptes actifs & ventes en gros",
    "Display currency": "Devise d'affichage",
    "Euro · EU single market": "Euro · marché unique UE",
    "Swiss franc · Switzerland export": "Franc suisse · export Suisse",
    "Pound sterling · UK export": "Livre sterling · export Royaume-Uni",
    "Margin simulator": "Simulateur de marge",
    "Forecast": "Prévisions",
    "6-month turnover & cash-flow projection": "Projection CA & trésorerie à 6 mois",
    "Board": "Comité",
    "Board PDF": "PDF comité",
    "PDF": "PDF",
    "Export CSV": "Exporter CSV",
    "CSV": "CSV",
    "Export": "Exporter",
    "Download the rows currently shown, in table order": "Télécharger les lignes affichées, dans l'ordre du tableau",
    "Executive A4 PDF of the current view or selected city — choose “Save as PDF”": "PDF A4 de direction de la vue ou de la ville sélectionnée — choisir « Enregistrer en PDF »",
    "Global Target Directory · B2B pipeline": "Annuaire des cibles · pipeline B2B",
    "Four hundred doors across six markets, scored for fit and openness. Choose where your fragrance belongs, then reach out with intent.": "Quatre cents portes sur six marchés, notées pour l'affinité et l'ouverture. Choisissez où votre parfum a sa place, puis approchez avec intention.",
    "Ma Carte Partner · Wholesale": "Ma Carte Partenaires · Gros",
    "Only the doors that carry your fragrance: stock engaged, invoices issued, cash collected — and the cities where it moves.": "Uniquement les portes qui portent votre parfum : stock engagé, factures émises, encaissements — et les villes où il tourne.",
    "Platform modules": "Modules de la plateforme",
    "Revenue forecast": "Prévision de CA",
    "Market pulse": "Pouls du marché",
    "regional & seasonal shifts": "dynamiques régionales & saisonnières",
    "Integrations": "Intégrations",
    "Shopify B2B · Stripe webhooks": "Shopify B2B · webhooks Stripe",
    "Install app": "Installer l'app",
    "offline for trade shows": "hors ligne pour les salons",
    "Executive metrics": "Indicateurs de direction",
    "Partner network metrics": "Indicateurs du réseau partenaire",
    "Target stores": "Points de vente cibles",
    "Tier 1 quick wins": "Gains rapides niveau 1",
    "Active pipeline": "Pipeline actif",
    "Sampling": "Échantillonnage",
    "Weighted · year 1": "Pondéré · année 1",
    "Territories": "Territoires",
    "Partner doors": "Portes partenaires",
    "Stock engaged": "Stock engagé",
    "Revenue invoiced": "CA facturé",
    "Collected": "Encaissé",
    "Outstanding": "Encours",
    "accounts": "comptes",
    "sets out": "coffrets envoyés",

    // Refine panel
    "Refine": "Affiner",
    "All stores": "Tous les points de vente",
    "All": "Tous",
    "All doors": "Toutes les portes",
    "Search": "Recherche",
    "Name, city, street, network…": "Nom, ville, rue, réseau…",
    "Country": "Pays",
    "City": "Ville",
    "Type": "Type",
    "Pipeline status": "Statut pipeline",
    "Launch priority": "Priorité de lancement",
    "Market segment": "Segment de marché",
    "Market segment for a single-SKU indie launch": "Segment de marché pour un lancement indépendant mono-référence",
    "Min tier": "Niveau min.",
    "Min alignment": "Affinité min.",
    "Min export potential": "Potentiel export min.",
    "Export Potential Score: purchasing power, luxury-hub proximity, high-end clientele density": "Score de potentiel export : pouvoir d'achat, proximité d'un pôle luxe, densité de clientèle haut de gamme",
    "Single-SKU openness": "Ouverture mono-référence",
    "Source": "Source",
    "Curated": "Sélection éditoriale",
    "OSM": "OSM",
    "Focus": "Focus",
    "Quick wins": "Gains rapides",
    "Verified true indie niche (High single-SKU openness), fit ≥ 70, not yet won or declined": "Niche indépendante vérifiée (forte ouverture mono-référence), affinité ≥ 70, ni gagnée ni déclinée",
    "Partners & key accounts": "Partenaires & comptes clés",
    "Partner Active and Key Account only": "Partenaires actifs et comptes clés uniquement",
    "Sampling in flight": "Échantillons en cours",
    "Discovery set out or follow-up due": "Coffret envoyé ou relance due",
    "Only in view": "Vue courante uniquement",
    "Territorial exclusivity": "Exclusivité territoriale",
    "Show zones": "Afficher les zones",
    "Exclusion radius": "Rayon d'exclusion",
    "Zones turn on automatically when filtering partners or key accounts.": "Les zones s'activent automatiquement lors du filtrage des partenaires ou comptes clés.",
    "Export CRM JSON": "Exporter le CRM (JSON)",
    "Save as sources/crm.json, then run build_perfumeries.py to bake edits into the dataset": "Enregistrer sous sources/crm.json, puis lancer build_perfumeries.py pour intégrer les modifications",
    "Export ledger JSON": "Exporter le registre (JSON)",
    "Save as sources/wholesale.json, then run build_perfumeries.py": "Enregistrer sous sources/wholesale.json, puis lancer build_perfumeries.py",
    "Discard edits": "Annuler les modifications",
    "Forget pipeline and ledger edits stored in this browser": "Oublier les modifications pipeline et registre enregistrées dans ce navigateur",
    "Reset filters": "Réinitialiser les filtres",
    "Store map": "Carte des points de vente",
    "Top-performing cities and stores": "Villes et points de vente les plus performants",
    "Heatmap · revenue by city": "Carte de chaleur · CA par ville",
    "Top-performing doors": "Portes les plus performantes",

    // Pipeline
    "Pipeline": "Pipeline",
    "Sort by": "Trier par",
    "Tier score": "Score de niveau",
    "Brand fit": "Affinité marque",
    "Export potential": "Potentiel export",
    "Restock urgency": "Urgence de réassort",
    "Year-1 value": "Valeur année 1",
    "Units delivered": "Unités livrées",
    "Pipeline stage": "Étape du pipeline",
    "Name A–Z": "Nom A–Z",
    "View": "Vue",
    "Table": "Tableau",
    "List": "Liste",
    "Grid": "Grille",
    "Name": "Nom",
    "Address": "Adresse",
    "Tier": "Niveau",
    "Fit": "Affinité",
    "SKU": "Réf.",
    "CX": "Expérience",
    "Status": "Statut",
    "Priority": "Priorité",
    "Segment": "Segment",
    "Network": "Réseau",
    "Links": "Liens",
    "Revenue": "CA",
    "Units": "Unités",
    "units": "unités",
    "Stock": "Stock",
    "Territory": "Territoire",
    "Decision maker": "Décideur",
    "Prospection notes": "Notes de prospection",
    "Add a note…": "Ajouter une note…",
    "Add note…": "Ajouter une note…",
    "Show on map": "Afficher sur la carte",
    "Maps": "Plans",
    "Google Maps": "Google Maps",
    "Instagram": "Instagram",
    "IG": "IG",

    // Enumerations
    "Not Contacted": "Non contacté",
    "Discovery Set Sent": "Coffret découverte envoyé",
    "Follow-up Required": "Relance requise",
    "Meeting Booked": "Rendez-vous fixé",
    "Partner Active": "Partenaire actif",
    "Key Account": "Compte clé",
    "Declined": "Décliné",
    "Niche Boutique": "Boutique de niche",
    "Independent Concept Store": "Concept store indépendant",
    "Department Store": "Grand magasin",
    "Traditional Prestige Perfumery": "Parfumerie de prestige traditionnelle",
    "Selective Concept Store": "Concept store sélectif",
    "Indie Niche (to verify)": "Niche indépendante (à vérifier)",
    "Specialist Niche House": "Maison de niche spécialisée",
    "True Indie Niche Boutique": "Boutique de niche indépendante",
    "Tier 1 - Quick Win (Indie Niche)": "Niveau 1 - Gain rapide (niche indépendante)",
    "Tier 2 - Selective (Specialist / Concept)": "Niveau 2 - Sélectif (spécialiste / concept)",
    "Tier 3 - Long-term Dept Store": "Niveau 3 - Grand magasin, long terme",
    "High": "Élevée", "Med": "Moyenne", "Low": "Faible", "Very High": "Très élevée",
    "Founder": "Fondateur·rice", "Head Buyer": "Acheteur·se principal·e", "General Manager": "Directeur·rice général·e",
    "Belgium": "Belgique", "Switzerland": "Suisse", "Germany": "Allemagne", "France": "France", "Luxembourg": "Luxembourg", "Netherlands": "Pays-Bas",
    "Pushes sales": "Vente insistante", "Busy weekends": "Week-ends chargés", "Luxury service": "Service luxe", "Expert staff": "Personnel expert",
    "Curated indie brands": "Marques indépendantes choisies", "Allows free sniffing": "Essais libres", "Discovery bar / blotters": "Bar découverte / mouillettes",
    "Tourist crowds": "Affluence touristique", "Generous samples": "Échantillons généreux", "Gift wrapping": "Paquet cadeau", "Appointment-friendly": "Sur rendez-vous",
    "Samples with purchase": "Échantillons à l'achat", "Strict sampling": "Échantillonnage strict", "Open sampling": "Échantillonnage ouvert",
    "Specialist": "Spécialiste", "Traditional": "Traditionnelle", "Selective concept": "Concept sélectif", "True indie": "Indépendante authentique",
    "Indie (verify)": "Indépendante (à vérifier)", "Department": "Grand magasin",
    "Boutique / concept store": "Boutique / concept store", "Department store (2× depth)": "Grand magasin (profondeur ×2)",
    "High confidence": "Confiance élevée", "Low confidence": "Confiance faible",
    "Healthy": "Sain", "Low stock": "Stock bas", "Reorder now": "Réassort immédiat",
    "Paid": "Payée", "Pending": "En attente", "Overdue": "En retard",

    // Sheet · dossier
    "Store details": "Fiche point de vente",
    "Close": "Fermer",
    "Close (Esc)": "Fermer (Échap)",
    "Close popup": "Fermer la bulle",
    "Dossier": "Dossier",
    "Simulator": "Simulateur",
    "Select a boutique": "Sélectionnez une boutique",
    "Tap a marker or a pipeline entry to open its dossier.": "Touchez un repère ou une ligne du pipeline pour ouvrir son dossier.",
    "Store intelligence": "Intelligence point de vente",
    "Staff": "Équipe",
    "Footfall": "Fréquentation",
    "Atmosphere": "Atmosphère",
    "Watch out": "Vigilance",
    "Watch out.": "Vigilance.",
    "Pitch": "Pitch",
    "Pitch.": "Pitch.",
    "Pitch prep.": "Préparation du pitch.",
    "CRM notes": "Notes CRM",
    "Generate pitch": "Générer le pitch",
    "Generate pitch & sequence": "Générer pitch & séquence",
    "Contract": "Contrat",
    "Agreement": "Accord",
    "NDA / agreement": "NDA / accord",
    "Distribution / exclusivity agreement as a PDF": "Accord de distribution / d'exclusivité en PDF",
    "Store PDF": "PDF du point de vente",
    "Luxury A4 dossier for investors or the board — choose “Save as PDF”": "Dossier A4 premium pour investisseurs ou comité — choisir « Enregistrer en PDF »",
    "Stock & Invoicing": "Stock & facturation",
    "Stock & invoices": "Stock & factures",
    "Wholesale": "Gros",
    "Demo": "Démo",
    "Demo ledger": "Registre démo",
    "Add invoice": "Ajouter une facture",
    "Invoice date": "Date de facture",
    "Delivery date": "Date de livraison",
    "Due date": "Échéance",
    "Amount HT (€)": "Montant HT (€)",
    "Mark paid": "Marquer payée",
    "Mark unpaid": "Marquer impayée",
    "Cumulative revenue": "CA cumulé",
    "Last invoice": "Dernière facture",
    "Lead time 21 d": "Délai 21 j",
    "Cover": "Couverture",
    "Velocity": "Vélocité",
    "On hand ≈": "En stock ≈",
    "Inv.": "Fact.",
    "Due": "Échéance",
    "Protected account.": "Compte protégé.",
    "◎ Protected": "◎ Protégé",
    "Blocked · inside a partner zone": "Bloqué · dans une zone partenaire",
    "Clear territory": "Territoire libre",
    "Exclusivity zone": "Zone d'exclusivité",
    "Tier 1 quick win": "Gain rapide niveau 1",
    "✓ True indie": "✓ Indépendante authentique",
    "✓ micro-brand friendly": "✓ ouverte aux micro-marques",
    "Entry barrier for a single-SKU indie brand": "Barrière d'entrée pour une marque indépendante mono-référence",
    "Barrier": "Barrière",
    "Range": "Fourchette",
    "Luxury hub": "Pôle luxe",
    "Purchasing power": "Pouvoir d'achat",
    "Clientele density": "Densité de clientèle",
    "Export Potential Score": "Score de potentiel export",

    // Simulator
    "Maison / brand": "Maison / marque",
    "Your house": "Votre maison",
    "Fragrance": "Parfum",
    "Hero SKU name": "Nom de la référence phare",
    "Base MSRP · PVP TTC FR (€)": "PVP TTC de base · FR (€)",
    "Base price list: French retail price incl. VAT. Other markets are derived by the export tax engine": "Tarif de base : prix public français TTC. Les autres marchés sont dérivés par le moteur fiscal export",
    "COGS · coût de fab. (€)": "Coût de fabrication (€)",
    "Base VAT · TVA FR (%)": "TVA de base · FR (%)",
    "VAT included in the base MSRP": "TVA incluse dans le PVP de base",
    "Retailer coefficient": "Coefficient détaillant",
    "Retail price excl. VAT ÷ wholesale price": "Prix public HT ÷ prix de gros",
    "EU opening order (€)": "Commande d'ouverture UE (€)",
    "Minimum value of an EU opening order. CH / UK minimums are set by the export engine": "Valeur minimale d'une commande d'ouverture UE. Les minimums CH / UK sont fixés par le moteur export",
    "Case pack (units)": "Colisage (unités)",
    "Reorders in year 1": "Réassorts en année 1",
    "Replenishment orders per store over the first 12 months": "Commandes de réassort par point de vente sur les 12 premiers mois",
    "Unit economics": "Économie unitaire",
    "COGS": "Coût de fab.",
    "COGS + landed": "Coût de fab. + rendu",
    "Brand margin": "Marge marque",
    "Retailer margin": "Marge détaillant",
    "VAT": "TVA",
    "Recommended MOQ & shipping": "MOQ recommandé & expédition",
    "MOQ & shipping": "MOQ & expédition",
    "Price corridor by market": "Corridor de prix par marché",
    "Price corridor": "Corridor de prix",
    "Pipeline projection": "Projection du pipeline",
    "Retail price excl. VAT · PVP HT": "Prix public HT",
    "Brand gross margin per unit": "Marge brute marque par unité",
    "Wholesale price · prix de gros HT (÷ 2)": "Prix de gros HT (÷ 2)",
    "Weighted": "Pondéré",
    "Weighted revenue": "CA pondéré",
    "Weighted gross profit": "Marge brute pondérée",
    "Weighted units": "Unités pondérées",
    "Weighted pipeline": "Pipeline pondéré",
    "Full potential": "Potentiel total",
    "Expected partners": "Partenaires attendus",
    "Market": "Marché",
    "Shelf": "Prix public",
    "Shelf CH": "Prix public CH",
    "HT": "HT",
    "HT · opening": "HT · ouverture",
    "TTC · wholesale": "TTC · gros",
    "MOQ": "MOQ",
    "Opening": "Ouverture",
    "Duty & VAT": "Droits & TVA",
    "Free shipping.": "Livraison offerte.",
    "Intra-EU.": "Intra-UE.",
    "Cross-border export.": "Export transfrontalier.",
    "No customs: intra-EU supply, reverse-charge VAT for B2B across borders.": "Pas de douane : livraison intra-UE, autoliquidation de la TVA en B2B transfrontalier.",
    "Reprices live with € / CHF / £": "Recalculé en direct en € / CHF / £",
    "In EUR": "En EUR",
    "By market currency": "Par devise de marché",
    "EU single market": "Marché unique UE",
    "Switzerland · export": "Suisse · export",
    "United Kingdom · export": "Royaume-Uni · export",
    "Next non-EU market · UK": "Prochain marché hors UE · Royaume-Uni",
    "Scope": "Périmètre",
    "Current filters": "Filtres actifs",

    // Pitch dialog
    "Pitch generator": "Générateur de pitch",
    "Outreach mode": "Mode de prospection",
    "Email": "E-mail",
    "3-step sequence": "Séquence en 3 étapes",
    "Language": "Langue",
    "Subject": "Objet",
    "Message": "Message",
    "Copy email": "Copier l'e-mail",
    "Open in Mail": "Ouvrir dans Mail",
    "Mark set sent": "Coffret envoyé",
    "Set status to Discovery Set Sent": "Passer le statut à « Coffret découverte envoyé »",
    "Edit freely · placeholders in [brackets]": "Modifiable librement · champs à compléter entre [crochets]",
    "Schedule sequence": "Programmer la séquence",
    "Add to calendar (.ics)": "Ajouter au calendrier (.ics)",
    "Stop sequence": "Arrêter la séquence",
    "Due steps surface in Sillage AI and on store cards": "Les étapes dues apparaissent dans Sillage AI et sur les fiches",
    "Draft": "Brouillon",
    "Copy": "Copier",
    "Mark sent": "Marquer envoyé",
    "Due today": "À faire aujourd'hui",
    "Initial email · Email": "E-mail d'introduction · E-mail",
    "Value-add follow-up · local market · Email + LinkedIn": "Relance à valeur ajoutée · marché local · E-mail + LinkedIn",
    "Sample delivery confirmation · Email + phone": "Confirmation de livraison des échantillons · E-mail + téléphone",

    // Modules
    "Six-month forecast": "Prévision à six mois",
    "Six-month turnover forecast": "Prévision de CA à six mois",
    "Cash-flow & revenue engine": "Moteur trésorerie & CA",
    "Turnover": "CA",
    "Cash-in": "Encaissements",
    "From partners": "Des partenaires",
    "Committed (partners)": "Engagé (partenaires)",
    "Partner reorders": "Réassorts partenaires",
    "Month": "Mois",
    "Month by month": "Mois par mois",
    "Peak month": "Mois record",
    "Account": "Compte",
    "Run-rate / mo": "Rythme / mois",
    "Terms": "Conditions",
    "Download CSV": "Télécharger CSV",
    "Retail sell-in seasonality": "Saisonnalité du sell-in",
    "after payment terms": "après délais de paiement",
    "flat": "stable",
    "Rising now": "En hausse",
    "Cooling": "En repli",
    "Regional momentum": "Dynamique régionale",
    "avg pulse on winnable doors": "pouls moyen des portes accessibles",
    "Legal · agreement generator": "Juridique · générateur d'accords",
    "Supplier legal entity": "Entité juridique du fournisseur",
    "Supplier registered address": "Siège social du fournisseur",
    "Street, postcode, city, country": "Rue, code postal, ville, pays",
    "Supplier signatory": "Signataire du fournisseur",
    "Full name": "Nom complet",
    "Signatory title": "Fonction du signataire",
    "Effective date": "Date d'effet",
    "Term (months)": "Durée (mois)",
    "Payment terms (days net)": "Délai de paiement (jours nets)",
    "Exclusive radius (km)": "Rayon d'exclusivité (km)",
    "Governing law & venue": "Droit applicable & juridiction",
    "Generate PDF": "Générer le PDF",
    "Template for counsel review — not legal advice": "Modèle à faire valider par un avocat — ne constitue pas un conseil juridique",
    "Exclusive Territorial Distribution Agreement": "Contrat de distribution exclusive territoriale",
    "Selective Distribution Agreement": "Contrat de distribution sélective",
    "Mutual Non-Disclosure Agreement": "Accord de confidentialité réciproque",
    "Webhook & integration center": "Centre webhooks & intégrations",
    "Ready-to-deploy endpoints that keep the wholesale ledger in sync": "Points d'accès prêts à déployer pour synchroniser le registre de gros",
    "Endpoints": "Points d'accès",
    "Payloads": "Charges utiles",
    "Sync script": "Script de synchronisation",
    "Replay & pull": "Rejouer & récupérer",
    "Deployment base URL": "URL de base du déploiement",
    "Copy URL": "Copier l'URL",
    "Auth.": "Auth.",
    "Shopify B2B": "Shopify B2B",
    "Shopify B2B · Stripe": "Shopify B2B · Stripe",
    "Stripe checkout & invoicing": "Paiement & facturation Stripe",
    "Ledger feed for this app": "Flux du registre pour cette app",
    "wholesale.json schema": "schéma wholesale.json",
    "Signatures verified server-side · amounts booked in EUR · idempotent by order / invoice number": "Signatures vérifiées côté serveur · montants comptabilisés en EUR · idempotent par n° de commande / facture",
    "Link a company to Atlas: Company.externalId = crm_key, or order note attribute crm_key, or tag crm:<key>.": "Lier une société à Atlas : Company.externalId = crm_key, ou attribut de note de commande crm_key, ou tag crm:<key>.",
    "Link a payment to Atlas: metadata.crm_key on the Checkout Session or Invoice.": "Lier un paiement à Atlas : metadata.crm_key sur la Checkout Session ou la facture.",
    "“Pull ledger” merges it into the partner drawers (idempotent).": "« Récupérer le registre » le fusionne dans les fiches partenaires (idempotent).",
    "App & offline": "App & hors ligne",
    "Install Maison Atlas": "Installer Maison Atlas",
    "Maison Atlas, anywhere": "Maison Atlas, partout",
    "Home-screen app for iOS and Android · works without a network on the show floor": "App d'écran d'accueil iOS et Android · fonctionne sans réseau sur un salon",
    "Install": "Installer",
    "Add to Home screen": "Sur l'écran d'accueil",
    "Android: menu →": "Android : menu →",
    "Chrome / Edge: menu": "Chrome / Edge : menu",
    "(or the install icon in the address bar).": "(ou l'icône d'installation de la barre d'adresse).",
    "Trade-show kit": "Kit salon",
    "Prepare offline kit": "Préparer le kit hors ligne",
    "Offline shell": "Socle hors ligne",
    "Cached": "En cache",
    "Online": "En ligne",
    "Ready": "Prêt",
    "Browser": "Navigateur",
    "not installed yet": "pas encore installée",
    "app + data cached": "app + données en cache",
    "live FX & tiles": "change & tuiles en direct",
    "best-effort storage": "stockage non garanti",
    "Data stays on this device · nothing is uploaded": "Les données restent sur cet appareil · rien n'est envoyé",
    "Stored in this browser only": "Enregistré dans ce navigateur uniquement",

    // Sillage AI
    "Sillage AI": "Sillage AI",
    "Sillage AI assistant": "Assistant Sillage AI",
    "Retail intelligence · live on your pipeline": "Intelligence retail · en direct sur votre pipeline",
    "Message Sillage AI": "Écrire à Sillage AI",
    "Send": "Envoyer",
    "Clear conversation": "Effacer la conversation",
    "AI engine settings": "Réglages du moteur IA",
    "Engine": "Moteur",
    "Built-in analytics": "Analyses intégrées",
    "Built-in analytics · deterministic, runs offline": "Analyses intégrées · déterministes, hors ligne",
    "API key": "Clé API",
    "Model": "Modèle",
    "The key never leaves this browser except to the chosen provider. The quick analyses always run locally.": "La clé ne quitte ce navigateur que vers le fournisseur choisi. Les analyses rapides s'exécutent toujours localement.",
    "Top 5 Growth Cities for Single-SKU": "Top 5 des villes de croissance mono-référence",
    "Optimize 50 Discovery Set Dispatch List": "Optimiser l'envoi de 50 coffrets découverte",
    "Pipeline Stagnation & Follow-up Audit": "Audit stagnation & relances du pipeline",
    "Exclusivity Zone Conflict Check": "Contrôle des conflits d'exclusivité",
    "Swiss & Non-EU Export Strategy": "Stratégie export Suisse & hors UE",
    "Restock & Sell-Through Forecast": "Prévision réassort & sell-through",
    "Outreach Sequences Due Today": "Séquences de prospection du jour",
    "Export Potential Leaders": "Leaders du potentiel export",
    "Dynamic Market Pulse": "Pouls dynamique du marché",
    "Recommendation.": "Recommandation.",
    "Lead doors:": "Portes de tête :",
    "Active conflicts": "Conflits actifs",
    "Overlapping territories": "Territoires qui se chevauchent",
    "Stalled prospects": "Prospects en souffrance",
    "None.": "Aucun.",
    "None past SLA.": "Aucun hors délai.",
    "No prospect in play inside a partner territory.": "Aucun prospect actif dans un territoire partenaire.",
    "Highest raw potential:": "Plus fort potentiel brut :",
    "Pulse-adjusted top 5:": "Top 5 ajusté du pouls :",
    "Switzerland:": "Suisse :",
    "Ranked by": "Classement par",
    "single-SKU potential": "potentiel mono-référence",
    "potential × placement score": "potentiel × score de placement",
    "market pulse": "pouls du marché",
    "Prioritisation scores now carry a": "Les scores de priorité intègrent désormais un",
    "Where to open": "Où ouvrir",
    "Untouched quick wins": "Gains rapides inexploités",
    "Partners": "Partenaires",
    "Partner accounts": "Comptes partenaires",
    "Alerts": "Alertes",
    "Sell-through forecast": "Prévision de sell-through",
    "Check sell-through, offer a staff training or tester refresh to trigger reorder.": "Vérifier le sell-through, proposer une formation équipe ou un renouvellement des testeurs pour déclencher le réassort.",
    "Polite reminder + statement; hold next delivery until settled.": "Relance courtoise + relevé ; suspendre la prochaine livraison jusqu'au règlement.",
    "Overlaps < 2 km: define street-level boundaries in contracts, or downgrade one to non-exclusive.": "Chevauchements < 2 km : délimiter à la rue dans les contrats, ou repasser l'un en non exclusif.",
    "Current radius leaves Tier 1 coverage intact.": "Le rayon actuel préserve la couverture niveau 1.",
    "Tier 1 opportunities blocked": "Opportunités niveau 1 bloquées",
    "No other door is pitched within 2 km while exclusivity holds.": "Aucune autre porte n'est démarchée à moins de 2 km tant que l'exclusivité court.",
    "Bonjour.": "Bonjour.",
    "Ask about cities, doors, pipeline, territories…": "Interrogez villes, portes, pipeline, territoires…",


    // Market pulse notes (intelligence.js)
    "Strong franc and tourist spend keep Swiss luxury retail ahead": "Franc fort et dépenses touristiques soutiennent le luxe suisse",
    "Highest purchasing power in the EU, cross-border clientele": "Plus fort pouvoir d'achat de l'UE, clientèle transfrontalière",
    "Niche fragrance is the fastest-growing prestige category in the Netherlands": "La parfumerie de niche est la catégorie prestige la plus dynamique aux Pays-Bas",
    "Tourism lifts Paris and the Riviera; regional France flat": "Le tourisme porte Paris et la Riviera ; la France régionale stagne",
    "Tourism lifts Paris and the Riviera; regional France flat; Paris tourist flows +3": "Le tourisme porte Paris et la Riviera ; la France régionale stagne ; flux touristiques parisiens +3",
    "Stable demand, led by Antwerp and Brussels": "Demande stable, portée par Anvers et Bruxelles",
    "Soft consumer sentiment and department-store restructuring": "Moral des ménages fragile et restructuration des grands magasins",
    "Indie niche doors outgrow prestige perfumery": "Les portes niche indépendantes croissent plus vite que la parfumerie prestige",
    "Specialist niche houses gain share": "Les maisons de niche spécialisées gagnent des parts",
    "Concept stores keep widening their beauty edit": "Les concept stores élargissent leur offre beauté",
    "Traditional prestige loses share to niche": "La parfumerie prestige traditionnelle cède du terrain à la niche",
    "Footfall shifts from department stores to independents": "La fréquentation glisse des grands magasins vers les indépendants",
    "Luxury-hub tourist peak": "Pic touristique des pôles luxe",
    "Ski-resort season": "Saison des stations de ski",
    "Coastal & lake summer season": "Saison estivale côtes & lacs",
    "Reorder overdue": "Réassort en retard",
    "High cannibalization risk": "Risque de cannibalisation élevé",
    "Moderate overlap": "Chevauchement modéré",
    "Nov · Dec · Jan": "nov. · déc. · janv.",
    // Misc
    "Zoom in": "Zoom avant",
    "Zoom out": "Zoom arrière",
    "Layers": "Fonds de carte",
    "A JavaScript library for interactive maps": "Une bibliothèque JavaScript de cartes interactives",
    "Size = tier · halo = status": "Taille = niveau · halo = statut",
    "Size = revenue · glow = heatmap": "Taille = CA · lueur = chaleur",
    "Top performer (gold halo)": "Meilleure performance (halo or)",
    "Revenue heatmap": "Carte de chaleur du CA",
    "Heatmap": "Carte de chaleur",
    "Distribution overview": "Vue d'ensemble de la distribution",
    "Store dossier": "Dossier point de vente",
    "Year 1": "Année 1",
    "Not contacted": "Non contacté",
    "Map": "Carte",
    "A1 value": "Valeur A1",
    "Y1 value": "Valeur A1",
    "Avg score": "Score moy.",
    "Nothing overdue": "Aucun retard",
    "Data from": "Données de",
    "Export share (CH)": "Part export (CH)",
    "No deliveries logged yet": "Aucune livraison enregistrée",
    "No overdue invoices.": "Aucune facture en retard.",
    "No invoices yet": "Aucune facture pour l'instant",
    "No partner revenue yet": "Pas encore de CA partenaire",
    "No revenue yet": "Pas encore de CA",
    "No protected accounts yet — set a store to Partner Active or Key Account.": "Aucun compte protégé — passez un point de vente en Partenaire actif ou Compte clé.",
    "Set a store to Partner Active and log its first invoice.": "Passez un point de vente en Partenaire actif et enregistrez sa première facture.",
    "Partner territories are disjoint.": "Les territoires partenaires sont disjoints.",
    "Open Sillage AI": "Ouvrir Sillage AI",
    "Pitch the founder · export potential": "Pitcher le·la fondateur·rice · potentiel export",
    "Pitch the head buyer · export potential": "Pitcher l'acheteur·se principal·e · potentiel export",
    "Pitch the general manager · export potential": "Pitcher la direction générale · potentiel export",
    "Selective (Specialist / Concept)": "Sélectif (spécialiste / concept)",
    "Quick Win (Indie Niche)": "Gain rapide (niche indépendante)",
    "Long-term Dept Store": "Grand magasin, long terme",
    "The Hague": "La Haye", "Brussels": "Bruxelles", "Antwerp": "Anvers", "Ghent": "Gand", "Geneva": "Genève", "Cologne": "Cologne",
    "Map & data": "Carte & données",
    "Workspace": "Espace de travail",
    "Workspace layout": "Disposition de l'espace",
    "Full-screen map": "Carte plein écran",
    "Full-screen data": "Données plein écran",
    "Press F for full screen · Esc to exit": "F pour le plein écran · Échap pour quitter",
    "Data": "Données",
    "Mode": "Mode",
    "Open": "Libre",
    "Protected": "Protégé",
    "Yes": "Oui", "No": "Non",
  };

  // ———————————————————————————————— 2 · Anchored templates ({1}, {2}… capture anything)
  const TEMPLATES = [
    ["{1} doors in {2} markets ({3} in the current view) · avg fit {4} · {5} high-openness · {6} partners.", "{1} portes sur {2} marchés ({3} dans la vue) · affinité moy. {4} · {5} à forte ouverture · {6} partenaires."],
    ["I read {1} doors across {2} markets, {3} partner accounts and a {4} km exclusivity radius — live from this CRM, priced in {5}. Pick an analysis below or ask anything.", "J'analyse {1} portes sur {2} marchés, {3} comptes partenaires et un rayon d'exclusivité de {4} km — en direct depuis ce CRM, en {5}. Choisissez une analyse ci-dessous ou posez votre question."],
    ["Built-in mode answers the {1} analyses above, a store name or a city. Add an API key in ⚙︎ for open-ended strategy questions.", "Le mode intégré répond aux {1} analyses ci-dessus, à un nom de boutique ou à une ville. Ajoutez une clé API dans ⚙︎ pour des questions stratégiques ouvertes."],
    ["Open Sillage AI · {1} alerts", "Ouvrir Sillage AI · {1} alertes"],
    ["{1} of {2} stores", "{1} sur {2} points de vente"],
    ["{1}% engaged", "{1} % engagés"],
    ["{1} meetings · {2} partners · {3} declined", "{1} rendez-vous · {2} partenaires · {3} déclinés"],
    ["{1} follow-ups required", "{1} relances requises"],
    ["{1} key · {2} stores blocked at {3} km", "{1} clés · {2} points de vente bloqués à {3} km"],
    ["{1} Tier 1 indie niche in view", "{1} niches indépendantes niveau 1 dans la vue"],
    ["avg fit {1} · {2} open to single-SKU", "affinité moy. {1} · {2} ouvertes au mono-référence"],
    ["{1} potential · {2} wholesale", "{1} de potentiel · {2} en gros"],
    ["{1} key accounts · {2} cities", "{1} comptes clés · {2} villes"],
    ["{1} deliveries · {2} per door", "{1} livraisons · {2} par porte"],
    ["{1} invoices · avg {2}", "{1} factures · moy. {2}"],
    ["{1} % of invoiced revenue", "{1} % du CA facturé"],
    ["{1} overdue · {2}", "{1} en retard · {2}"],
    ["{1} overdue", "{1} en retard"],
    ["{1} · {2} units · {3} doors", "{1} · {2} unités · {3} portes"],
    ["Pipeline status of {1}", "Statut pipeline de {1}"],
    ["Mark {1} as Discovery Set Sent", "Marquer {1} : coffret découverte envoyé"],
    ["Distribution overview of {1} as an A4 PDF", "Vue d'ensemble de la distribution de {1} en PDF A4"],
    ["{1} overview PDF", "PDF de synthèse {1}"],
    ["Inside {1}'s {2} km zone", "Dans la zone de {2} km de {1}"],
    ["Inside {1}'s territory ({2} km).", "Dans le territoire de {1} ({2} km)."],
    ["no partner within {1} km", "aucun partenaire à moins de {1} km"],
    ["Partner since {1} · last invoice {2}", "Partenaire depuis le {1} · dernière facture le {2}"],
    ["Next reorder expected {1} · suggested", "Prochain réassort attendu le {1} · suggéré"],
    ["Reorder by {1}", "Réassort avant le {1}"],
    ["Planned {1}", "Prévu le {1}"],
    ["Scheduled {1}", "Programmé le {1}"],
    ["Sent {1}", "Envoyé le {1}"],
    ["Late {1} d", "En retard de {1} j"],
    ["Scheduled · {1}/3 sent", "Programmée · {1}/3 envoyés"],
    ["Day {1}", "Jour {1}"],
    ["Step {1} subject", "Objet de l'étape {1}"],
    ["Step {1} message", "Message de l'étape {1}"],
    ["Sequence start · Day 0", "Début de séquence · Jour 0"],
    ["Three calendar reminders (Day 0, 7, 14)", "Trois rappels calendrier (Jour 0, 7, 14)"],
    ["Log {1}-unit reorder", "Enregistrer un réassort de {1} unités"],
    ["Based on {1} orders", "Sur la base de {1} commandes"],
    ["Based on {1} order", "Sur la base de {1} commande"],
    ["Healthy · {1} u. on hand ≈ {2} d of cover · {3} u./month", "Sain · {1} u. en stock ≈ {2} j de couverture · {3} u./mois"],
    ["Low stock · {1} u. on hand ≈ {2} d of cover · {3} u./month", "Stock bas · {1} u. en stock ≈ {2} j de couverture · {3} u./mois"],
    ["Reorder now · {1} u. on hand ≈ {2} d of cover · {3} u./month", "Réassort immédiat · {1} u. en stock ≈ {2} j de couverture · {3} u./mois"],
    ["≈ {1} u. on hand · {2} d cover · {3} u./month{4} · cadence {5} d", "≈ {1} u. en stock · {2} j de couverture · {3} u./mois{4} · cadence {5} j"],
    ["≈ {1} u. on hand · {2} d cover · {3} u./month · cadence {4} d", "≈ {1} u. en stock · {2} j de couverture · {3} u./mois · cadence {4} j"],
    ["{1} u. on hand · {2} u./mo · reorder {3} u.", "{1} u. en stock · {2} u./mois · réassort {3} u."],
    ["{1} u. on hand · {2} u./mo", "{1} u. en stock · {2} u./mois"],
    ["Stock: {1} · ≈ {2} u. on hand · {3} d cover · {4} u./month{5}", "Stock : {1} · ≈ {2} u. en stock · {3} j de couverture · {4} u./mois{5}"],
    ["Wholesale: {1} units · {2} invoiced · {3} outstanding", "Gros : {1} unités · {2} facturés · {3} d'encours"],
    ["Close probability if sampled now ≈ {1} %.", "Probabilité de signature si échantillonné maintenant ≈ {1} %."],
    ["Export potential {1}/100 · {2} {3} km · {4} high-end doors ≤ 5 km", "Potentiel export {1}/100 · {2} {3} km · {4} portes haut de gamme ≤ 5 km"],
    ["Market pulse {1} (base {2}): {3}", "Pouls du marché {1} (base {2}) : {3}"],
    ["Export · {1} list: wholesale {2}, shelf {3} at {4} % VAT, MOQ {5} u.", "Export · tarif {1} : gros {2}, prix public {3} à {4} % de TVA, MOQ {5} u."],
    ["export {1} · fit {2} · {3} {4} km · {5} high-end doors ≤ 5 km{6}", "export {1} · affinité {2} · {3} {4} km · {5} portes haut de gamme ≤ 5 km{6}"],
    ["{1} high-end doors ≤ {2} km", "{1} portes haut de gamme ≤ {2} km"],
    ["≈ {1} / capita", "≈ {1} / habitant"],
    ["≈ {1} expected y1", "≈ {1} attendus a1"],
    ["{1} winnable doors", "{1} portes accessibles"],
    ["{1} winnable", "{1} accessibles"],
    ["{1} high-openness", "{1} à forte ouverture"],
    ["{1} partner in place", "{1} partenaire en place"],
    ["{1} need stock", "{1} à réapprovisionner"],
    ["{1} restock alerts", "{1} alertes de réassort"],
    ["{1} steps due", "{1} étapes dues"],
    ["{1} sequences running ·", "{1} séquences en cours ·"],
    ["Store culture: {1}", "Culture du point de vente : {1}"],
    ["Countries: {1}", "Pays : {1}"],
    ["Segments: {1}", "Segments : {1}"],
    ["Current filters · {1}", "Filtres actifs · {1}"],
    ["Stock · {1}", "Stock · {1}"],
    ["Invoices · {1}", "Factures · {1}"],
    ["Weighted: {1}", "Pondéré : {1}"],
    ["Key Account: {1}", "Compte clé : {1}"],
    ["Partner Active: {1}", "Partenaire actif : {1}"],
    ["Not Contacted: {1}", "Non contacté : {1}"],
    ["{1} months · EUR / CHF / GBP", "{1} mois · EUR / CHF / GBP"],
    ["{1}-month turnover & cash-flow projection", "Projection CA & trésorerie à {1} mois"],
    ["{1}-month turnover", "CA à {1} mois"],
    ["{1}-day pilot", "pilote de {1} jours"],
    ["{1}-day trend", "tendance {1} j"],
    ["{1}-mo · local", "{1} mois · local"],
    ["{1}-month", "{1} mois"],
    ["{1} d since last invoice", "{1} j depuis la dernière facture"],
    ["Lead time {1} d", "Délai {1} j"],
    ["Annual units / boutique ({1} + {2} reorders)", "Unités annuelles / boutique ({1} + {2} réassorts)"],
    ["Smallest multiple of the {1}-unit case reaching the {2} EU opening-order minimum.", "Plus petit multiple du colis de {1} unités atteignant le minimum d'ouverture UE de {2}."],
    ["Swiss minimum {1} → {2} units per boutique (EU: {3}).", "Minimum suisse {1} → {2} unités par boutique (UE : {3})."],
    ["Opening order {1} clears the {2} threshold.", "La commande d'ouverture de {1} dépasse le seuil de {2}."],
    ["Opening order {1} is under the {2} free-shipping line: push one more case or bill {3} freight.", "La commande d'ouverture de {1} est sous le seuil de livraison offerte de {2} : ajouter un colis ou facturer {3} de port."],
    ["{1} % duty (CH abolished industrial tariffs on {2}) · {3} % import VAT paid by the importer of record, recoverable · EUR.1 / origin statement on invoice.", "{1} % de droits (la Suisse a supprimé les droits sur les produits industriels le {2}) · {3} % de TVA à l'import payée par l'importateur, récupérable · EUR.1 / déclaration d'origine sur facture."],
    ["{1} % duty (CH abolished industrial tariffs on {2}) · {3} % import VAT paid by the importer of record, recoverable · EUR.1 / origin statement on invoice. Clearance ≈ {4} per shipment: consolidate reorders.", "{1} % de droits (la Suisse a supprimé les droits sur les produits industriels le {2}) · {3} % de TVA à l'import payée par l'importateur, récupérable · EUR.1 / déclaration d'origine sur facture. Dédouanement ≈ {4} par expédition : regrouper les réassorts."],
    ["{1} % duty under the EU–UK TCA with an origin statement · {2} % import VAT (postponed accounting) · UK Responsible Person required for cosmetics.", "{1} % de droits dans le cadre de l'ACC UE–Royaume-Uni avec déclaration d'origine · {2} % de TVA à l'import (autoliquidation différée) · Personne responsable UK obligatoire pour les cosmétiques."],
    ["No UK doors in the directory yet. GBP list would be wholesale {1}, shelf {2} ({3} % VAT), {4}-unit opening ≈ {5}. {6}", "Aucune porte britannique dans l'annuaire pour l'instant. Le tarif GBP serait : gros {1}, prix public {2} (TVA {3} %), ouverture de {4} unités ≈ {5}. {6}"],
    ["{1} % · reorder velocity", "{1} % · vélocité de réassort"],
    ["EUR list {1} → CHF {2} at {3} × {4} corridor. Brand margin per unit {5} vs {6} in the EU ({7}) after clearance. Swiss shelf {8} at {9} % VAT vs {10} in France at {11} % — keep the gap under ~{12} % in EUR terms or {13} clients buy in Annemasse.",
      "Tarif EUR {1} → CHF {2} à {3} × corridor {4}. Marge marque par unité {5} contre {6} dans l'UE ({7}) après dédouanement. Prix public suisse {8} à {9} % de TVA contre {10} en France à {11} % — garder l'écart sous ~{12} % en EUR, sinon la clientèle de {13} achète à Annemasse."],
    ["Amounts arriving in CHF or GBP are converted to EUR at the rates in force when the worker was exported, so the ledger stays single-currency like sources/wholesale.json. Shopify sends order totals tax-inclusive or exclusive per shop settings; Atlas books subtotal_price (HT for B{1}B catalogs).",
      "Les montants reçus en CHF ou GBP sont convertis en EUR aux taux en vigueur lors de l'export du worker, le registre reste donc mono-devise comme sources/wholesale.json. Shopify envoie des totaux TTC ou HT selon les réglages de la boutique ; Atlas comptabilise subtotal_price (HT pour les catalogues B{1}B)."],
    ["Partners: deseasonalised monthly run-rate from the last {1} months of invoices × local seasonality (Q{2} gifting build, ski-resort winters, coastal summers) × damped {3}-day reorder-velocity trend × regional purchasing shift. Pipeline: close probability × opening order landing {4} months out by stage (meeting, follow-up, discovery set), then reorders at {5}/year. Cash: turnover shifted by each account's median payment terms, plus receivables already invoiced (overdue at {6} %). Ledger amounts are EUR; local columns convert at ECB {7} rates.",
      "Partenaires : rythme mensuel désaisonnalisé des {1} derniers mois de factures × saisonnalité locale (montée des cadeaux du T{2}, hivers des stations, étés côtiers) × tendance amortie de vélocité de réassort sur {3} jours × évolution régionale du pouvoir d'achat. Pipeline : probabilité de signature × commande d'ouverture arrivant à {4} mois selon l'étape (rendez-vous, relance, coffret), puis réassorts à {5}/an. Trésorerie : CA décalé du délai de paiement médian de chaque compte, plus créances déjà facturées (retards à {6} %). Montants du registre en EUR ; colonnes locales converties aux taux BCE du {7}."],
    ["In zone of {1} ({2} km)", "Dans la zone de {1} ({2} km)"],
    ["Every partner invoiced within {1} days.", "Chaque partenaire facturé depuis moins de {1} jours."],
    ["No partner invoices in the last {1} months.", "Aucune facture partenaire sur les {1} derniers mois."],
    ["Reorder lapse > {1} d", "Réassort en retard > {1} j"],
    ["Tier 1, high openness, free territory, never contacted:", "Niveau 1, forte ouverture, territoire libre, jamais contacté :"],
    ["Wholesale price · prix de gros HT (÷ {1})", "Prix de gros HT (÷ {1})"],
    ["{1} shipments / door / year ≈ {2} clearance: consolidate reorders per city.", "{1} expéditions / porte / an ≈ {2} de dédouanement : regrouper les réassorts par ville."],
    ["● Brand margin {1} % ({2}× COGS): healthy for a niche single SKU.", "● Marge marque {1} % ({2}× coût) : saine pour une référence de niche."],
    ["● Brand margin {1} % ({2}× COGS): thin — raise the MSRP or lower COGS.", "● Marge marque {1} % ({2}× coût) : faible — relever le PVP ou réduire le coût."],
    ["Shelf price · PVP TTC (VAT {1} %)", "Prix public TTC (TVA {1} %)"],
    ["{1} · VAT {2} % · corridor +{3} %", "{1} · TVA {2} % · corridor +{3} %"],
    ["{1} · VAT {2} %", "{1} · TVA {2} %"],
    ["EU single market · VAT {1} %", "Marché unique UE · TVA {1} %"],
    ["Switzerland · export · VAT {1} %", "Suisse · export · TVA {1} %"],
    ["Weighted = Σ store value × close probability by status (Not contacted {1} %, Discovery set {2} %, Follow-up {3} %, Meeting {4} %, Partner / Key account {5} %). Store value = MOQ × (1 + reorders) × wholesale price of the store's own market (CH doors buy on the CHF list). Follows the filters.",
      "Pondéré = Σ valeur du point de vente × probabilité de signature par statut (non contacté {1} %, coffret {2} %, relance {3} %, rendez-vous {4} %, partenaire / compte clé {5} %). Valeur = MOQ × (1 + réassorts) × prix de gros du marché du point de vente (les portes suisses achètent sur le tarif CHF). Suit les filtres."],
    ["{1} € = {2} CHF · {3} £ (ECB {4})", "{1} € = {2} CHF · {3} £ (BCE {4})"],
    ["{1} € = {2} CHF · {3} £ — ECB reference rate of {4}. Ledger and inputs stay in EUR; figures are shown in {5}.", "{1} € = {2} CHF · {3} £ — taux de référence BCE du {4}. Registre et saisies restent en EUR ; chiffres affichés en {5}."],
    ["Pre-filled from the CRM: store identity and address, decision maker ({1}), the {2} price list, MOQ and exclusivity radius. Territorial clauses follow Regulation (EU) 2022/720 (VBER) and Art. 5 Swiss Cartel Act: active sales into the territory are restricted, passive and online sales are not; resale prices stay recommended only.",
      "Pré-rempli depuis le CRM : identité et adresse du point de vente, décideur ({1}), tarif {2}, MOQ et rayon d'exclusivité. Les clauses territoriales suivent le règlement (UE) 2022/720 (REC verticales) et l'art. 5 de la loi suisse sur les cartels : les ventes actives dans le territoire sont restreintes, pas les ventes passives ni en ligne ; les prix de revente restent conseillés."],
    ["between {1} and {2} · {3} months · {4}.", "entre {1} et {2} · {3} mois · {4}."],
    ["· wholesale {1} HT per unit · MOQ {2} units · net {3} days · {4} months · exclusive radius", "· gros {1} HT par unité · MOQ {2} unités · {3} jours nets · {4} mois · rayon d'exclusivité"],
    ["· wholesale {1} HT per unit · MOQ {2} units · net {3} days · {4} months.", "· gros {1} HT par unité · MOQ {2} unités · {3} jours nets · {4} mois."],
    ["around {1}.", "autour de {1}."],
    ["{1} existing partner inside (carved out)", "{1} partenaire existant inclus (exclu du périmètre)"],
    ["{1} existing partners inside (carved out)", "{1} partenaires existants inclus (exclus du périmètre)"],
    ["Offline ready · {1}", "Prêt hors ligne · {1}"],
    ["{1} MB of {2} MB", "{1} Mo sur {2} Mo"],
    ["{1} MB", "{1} Mo"],
    ["window {1} · {2}", "fenêtre {1} · {2}"],
    ["Caches the app, all {1} doors, map styles and fonts, then the map tiles for the area on screen (zoom levels up to {2} deeper, ≤ {3} tiles). CRM, ledger and sequence edits already live on this device and work without a network; export them once back online.",
      "Met en cache l'app, les {1} portes, les styles de carte et les polices, puis les tuiles de la zone affichée (jusqu'à {2} niveaux de zoom supplémentaires, ≤ {3} tuiles). Les modifications CRM, registre et séquences vivent déjà sur cet appareil et fonctionnent sans réseau ; exportez-les une fois reconnecté."],
    ["Model: each delivery is assumed to sell through before the next; velocity is an exponentially weighted mean (recent orders count most). Lead time {1} d, safety window {2} d.",
      "Modèle : chaque livraison est supposée écoulée avant la suivante ; la vélocité est une moyenne pondérée exponentielle (les commandes récentes comptent le plus). Délai {1} j, marge de sécurité {2} j."],
    ["Pipeline: {1} doors in active prospecting, {2} partners. SLA: discovery {3} d, follow-up {4} d, meeting {5} d since last status change.",
      "Pipeline : {1} portes en prospection active, {2} partenaires. Délais : coffret {3} j, relance {4} j, rendez-vous {5} j depuis le dernier changement de statut."],
    ["Radius {1} km around {2} protected accounts · {3} doors fall inside a territory.", "Rayon de {1} km autour de {2} comptes protégés · {3} portes se trouvent dans un territoire."],
    ["{1} discovery sets selected from {2} uncontacted doors outside protected territories. Capped at {3} per city, min. {4} km apart, low-openness doors only as filler. Sorted by country → city for one shipping run.",
      "{1} coffrets découverte sélectionnés parmi {2} portes non contactées hors territoires protégés. Plafond de {3} par ville, au moins {4} km d'écart, portes peu ouvertes en complément uniquement. Triés pays → ville pour une seule tournée d'expédition."],
    ["Nothing due. Start a sequence from any pitch: Day 0 intro, Day 7 value-add with local market stats, Day 14 sample delivery check.",
      "Rien à faire. Lancez une séquence depuis n'importe quel pitch : Jour 0 introduction, Jour 7 relance avec données du marché local, Jour 14 vérification de la livraison des échantillons."],
    ["Open {1} first with its top two doors as an exclusive pair, then roll into {2} once the first reorder lands — this keeps samples concentrated where word-of-mouth compounds.",
      "Ouvrir d'abord {1} avec ses deux meilleures portes en duo exclusif, puis déployer vers {2} dès le premier réassort — les échantillons restent concentrés là où le bouche-à-oreille s'amplifie."],
    ["Lead doors: {1}", "Portes de tête : {1}"],
    ["Export Potential Score = {1} % purchasing power · {2} % luxury-hub proximity · {3} % high-end clientele density. Below: winnable doors ranked by",
      "Score de potentiel export = {1} % pouvoir d'achat · {2} % proximité d'un pôle luxe · {3} % densité de clientèle haut de gamme. Ci-dessous : portes accessibles classées par"],
    ["Indices are editorial {1} estimates (see intelligence.js · REGION, SEASON, RESORTS); they reorder doors, they do not size markets.",
      "Indices éditoriaux estimés pour {1} (voir intelligence.js · REGION, SEASON, RESORTS) ; ils réordonnent les portes sans dimensionner les marchés."],
    ["of ±{1} points: regional purchasing shifts, segment momentum and the seasonal buying window ahead (", "de ±{1} points : évolutions régionales du pouvoir d'achat, dynamique des segments et fenêtre d'achat saisonnière à venir ("],
    ["). Retailers order {1} months before sell-out, so the window, not today, sets urgency.", "). Les détaillants commandent {1} mois avant la vente : c'est la fenêtre, pas aujourd'hui, qui fixe l'urgence."],
    ["{1} partner doors sell through ≈", "{1} portes partenaires écoulent ≈"],
    ["{1} units / month", "{1} unités / mois"],
    ["— {1} of reorders to propose now.", "— {1} de réassorts à proposer maintenant."],
    ["→ Reorder by {1}: propose", "→ Réassort avant le {1} : proposer"],
    [", lowest cover on {1} ({2} d).", ", couverture la plus faible sur {1} ({2} j)."],
    [", {1} winnable, {2} partners · ≈ {3} expected year 1 (shown in {4}).", ", {1} accessibles, {2} partenaires · ≈ {3} attendus en année 1 (affichés en {4})."],
    [": {1} doors · {2} partners · {3} high-openness.", " : {1} portes · {2} partenaires · {3} à forte ouverture."],
    [": Σ placement score × openness over doors still winnable (not partner, not declined, outside exclusivity zones). Cities already holding a partner are discounted {1} %; Swiss cities by their customs friction. Values in {2}.",
      " : Σ score de placement × ouverture sur les portes encore accessibles (ni partenaires, ni déclinées, hors zones d'exclusivité). Les villes ayant déjà un partenaire sont décotées de {1} % ; les villes suisses selon leur friction douanière. Valeurs en {2}."],
    ["A {1} km radius in dense cities would release {2} Tier 1 doors — consider city-specific radii.", "Un rayon de {1} km dans les villes denses libérerait {2} portes niveau 1 — envisager des rayons par ville."],
    ["Resolve the active conflicts before the next dispatch. {1}", "Résoudre les conflits actifs avant le prochain envoi. {1}"],
    ["Sign one Swiss importer of record (DAP, CHF invoicing) and open {1} first; pitch in {2}. Ship each city's opening orders together so one clearance fee covers several doors, and re-check the CHF corridor whenever EUR/CHF moves more than {3} %.",
      "Signer un importateur suisse officiel (DAP, facturation en CHF) et ouvrir d'abord {1} ; pitcher en {2}. Expédier ensemble les commandes d'ouverture d'une même ville pour qu'un seul dédouanement couvre plusieurs portes, et revoir le corridor CHF dès que l'EUR/CHF varie de plus de {3} %."],
    ["Nov {1} – Apr {2} · {3} partner accounts · figures in {4}", "nov. {1} – avr. {2} · {3} comptes partenaires · chiffres en {4}"],
    ["{1} · partners {2} · pipeline {3} · cash {4}", "{1} · partenaires {2} · pipeline {3} · trésorerie {4}"],
    ["{1} · {2} doors", "{1} · {2} portes"],
    ["{1} doors · {2} u.", "{1} portes · {2} u."],
    ["{1} door · {2} u.", "{1} porte · {2} u."],
    ["{1} doors", "{1} portes"],
    ["{1} stores", "{1} points de vente"],
    ["{1} units · {2}", "{1} unités · {2}"],
    ["{1} units", "{1} unités"],
    ["{1} km", "{1} km"],
    ["Tier {1}", "Niveau {1}"],
    ["tier {1}", "niveau {1}"],
    ["fit {1}", "affinité {1}"],
    ["avg fit {1}", "affinité moy. {1}"],
    ["CX {1}", "Expérience {1}"],
    ["entry {1}", "entrée {1}"],
    ["Yr-{1}", "A{1}"],
    ["Yr-{1} value", "Valeur A{1}"],
    ["Expected y{1}", "Attendu a{1}"],
    ["Reorders in year {1}", "Réassorts en année {1}"],
    ["(Network pattern ({1}) — confirm for this branch)", "(Profil du réseau {1} — à confirmer pour ce magasin)"],
    ["Network pattern ({1}) — confirm for this branch", "Profil du réseau {1} — à confirmer pour ce magasin"],
    ["{1} law · the District Court of {2}", "Droit {1} · Tribunal d'arrondissement de {2}"],
  ];

  // ———————————————————————————————— 3 · Phrase glossary (applied to whatever is left)
  const PHRASES = [
    ["Derived from store profile & location — verify on visit", "Déduit du profil et de l'emplacement — à vérifier sur place"],
    ["Store-level synthesis of public reviews", "Synthèse des avis publics du point de vente"],
    ["Not Contacted", "Non contacté"], ["Discovery Set Sent", "Coffret découverte envoyé"], ["Follow-up Required", "Relance requise"],
    ["Meeting Booked", "Rendez-vous fixé"], ["Partner Active", "Partenaire actif"], ["Key Account", "Compte clé"],
    ["Independent Concept Store", "Concept store indépendant"], ["Niche Boutique", "Boutique de niche"], ["Department Store", "Grand magasin"],
    ["Traditional Prestige Perfumery", "Parfumerie de prestige traditionnelle"], ["Selective Concept Store", "Concept store sélectif"],
    ["Indie Niche (to verify)", "Niche indépendante (à vérifier)"], ["Specialist Niche House", "Maison de niche spécialisée"],
    ["True Indie Niche Boutique", "Boutique de niche indépendante"], ["Independent perfumery", "Parfumerie indépendante"],
    ["Quick Win (Indie Niche)", "Gain rapide (niche indépendante)"], ["Selective (Specialist / Concept)", "Sélectif (spécialiste / concept)"],
    ["Long-term Dept Store", "Grand magasin, long terme"],
    ["Ski-resort season: buying window opening", "Saison des stations de ski : ouverture de la fenêtre d'achat"],
    ["Ski-resort season: buying window closing", "Saison des stations de ski : fermeture de la fenêtre d'achat"],
    ["Coastal & lake summer season: buying window opening", "Saison estivale côtes & lacs : ouverture de la fenêtre d'achat"],
    ["Coastal & lake summer season: buying window closing", "Saison estivale côtes & lacs : fermeture de la fenêtre d'achat"],
    ["Retail calendar: buying window closing", "Calendrier retail : fermeture de la fenêtre d'achat"],
    ["next-90-day index", "indice 90 jours"],
    ["Retail calendar: buying window opening", "Calendrier retail : ouverture de la fenêtre d'achat"],
    ["Retail calendar", "Calendrier retail"], ["buying window", "fenêtre d'achat"],
    ["Specialist niche houses gain share", "Les maisons de niche spécialisées gagnent des parts"],
    ["Highest purchasing power in the EU, cross-border clientele", "Plus fort pouvoir d'achat de l'UE, clientèle transfrontalière"],
    ["Soft consumer sentiment and department-store restructuring", "Moral des ménages fragile et restructuration des grands magasins"],
    ["Footfall shifts from department stores to independents", "La fréquentation glisse des grands magasins vers les indépendants"],
    ["Strong franc and tourist spend keep Swiss luxury retail ahead", "Franc fort et dépenses touristiques soutiennent le luxe suisse"],
    ["Niche fragrance is the fastest-growing prestige category in the Netherlands", "La parfumerie de niche est la catégorie prestige la plus dynamique aux Pays-Bas"],
    ["Tourism lifts", "Le tourisme porte"], ["and the Riviera; regional France flat", "et la Riviera ; la France régionale stagne"],
    ["Stable demand, led by", "Demande stable, portée par"],
    ["Allows free sniffing", "Essais libres"], ["Expert staff", "Personnel expert"], ["Curated indie brands", "Marques indépendantes choisies"],
    ["Luxury service", "Service luxe"], ["Pushes sales", "Vente insistante"], ["Busy weekends", "Week-ends chargés"],
    ["Generous samples", "Échantillons généreux"], ["Discovery bar / blotters", "Bar découverte / mouillettes"], ["Tourist crowds", "Affluence touristique"],
    ["Gift wrapping", "Paquet cadeau"], ["Appointment-friendly", "Sur rendez-vous"],
    ["high-end doors", "portes haut de gamme"], ["high-openness", "à forte ouverture"], ["single-SKU", "mono-référence"],
    ["partner doors", "portes partenaires"], ["winnable doors", "portes accessibles"], ["doors", "portes"], ["door", "porte"],
    ["partners", "partenaires"], ["partner", "partenaire"], ["markets", "marchés"],
    ["Switzerland", "Suisse"], ["Belgium", "Belgique"], ["Germany", "Allemagne"], ["Netherlands", "Pays-Bas"],
    ["Export potential", "Potentiel export"], ["Market pulse", "Pouls du marché"], ["neutral", "neutre"],
    ["SKU High", "Réf. élevée"], ["SKU Med", "Réf. moyenne"], ["SKU Low", "Réf. faible"],
    ["Barrier Very High", "Barrière très élevée"], ["Barrier High", "Barrière élevée"], ["Barrier Med", "Barrière moyenne"], ["Barrier Low", "Barrière faible"],
    ["entry Very High", "entrée très élevée"], ["entry High", "entrée élevée"], ["entry Med", "entrée moyenne"], ["entry Low", "entrée faible"],
    ["fit", "affinité"], ["tier", "niveau"], ["Tier", "Niveau"],
    ["expected", "attendus"], ["units", "unités"], ["months", "mois"], ["month", "mois"],
    ["invoiced", "facturés"], ["outstanding", "d'encours"], ["overdue", "en retard"],
    ["free shipping", "livraison offerte"], ["opening", "ouverture"], ["suggested", "suggéré"], ["wholesale", "gros"],
    ["season", "saison"], ["Recommendation", "Recommandation"],
  ];
  const MONTHS_EN = { Jan: "janv.", Feb: "févr.", Mar: "mars", Apr: "avr.", May: "mai", Jun: "juin", Jul: "juil.", Aug: "août", Sep: "sept.", Oct: "oct.", Nov: "nov.", Dec: "déc." };

  // ———————————————————————————————— Engine
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const compiled = TEMPLATES.map(([en, fr]) => {
    const order = [];
    const src = reEsc(en).replace(/\\\{(\d)\\\}/g, (_, d) => { order.push(+d); return "([\\s\\S]+?)"; });
    return { re: new RegExp("^" + src + "$"), fr, order, lit: en.replace(/\{\d\}/g, "").length };
  }).sort((a, b) => b.lit - a.lit);   // most specific template wins
  const phraseRe = PHRASES.map(([en, fr]) => [new RegExp((/^\w/.test(en) ? "\\b" : "") + reEsc(en) + (/\w$/.test(en) ? "\\b" : ""), "g"), fr]);
  const monthRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( \d{2,4})\b/g;
  const cache = new Map();

  function core(t, depth) {
    if (EXACT[t] != null) return EXACT[t];
    for (const c of compiled) {
      const m = c.re.exec(t);
      if (m) {
        const vals = {};
        c.order.forEach((d, i) => { vals[d] = m[i + 1]; });
        return c.fr.replace(/\{(\d)\}/g, (_, d) => depth < 2 ? core(vals[d], depth + 1) : vals[d]);
      }
    }
    let out = t.replace(monthRe, (_, mo, y) => MONTHS_EN[mo] + y);
    // Composite strings joined with " · " translate part by part
    if (out.includes(" · ") && depth < 2) {
      const parts = out.split(" · ");
      if (parts.length > 1) return parts.map(p => core(p, depth + 1)).join(" · ");
    }
    // Glossary only on UI-shaped fragments: long English prose (store reviews) stays as sourced
    if (out.length <= 64 || /[·:≈]|\d/.test(out) && out.length <= 160) for (const [re, fr] of phraseRe) out = out.replace(re, fr);
    return out;
  }
  function tr(s) {
    if (lang === "en" || !s || !/[A-Za-z]/.test(s)) return s;
    let r = cache.get(s);
    if (r === undefined) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
      r = m[2] ? m[1] + core(m[2], 0) + m[3] : s;
      cache.set(s, r);
    }
    return r;
  }

  // ———————————————————————————————— DOM binding
  const SKIP = "script,style,textarea,pre,code,svg,[data-i18n-skip],.sl-msg.user,.mx-mono,.leaflet-control-attribution,.maplibregl-ctrl-attrib";
  const ATTRS = ["title", "placeholder", "aria-label"];
  const textOrig = new WeakMap();   // Text node → { src, out }
  const attrOrig = new WeakMap();   // Element → { attr: { src, out } }
  let busy = false;

  function doText(n) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const v = n.nodeValue;
    let rec = textOrig.get(n);
    if (!rec || (v !== rec.out && v !== rec.src)) { rec = { src: v, out: v }; textOrig.set(n, rec); }
    else if (v === rec.src && v !== rec.out && lang === "fr") { /* app re-set the source text */ }
    const want = lang === "fr" ? tr(rec.src) : rec.src;
    rec.out = want;
    if (v !== want) n.nodeValue = want;
  }
  function doAttrs(el) {
    if (el.closest(SKIP) && !el.matches("textarea")) return;
    let rec = attrOrig.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      if (!rec) { rec = {}; attrOrig.set(el, rec); }
      let r = rec[a];
      if (!r || (v !== r.out && v !== r.src)) r = rec[a] = { src: v, out: v };
      const want = lang === "fr" ? tr(r.src) : r.src;
      r.out = want;
      if (v !== want) el.setAttribute(a, want);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (root.matches(SKIP) && !root.matches("textarea")) return; doAttrs(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === 1 && n.matches(SKIP) && !n.matches("textarea") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n;
    while ((n = w.nextNode())) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }
  const mo = new MutationObserver(list => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    } finally { mo.takeRecords(); busy = false; }
  });
  function start() {
    busy = true; walk(document.body); busy = false;
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    mountToggle();
  }

  // Translate an HTML string (print documents)
  function html(str) {
    if (lang === "en") return str;
    const t = document.createElement("template");
    t.innerHTML = str;
    const w = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (!n.parentElement?.closest("pre,code,[data-i18n-skip]")) n.nodeValue = tr(n.nodeValue);
    return t.innerHTML;
  }

  function setLang(l) {
    if (l === lang || !/^(fr|en)$/.test(l)) return;
    lang = l;
    try { localStorage.setItem(KEY, l); } catch (e) { /* private mode */ }
    document.documentElement.lang = l;
    busy = true; walk(document.body); mo.takeRecords(); busy = false;
    document.querySelectorAll(".lang-tg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.uiLang === l));
    document.dispatchEvent(new CustomEvent("atlas:lang", { detail: l }));
  }

  function mountToggle() {
    const host = document.querySelector(".nav-actions");
    if (!host || host.querySelector(".lang-tg")) return;
    const g = document.createElement("div");
    g.className = "lang-tg";
    g.setAttribute("role", "group");
    g.setAttribute("data-i18n-skip", "");
    g.setAttribute("aria-label", "Langue · Language");
    g.innerHTML = `<button type="button" data-ui-lang="fr" aria-pressed="${lang === "fr"}" title="Français">FR</button><span aria-hidden="true">|</span><button type="button" data-ui-lang="en" aria-pressed="${lang === "en"}" title="English">EN</button>`;
    g.addEventListener("click", e => { const b = e.target.closest("[data-ui-lang]"); if (b) setLang(b.dataset.uiLang); });
    host.prepend(g);
  }

  window.I18N = { get lang() { return lang; }, t: tr, html, setLang, fr: () => lang === "fr" };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
