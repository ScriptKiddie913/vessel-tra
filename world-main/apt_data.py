"""
APT Groups — Comprehensive database derived from:
- APTmap (Andrea Cristaldi / andreacristaldi/APTmap)
- MITRE ATT&CK Enterprise Groups
- Mandiant / CrowdStrike naming
Each entry has lat/lon for the group's attributed origin country/city.
"""

APT_GROUPS_FULL = [
    # ── CHINA (PLA / MSS / MPS) ────────────────────────────────────────
    {"id": "APT1",  "name": "APT1 / Comment Crew",  "aliases": "Comment Panda, PLA Unit 61398",
     "actor": "China (PLA Unit 61398)", "lat": 31.23, "lon": 121.47,  # Shanghai
     "target": "English-speaking enterprises, aerospace, defence, IT",
     "ttps": "Spear phishing, RATs, BISCUIT, WEBC2 malware family",
     "active": "2006–2013 (disrupted post-Mandiant report)", "severity": "high",
     "description": "PLA Unit 61398 — stole hundreds of terabytes from 141+ organisations"},
    {"id": "APT2",  "name": "APT2 / Putter Panda",  "aliases": "PLA Unit 61486, SVCMONDR",
     "actor": "China (PLA Unit 61486)", "lat": 31.22, "lon": 121.45,
     "target": "US defence contractors, satellite/aerospace",
     "ttps": "PNGDOWNER, HTTPCLIENT, spear phishing",
     "active": "2007–present", "severity": "high",
     "description": "PLA Unit 61486 — focused on satellite and aerospace espionage"},
    {"id": "APT3",  "name": "APT3 / Gothic Panda",  "aliases": "UPS, TG-0110, Buckeye",
     "actor": "China (MSS Guangdong)", "lat": 23.13, "lon": 113.26,  # Guangzhou → Guangdong province
     "target": "Aerospace, defence, construction, engineering, technology",
     "ttps": "Zero-day exploits (IE/Flash), PLUGX, SHOTPUT, CVE-2015-5119",
     "active": "2010–2017", "severity": "critical",
     "description": "MSS-linked; used NSA tools weeks after Shadow Brokers leak"},
    {"id": "APT10", "name": "APT10 / Stone Panda", "aliases": "MenuPass, Potassium, BRONZE RIVERSIDE",
     "actor": "China (MSS Tianjin)", "lat": 39.09, "lon": 117.2,  # Tianjin
     "target": "MSPs, healthcare, government (Operation Cloud Hopper)",
     "ttps": "QUASARRAT, REDLEAVES, PlugX, supply-chain via MSPs",
     "active": "2009–present", "severity": "critical",
     "description": "Operation Cloud Hopper — compromised 45+ MSPs globally"},
    {"id": "APT40", "name": "APT40 / BRONZE MOHAWK", "aliases": "TEMP.Periscope, Leviathan, TAG-22",
     "actor": "China (MSS Hainan)", "lat": 20.04, "lon": 110.33,  # Hainan Island
     "target": "Maritime, defence, aviation, universities — Indo-Pacific focus",
     "ttps": "Spear phishing, AIRBREAK, BADFLICK, DeepDiver",
     "active": "2013–present", "severity": "critical",
     "description": "MSS Hainan — indicted by US DOJ 2021; AUKUS-region focus"},
    {"id": "APT41", "name": "APT41 / Double Dragon", "aliases": "Winnti, BARIUM, Wicked Panda",
     "actor": "China (MSS + criminal)", "lat": 39.91, "lon": 116.39,  # Beijing
     "target": "Healthcare, telecoms, gaming, financial, supply chain",
     "ttps": "PlugX, ShadowPad, Winnti, software supply-chain attacks",
     "active": "2012–present", "severity": "critical",
     "description": "Dual-purpose: state espionage + for-profit ransomware/IP theft"},
    {"id": "APT27", "name": "APT27 / Emissary Panda", "aliases": "LuckyMouse, BRONZE UNION, Iron Tiger",
     "actor": "China (PLA / MSS)", "lat": 39.91, "lon": 116.39,
     "target": "Government, defence, aerospace, energy, financial globally",
     "ttps": "HyperBro, PlugX, HYPERBRO, watering hole attacks",
     "active": "2010–present", "severity": "critical",
     "description": "Long-running espionage; responsible for multiple OWA server attacks"},
    {"id": "APT31", "name": "APT31 / Zirconium", "aliases": "JUDGMENT PANDA, Hurricane Panda",
     "actor": "China (MSS)", "lat": 39.91, "lon": 116.39,
     "target": "Government, elections, political dissidents, media",
     "ttps": "ZIRCONIUM malware, spear phishing, SOGU",
     "active": "2016–present", "severity": "high",
     "description": "Targeted 2020 US presidential campaign; French election interference"},
    {"id": "APT32", "name": "APT32 / OceanLotus", "aliases": "SeaLotus, BISMUTH, Canvas Cyclone",
     "actor": "Vietnam (MPS)", "lat": 21.03, "lon": 105.85,  # Hanoi
     "target": "Foreign businesses/govts in SE Asia, journalists, dissidents",
     "ttps": "Cobalt Strike, WINDSHIELD, PHOREAL, MacOS malware",
     "active": "2013–present", "severity": "high",
     "description": "Vietnam state; targeted human rights orgs and regional businesses"},

    # ── RUSSIA (GRU / FSB / SVR) ────────────────────────────────────────
    {"id": "APT28", "name": "APT28 / Fancy Bear", "aliases": "Sofacy, STRONTIUM, Pawn Storm, GRU Unit 26165",
     "actor": "Russia (GRU Unit 26165)", "lat": 55.75, "lon": 37.62,  # Moscow
     "target": "NATO governments, military, political parties, election infrastructure",
     "ttps": "X-Agent, Sofacy, CHOPSTICK, GAMEFISH, credential phishing",
     "active": "2004–present", "severity": "critical",
     "description": "DNC hack 2016, WADA, Bundestag, IOC, French election interference"},
    {"id": "APT29", "name": "APT29 / Cozy Bear", "aliases": "NOBELIUM, The Dukes, SVR",
     "actor": "Russia (SVR)", "lat": 55.75, "lon": 37.62,
     "target": "Governments, think tanks, NGOs, COVID-19 vaccine research, SolarWinds",
     "ttps": "SolarWinds SUNBURST, WellMess, MiniDuke, CozyDuke, BEATDROP",
     "active": "2008–present", "severity": "critical",
     "description": "SolarWinds supply-chain attack 2020; most sophisticated Russian APT"},
    {"id": "Sandworm", "name": "Sandworm / Voodoo Bear", "aliases": "IRIDIUM, Electrum, GRU Unit 74455",
     "actor": "Russia (GRU Unit 74455)", "lat": 55.75, "lon": 37.62,
     "target": "Critical infrastructure: power grids, elections, Olympics",
     "ttps": "BlackEnergy, Industroyer/CRASHOVERRIDE, NotPetya, Olympic Destroyer",
     "active": "2009–present", "severity": "critical",
     "description": "NotPetya (~$10B damage), Ukraine power blackouts 2015/2016"},
    {"id": "Turla", "name": "Turla / Snake", "aliases": "Venomous Bear, Waterbug, BELUGASTURGEON, FSB",
     "actor": "Russia (FSB Center 16)", "lat": 55.75, "lon": 37.62,
     "target": "Embassies, military, governments, energy in 45+ countries",
     "ttps": "Carbon, Kazuar, Gazer, Snake rootkit, Epic dropper",
     "active": "2006–present", "severity": "critical",
     "description": "FSB-linked; hijacked Iranian APT34 infrastructure for cover"},
    {"id": "Gamaredon", "name": "Gamaredon / Shuckworm", "aliases": "ACTINIUM, Primitive Bear, UAC-0010",
     "actor": "Russia (FSB Crimea)", "lat": 44.95, "lon": 34.1,  # Simferopol, Crimea
     "target": "Ukraine government, military, critical infrastructure",
     "ttps": "SimpleDownloader, GAMMASTEEL, GRIMAGENT, docx macros",
     "active": "2013–present", "severity": "critical",
     "description": "Highest-tempo Russian APT against Ukraine; 5000+ attacks/month"},
    {"id": "APT44", "name": "APT44 / Seashell Blizzard", "aliases": "Sandworm Team B, FROZENBARENTS",
     "actor": "Russia (GRU)", "lat": 55.75, "lon": 37.62,
     "target": "Ukraine critical infrastructure, NATO energy sector",
     "ttps": "Industroyer2, CaddyWiper, GOGETTER, LIGHTSHOW",
     "active": "2022–present", "severity": "critical",
     "description": "Post-2022 invasion; persistent ICS/OT attacks on Ukrainian grid"},

    # ── NORTH KOREA (RGB / Lazarus Group) ──────────────────────────────
    {"id": "Lazarus", "name": "Lazarus Group", "aliases": "Hidden Cobra, ZINC, Guardians of Peace, APT38",
     "actor": "DPRK (RGB Bureau 121)", "lat": 39.02, "lon": 125.75,  # Pyongyang
     "target": "Cryptocurrency exchanges, banks, defence, media, ransomware",
     "ttps": "FALLCHILL, HOPLIGHT, DRATzarus, AppleJeus, WannaCry",
     "active": "2009–present", "severity": "critical",
     "description": "Sony Pictures 2014, Bangladesh Bank SWIFT $81M, WannaCry, $3B+ crypto stolen"},
    {"id": "Kimsuky", "name": "Kimsuky / Thallium", "aliases": "Velvet Chollima, Black Banshee, STOLEN PENCIL",
     "actor": "DPRK (RGB)", "lat": 39.02, "lon": 125.75,
     "target": "South Korean govt, think tanks, US policy makers, UN officials",
     "ttps": "BabyShark, PowerShell RAT, Gold Dragon, AppleSeed",
     "active": "2012–present", "severity": "high",
     "description": "Intelligence collection on nuclear policy, sanctions, diplomatic activities"},
    {"id": "ScarCruft", "name": "ScarCruft / APT37", "aliases": "Reaper, Group123, Ricochet Chollima",
     "actor": "DPRK (MSS)", "lat": 39.02, "lon": 125.75,
     "target": "South Korea, Japan, Vietnam, Middle East — defectors, activists",
     "ttps": "ROKRAT, DOGCALL, BLUELIGHT, iOS/Android exploits",
     "active": "2012–present", "severity": "high",
     "description": "Mobile-focused; spear phishing via HWP (Korean word processor) files"},
    {"id": "Andariel", "name": "Andariel / Silent Chollima", "aliases": "Stonefly, DarkSeoul, APT45",
     "actor": "DPRK (RGB Lazarus subdivision)", "lat": 39.02, "lon": 125.75,
     "target": "Healthcare, defence industrial base, financial — ransomware for revenue",
     "ttps": "Maui ransomware, TigerRAT, Dtrack, NukeSped",
     "active": "2015–present", "severity": "critical",
     "description": "US DOJ indicted 2024; US hospitals ransomware operations"},

    # ── IRAN (IRGC / MOIS) ─────────────────────────────────────────────
    {"id": "APT33", "name": "APT33 / Charming Kitten", "aliases": "Refined Kitten, HOLMIUM, Peach Sandstorm",
     "actor": "Iran (IRGC)", "lat": 35.69, "lon": 51.42,  # Tehran
     "target": "Aerospace, petrochemical, energy in Saudi Arabia, US, South Korea",
     "ttps": "DROPSHOT, TURNEDUP, SHAPESHIFT, password spray, AzureAD phishing",
     "active": "2013–present", "severity": "critical",
     "description": "Targeted AUKUS defence contractors 2023 with password spray attacks"},
    {"id": "APT34", "name": "APT34 / OilRig", "aliases": "Helix Kitten, COBALT GYPSY, MuddyWater subset",
     "actor": "Iran (MOIS)", "lat": 35.69, "lon": 51.42,
     "target": "Middle East: financial, government, energy, telecom, IT",
     "ttps": "POWBAT, POWRUNER, BONDUPDATER, DNS tunneling, Helminth",
     "active": "2014–present", "severity": "critical",
     "description": "Infrastructure toolset leaked by Lab Dookhtegan 2019"},
    {"id": "APT35", "name": "APT35 / Phosphorus", "aliases": "Charming Kitten (IR), Mint Sandstorm, Magic Hound",
     "actor": "Iran (IRGC)", "lat": 35.69, "lon": 51.42,
     "target": "Academics, researchers, journalists, human rights, nuclear negotiators",
     "ttps": "TAMECAT, NICECURL, spear phishing, 2FA bypass",
     "active": "2014–present", "severity": "high",
     "description": "Targeted IAEA officials and nuclear negotiators with elaborate social engineering"},
    {"id": "MuddyWater", "name": "MuddyWater / Static Kitten", "aliases": "MERCURY, Seedworm, TEMP.Zagros",
     "actor": "Iran (MOIS)", "lat": 35.69, "lon": 51.42,
     "target": "Middle East, Central Asia, Europe, US government and telecoms",
     "ttps": "PowGoop, POWERSTATS, Ligolo, SimpleHarm, Cobalt Strike",
     "active": "2017–present", "severity": "high",
     "description": "CISA advisory 2022; destructive wipers used alongside espionage"},
    {"id": "APT39", "name": "APT39 / Remix Kitten", "aliases": "Chafer, ITG07, Ballistic Bobcat",
     "actor": "Iran (MOIS Rana Intel)", "lat": 35.69, "lon": 51.42,
     "target": "Telecom, travel, IT — Iran diaspora tracking, counterintelligence",
     "ttps": "SEAWEED, CACHEMONEY, POWBAT, agent forwarding abuse",
     "active": "2014–present", "severity": "high",
     "description": "US Treasury sanctioned Rana Intelligence Computing Company 2020"},

    # ── INDIA ──────────────────────────────────────────────────────────
    {"id": "SideWinder", "name": "SideWinder / Rattlesnake", "aliases": "T-APT-04, Hardcore Nationalist",
     "actor": "India (military intelligence)", "lat": 28.63, "lon": 77.22,  # New Delhi
     "target": "Pakistan, China, Afghanistan, Nepal — military, government",
     "ttps": "Spear phishing, MiWalk RAT, SIDEWIND, DotNetToJScript",
     "active": "2012–present", "severity": "medium",
     "description": "Regional espionage focused on South Asian geopolitics"},
    {"id": "Patchwork", "name": "Patchwork / Dropping Elephant", "aliases": "Chinastrats, APT-C-09",
     "actor": "India", "lat": 28.63, "lon": 77.22,
     "target": "China, Pakistan — think tanks, government, universities",
     "ttps": "BADNEWS, QuasarRAT, MISTRYBIRD, RedLeaves",
     "active": "2015–present", "severity": "medium",
     "description": "Mistakenly infected own machines; tools sourced from public exploit repos"},

    # ── PAKISTAN ───────────────────────────────────────────────────────
    {"id": "TransparentTribe", "name": "Transparent Tribe / APT36", "aliases": "Mythic Leopard, ProjectM, C-Major",
     "actor": "Pakistan (ISI)", "lat": 33.72, "lon": 73.06,  # Islamabad
     "target": "India military/government/NGOs, Afghanistan, US",
     "ttps": "CrimsonRAT, ObliqueRAT, POSEIDON, fake government documents",
     "active": "2013–present", "severity": "high",
     "description": "Long-running India-focused espionage; deployed fake Aadhaar/govt portals"},

    # ── USA / Five Eyes ────────────────────────────────────────────────
    {"id": "Equation", "name": "Equation Group", "aliases": "NOBUS, NSA TAO, Tailored Access Operations",
     "actor": "USA (NSA TAO)", "lat": 39.07, "lon": -76.93,  # Fort Meade
     "target": "Iran (Stuxnet), Russia, China, Middle East — global signals collection",
     "ttps": "EquationDrug, GrayFish, DOUBLEFANTASY, Fanny worm, Stuxnet co-developer",
     "active": "1996–present", "severity": "critical",
     "description": "Shadow Brokers leak 2016–2017 exposed NSA toolset; Stuxnet/Flame co-author"},
    {"id": "Longhorn", "name": "Longhorn / The Lamberts", "aliases": "CIA Vault7 toolset, Fluxwire",
     "actor": "USA (CIA)", "lat": 38.95, "lon": -77.14,  # Langley
     "target": "Governments in Asia, Europe, Middle East, Africa",
     "ttps": "EVILTOSS, MARGARITA, Fluxwire, Cobalt Strike precursor",
     "active": "2007–2017 (Vault7 exposure)", "severity": "high",
     "description": "WikiLeaks Vault7 2017 exposed vast CIA offensive cyber programme"},

    # ── ISRAEL ────────────────────────────────────────────────────────
    {"id": "DuquFlame", "name": "Duqu/Flame Group", "aliases": "Unit 8200 (attributed)",
     "actor": "Israel (Unit 8200)", "lat": 32.08, "lon": 34.8,  # Tel Aviv
     "target": "Iran industrial infrastructure, Lebanon, Sudan",
     "ttps": "Stuxnet (with NSA), Flame, Duqu, Gauss, Regin (shared)",
     "active": "2007–2015", "severity": "critical",
     "description": "Stuxnet destroyed ~1000 Natanz centrifuges; Flame: 20MB modular spyware"},

    # ── CRIMINAL / RANSOMWARE NEXUS ────────────────────────────────────
    {"id": "FIN7", "name": "FIN7 / Carbon Spider", "aliases": "Carbanak Group, GOLD NIAGARA",
     "actor": "Russia (criminal)", "lat": 55.75, "lon": 37.62,
     "target": "Retail POS, hospitality, restaurants — Chipotle, Arby's, Chili's",
     "ttps": "Carbanak/Anunak, PILLOWMINT, TERMITE, spear phishing with fake SEC filing",
     "active": "2013–present", "severity": "high",
     "description": "$1B+ in card fraud; leaders indicted but group continues operations"},
    {"id": "Cl0p", "name": "Cl0p / TA505", "aliases": "GOLD TAHOE, FIN11",
     "actor": "Ukraine/Russia nexus (criminal)", "lat": 50.45, "lon": 30.52,
     "target": "Financial, government — MOVEit, Accellion, GoAnywhere zero-days",
     "ttps": "Clop ransomware, zero-day exploitation of file-transfer software",
     "active": "2019–present", "severity": "critical",
     "description": "MOVEit campaign 2023: 2000+ org victims; zero-day supply chain approach"},
    {"id": "LockBit", "name": "LockBit RaaS", "aliases": "GOLD MYSTIC, ABCD ransomware",
     "actor": "Russia (criminal RaaS)", "lat": 55.75, "lon": 37.62,
     "target": "Global enterprise across all sectors — 2000+ confirmed victims",
     "ttps": "LockBit 3.0/Black, OPSEC, affiliate model, triple extortion",
     "active": "2019–present (disrupted 2024)", "severity": "critical",
     "description": "FBI/Europol Operation Cronos 2024 disrupted infrastructure; resurgent"},
    {"id": "BlackCat", "name": "ALPHV / BlackCat", "aliases": "Noberus, GOLD BLAZER",
     "actor": "Russia (criminal)", "lat": 55.75, "lon": 37.62,
     "target": "Healthcare, critical infrastructure, financial",
     "ttps": "Rust-based ransomware, BYOVD, data leak site, $22M Change Healthcare ransom",
     "active": "2021–2024 (FBI disrupted)", "severity": "critical",
     "description": "Change Healthcare attack disrupted US pharmacy system for months"},

    # ── MIDDLE EAST NON-IRAN ───────────────────────────────────────────
    {"id": "DarkHydrus", "name": "DarkHydrus / Gaza Cybergang", "aliases": "Molerats, Extreme Jackal",
     "actor": "Palestinian/Hamas-aligned", "lat": 31.5, "lon": 34.47,  # Gaza
     "target": "Middle East governments, banks, telecoms",
     "ttps": "RoboSki, KASPERAGENT, Spark backdoor, CloudMensis",
     "active": "2012–present", "severity": "medium",
     "description": "Hamas-aligned cyber operations targeting PA rivals and Israel"},

    # ── TURKEY ────────────────────────────────────────────────────────
    {"id": "SeaUnicorn", "name": "Sea Unicorn / StrongPity", "aliases": "PROMETHIUM, APT-T-15",
     "actor": "Turkey (MİT)", "lat": 39.93, "lon": 32.86,  # Ankara
     "target": "Kurdish groups, Belgium, Italy, Syria — watering hole via software trojanisation",
     "ttps": "KARKOFF, StrongPity malware, trojanised installers (WinRAR, Notepad++)",
     "active": "2012–present", "severity": "medium",
     "description": "Targeted Kurdish populations and political opponents in Europe"},

    # ── BELARUS ───────────────────────────────────────────────────────
    {"id": "GhostWriter", "name": "GhostWriter / UNC1151", "aliases": "Moonscape",
     "actor": "Belarus (GRB) / Russia joint", "lat": 53.9, "lon": 27.57,  # Minsk
     "target": "Lithuania, Latvia, Poland, Germany, Ukraine — information operations",
     "ttps": "Credential phishing, fake news injection, social media manipulation",
     "active": "2017–present", "severity": "medium",
     "description": "Mandiant 2021: attributed to Belarusian military; NATO disinformation ops"},
]
