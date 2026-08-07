// ============================================================================
// RÉFÉRENTIEL DE DÉPART — MÉTIERS, COMPÉTENCES, SYNONYMES
//
// Ce fichier est de la DONNÉE, pas du code. Il est séparé du script qui
// l'écrit en base pour qu'une personne non technique puisse le relire, le
// corriger et proposer des ajouts — c'est le genre de contenu qui se juge par
// la connaissance du marché, pas par la lecture d'un programme.
//
// UN POINT DE DÉPART, PAS UNE VÉRITÉ. Tout ce qui est ici est ensuite
// modifiable depuis le back-office ADMIN (`/search-admin`). Le script est
// idempotent : il ne crée que ce qui manque et ne réécrase jamais un libellé
// corrigé à la main.
//
// ---------------------------------------------------------------------------
// TROIS PARTIS PRIS, ET POURQUOI
//
// 1. ADAPTÉ AU MARCHÉ RÉEL, PAS RECOPIÉ DE ROME OU D'ESCO. Ces nomenclatures
//    européennes décrivent des marchés du travail où l'emploi salarié formel
//    domine. Au Cameroun, l'essentiel de l'activité des jeunes est ailleurs :
//    commerce de détail, mototaxi, transformation agroalimentaire, artisanat,
//    petits services numériques. Un référentiel qui ne nomme pas ces métiers
//    ne peut pas rapprocher les offres qui les concernent — et exclurait
//    précisément les jeunes que la plateforme veut servir.
//
// 2. LE BILINGUISME EST UNE PRIORITÉ, PAS UNE FINITION. Le Cameroun est
//    officiellement bilingue. Un candidat de Bamenda ou Buea tape
//    « accountant » ; l'offre de Douala dit « comptable ». Sans synonyme, il
//    conclut qu'il n'y a pas d'offre — pas que son vocabulaire diffère de
//    celui du recruteur. C'est l'échec le plus coûteux et le plus invisible du
//    dispositif, et c'est pour lui que la table de synonymes existe.
//
// 3. LES CINQ LANGUES DÈS LE DÉPART. Un référentiel qui ne serait qu'en
//    français exclurait de la recherche par compétence les utilisateurs
//    anglophones, hispanophones, arabophones et lusophones — c'est-à-dire le
//    reste du continent, qui est le périmètre annoncé.
// ============================================================================

// --- FAMILLES DE MÉTIERS ----------------------------------------------------
//
// Deux niveaux seulement : une famille, puis ses métiers. Une hiérarchie plus
// profonde rendrait la correspondance « même famille » arbitraire — à quelle
// profondeur s'arrête-t-on ?
export const FAMILLES = [
  {
    code: 'AGRICULTURE',
    labelFr: 'Agriculture, élevage et agroalimentaire',
    labelEn: 'Agriculture, livestock and food processing',
    labelEs: 'Agricultura, ganadería y agroalimentación',
    labelAr: 'الزراعة وتربية الماشية والصناعات الغذائية',
    labelPt: 'Agricultura, pecuária e agroalimentar',
  },
  {
    code: 'COMMERCE',
    labelFr: 'Commerce, vente et distribution',
    labelEn: 'Trade, sales and distribution',
    labelEs: 'Comercio, ventas y distribución',
    labelAr: 'التجارة والبيع والتوزيع',
    labelPt: 'Comércio, vendas e distribuição',
  },
  {
    code: 'BTP',
    labelFr: 'Bâtiment et travaux publics',
    labelEn: 'Construction and public works',
    labelEs: 'Construcción y obras públicas',
    labelAr: 'البناء والأشغال العامة',
    labelPt: 'Construção e obras públicas',
  },
  {
    code: 'NUMERIQUE',
    labelFr: 'Numérique et télécommunications',
    labelEn: 'Digital and telecommunications',
    labelEs: 'Digital y telecomunicaciones',
    labelAr: 'الرقميات والاتصالات',
    labelPt: 'Digital e telecomunicações',
  },
  {
    code: 'SANTE',
    labelFr: 'Santé et action sociale',
    labelEn: 'Health and social care',
    labelEs: 'Salud y acción social',
    labelAr: 'الصحة والعمل الاجتماعي',
    labelPt: 'Saúde e ação social',
  },
  {
    code: 'EDUCATION',
    labelFr: 'Éducation et formation',
    labelEn: 'Education and training',
    labelEs: 'Educación y formación',
    labelAr: 'التعليم والتكوين',
    labelPt: 'Educação e formação',
  },
  {
    code: 'TRANSPORT',
    labelFr: 'Transport et logistique',
    labelEn: 'Transport and logistics',
    labelEs: 'Transporte y logística',
    labelAr: 'النقل واللوجستيات',
    labelPt: 'Transporte e logística',
  },
  {
    code: 'HOTELLERIE',
    labelFr: 'Hôtellerie, restauration et tourisme',
    labelEn: 'Hospitality, catering and tourism',
    labelEs: 'Hostelería, restauración y turismo',
    labelAr: 'الفندقة والمطاعم والسياحة',
    labelPt: 'Hotelaria, restauração e turismo',
  },
  {
    code: 'ARTISANAT',
    labelFr: 'Artisanat et métiers manuels',
    labelEn: 'Crafts and manual trades',
    labelEs: 'Artesanía y oficios manuales',
    labelAr: 'الحرف والمهن اليدوية',
    labelPt: 'Artesanato e ofícios manuais',
  },
  {
    code: 'FINANCE',
    labelFr: 'Banque, finance et microfinance',
    labelEn: 'Banking, finance and microfinance',
    labelEs: 'Banca, finanzas y microfinanzas',
    labelAr: 'المصارف والتمويل والتمويل الأصغر',
    labelPt: 'Banca, finanças e microfinanças',
  },
  {
    code: 'COMMUNICATION',
    labelFr: 'Communication, médias et création',
    labelEn: 'Communication, media and creative work',
    labelEs: 'Comunicación, medios y creación',
    labelAr: 'الاتصال والإعلام والإبداع',
    labelPt: 'Comunicação, media e criação',
  },
  {
    code: 'GESTION',
    labelFr: 'Administration, gestion et ressources humaines',
    labelEn: 'Administration, management and human resources',
    labelEs: 'Administración, gestión y recursos humanos',
    labelAr: 'الإدارة والتسيير والموارد البشرية',
    labelPt: 'Administração, gestão e recursos humanos',
  },
  {
    code: 'INDUSTRIE',
    labelFr: 'Industrie et maintenance',
    labelEn: 'Industry and maintenance',
    labelEs: 'Industria y mantenimiento',
    labelAr: 'الصناعة والصيانة',
    labelPt: 'Indústria e manutenção',
  },
  {
    code: 'ENERGIE',
    labelFr: 'Énergie, eau et environnement',
    labelEn: 'Energy, water and environment',
    labelEs: 'Energía, agua y medio ambiente',
    labelAr: 'الطاقة والمياه والبيئة',
    labelPt: 'Energia, água e ambiente',
  },
];

// --- MÉTIERS ----------------------------------------------------------------
//
// Chacun rattaché à sa famille par `parent`.
export const METIERS = [
  // --- Agriculture ---------------------------------------------------------
  { code: 'AGRICULTEUR', parent: 'AGRICULTURE', labelFr: 'Agriculteur / Exploitant agricole', labelEn: 'Farmer', labelEs: 'Agricultor', labelAr: 'مزارع', labelPt: 'Agricultor' },
  { code: 'TECHNICIEN_AGRICOLE', parent: 'AGRICULTURE', labelFr: 'Technicien agricole', labelEn: 'Agricultural technician', labelEs: 'Técnico agrícola', labelAr: 'تقني زراعي', labelPt: 'Técnico agrícola' },
  { code: 'ELEVEUR', parent: 'AGRICULTURE', labelFr: 'Éleveur', labelEn: 'Livestock farmer', labelEs: 'Ganadero', labelAr: 'مربي ماشية', labelPt: 'Criador de gado' },
  { code: 'PISCICULTEUR', parent: 'AGRICULTURE', labelFr: 'Pisciculteur', labelEn: 'Fish farmer', labelEs: 'Piscicultor', labelAr: 'مربي أسماك', labelPt: 'Piscicultor' },
  { code: 'TRANSFORMATION_AGRO', parent: 'AGRICULTURE', labelFr: 'Agent de transformation agroalimentaire', labelEn: 'Food processing operator', labelEs: 'Operario de transformación agroalimentaria', labelAr: 'عامل تحويل غذائي', labelPt: 'Operador de transformação alimentar' },
  { code: 'AGRONOME', parent: 'AGRICULTURE', labelFr: 'Ingénieur agronome', labelEn: 'Agronomist', labelEs: 'Ingeniero agrónomo', labelAr: 'مهندس زراعي', labelPt: 'Engenheiro agrónomo' },

  // --- Commerce ------------------------------------------------------------
  { code: 'VENDEUR', parent: 'COMMERCE', labelFr: 'Vendeur / Vendeuse', labelEn: 'Sales assistant', labelEs: 'Vendedor', labelAr: 'بائع', labelPt: 'Vendedor' },
  { code: 'COMMERCIAL', parent: 'COMMERCE', labelFr: 'Commercial / Attaché commercial', labelEn: 'Sales representative', labelEs: 'Comercial', labelAr: 'مندوب مبيعات', labelPt: 'Comercial' },
  { code: 'CAISSIER', parent: 'COMMERCE', labelFr: 'Caissier / Caissière', labelEn: 'Cashier', labelEs: 'Cajero', labelAr: 'أمين صندوق', labelPt: 'Caixa' },
  { code: 'CHEF_RAYON', parent: 'COMMERCE', labelFr: 'Chef de rayon', labelEn: 'Department supervisor', labelEs: 'Jefe de sección', labelAr: 'مسؤول قسم', labelPt: 'Chefe de secção' },
  { code: 'AGENT_IMMOBILIER', parent: 'COMMERCE', labelFr: 'Agent immobilier', labelEn: 'Estate agent', labelEs: 'Agente inmobiliario', labelAr: 'وكيل عقاري', labelPt: 'Agente imobiliário' },
  { code: 'TELEVENDEUR', parent: 'COMMERCE', labelFr: 'Téléconseiller / Agent de centre d’appels', labelEn: 'Call centre agent', labelEs: 'Teleoperador', labelAr: 'موظف مركز اتصال', labelPt: 'Operador de call center' },

  // --- BTP -----------------------------------------------------------------
  { code: 'MACON', parent: 'BTP', labelFr: 'Maçon', labelEn: 'Mason / Bricklayer', labelEs: 'Albañil', labelAr: 'بنّاء', labelPt: 'Pedreiro' },
  { code: 'CARRELEUR', parent: 'BTP', labelFr: 'Carreleur', labelEn: 'Tiler', labelEs: 'Alicatador', labelAr: 'مبلّط', labelPt: 'Ladrilhador' },
  { code: 'PEINTRE_BATIMENT', parent: 'BTP', labelFr: 'Peintre en bâtiment', labelEn: 'House painter', labelEs: 'Pintor de obra', labelAr: 'دهّان مبانٍ', labelPt: 'Pintor de construção' },
  { code: 'PLOMBIER', parent: 'BTP', labelFr: 'Plombier', labelEn: 'Plumber', labelEs: 'Fontanero', labelAr: 'سبّاك', labelPt: 'Canalizador' },
  { code: 'ELECTRICIEN_BATIMENT', parent: 'BTP', labelFr: 'Électricien bâtiment', labelEn: 'Building electrician', labelEs: 'Electricista de obra', labelAr: 'كهربائي مبانٍ', labelPt: 'Eletricista de construção' },
  { code: 'CONDUCTEUR_TRAVAUX', parent: 'BTP', labelFr: 'Conducteur de travaux', labelEn: 'Site manager', labelEs: 'Jefe de obra', labelAr: 'مدير ورشة', labelPt: 'Diretor de obra' },
  { code: 'TOPOGRAPHE', parent: 'BTP', labelFr: 'Géomètre-topographe', labelEn: 'Surveyor', labelEs: 'Topógrafo', labelAr: 'مساح', labelPt: 'Topógrafo' },
  { code: 'ARCHITECTE', parent: 'BTP', labelFr: 'Architecte', labelEn: 'Architect', labelEs: 'Arquitecto', labelAr: 'مهندس معماري', labelPt: 'Arquiteto' },
  { code: 'INGENIEUR_GENIE_CIVIL', parent: 'BTP', labelFr: 'Ingénieur génie civil', labelEn: 'Civil engineer', labelEs: 'Ingeniero civil', labelAr: 'مهندس مدني', labelPt: 'Engenheiro civil' },

  // --- Numérique -----------------------------------------------------------
  { code: 'DEV_WEB', parent: 'NUMERIQUE', labelFr: 'Développeur web', labelEn: 'Web developer', labelEs: 'Desarrollador web', labelAr: 'مطوّر ويب', labelPt: 'Programador web' },
  { code: 'DEV_MOBILE', parent: 'NUMERIQUE', labelFr: 'Développeur mobile', labelEn: 'Mobile developer', labelEs: 'Desarrollador móvil', labelAr: 'مطوّر تطبيقات محمولة', labelPt: 'Programador móvel' },
  { code: 'ADMIN_SYSTEME', parent: 'NUMERIQUE', labelFr: 'Administrateur systèmes et réseaux', labelEn: 'Systems and network administrator', labelEs: 'Administrador de sistemas y redes', labelAr: 'مدير أنظمة وشبكات', labelPt: 'Administrador de sistemas e redes' },
  { code: 'TECHNICIEN_INFO', parent: 'NUMERIQUE', labelFr: 'Technicien de maintenance informatique', labelEn: 'IT support technician', labelEs: 'Técnico de soporte informático', labelAr: 'تقني صيانة حاسوب', labelPt: 'Técnico de informática' },
  { code: 'DATA_ANALYST', parent: 'NUMERIQUE', labelFr: 'Analyste de données', labelEn: 'Data analyst', labelEs: 'Analista de datos', labelAr: 'محلل بيانات', labelPt: 'Analista de dados' },
  { code: 'DESIGNER_UI', parent: 'NUMERIQUE', labelFr: 'Designer d’interface (UI/UX)', labelEn: 'UI/UX designer', labelEs: 'Diseñador UI/UX', labelAr: 'مصمم واجهات', labelPt: 'Designer de interfaces' },
  { code: 'CYBERSECURITE', parent: 'NUMERIQUE', labelFr: 'Analyste cybersécurité', labelEn: 'Cybersecurity analyst', labelEs: 'Analista de ciberseguridad', labelAr: 'محلل أمن سيبراني', labelPt: 'Analista de cibersegurança' },
  { code: 'TECHNICIEN_TELECOM', parent: 'NUMERIQUE', labelFr: 'Technicien télécoms', labelEn: 'Telecoms technician', labelEs: 'Técnico de telecomunicaciones', labelAr: 'تقني اتصالات', labelPt: 'Técnico de telecomunicações' },
  { code: 'COMMUNITY_MANAGER', parent: 'NUMERIQUE', labelFr: 'Community manager', labelEn: 'Community manager', labelEs: 'Community manager', labelAr: 'مدير مجتمع رقمي', labelPt: 'Gestor de comunidades' },

  // --- Santé ---------------------------------------------------------------
  { code: 'INFIRMIER', parent: 'SANTE', labelFr: 'Infirmier / Infirmière', labelEn: 'Nurse', labelEs: 'Enfermero', labelAr: 'ممرّض', labelPt: 'Enfermeiro' },
  { code: 'AIDE_SOIGNANT', parent: 'SANTE', labelFr: 'Aide-soignant', labelEn: 'Care assistant', labelEs: 'Auxiliar de enfermería', labelAr: 'مساعد تمريض', labelPt: 'Auxiliar de saúde' },
  { code: 'SAGE_FEMME', parent: 'SANTE', labelFr: 'Sage-femme', labelEn: 'Midwife', labelEs: 'Matrona', labelAr: 'قابلة', labelPt: 'Parteira' },
  { code: 'LABORANTIN', parent: 'SANTE', labelFr: 'Technicien de laboratoire médical', labelEn: 'Medical laboratory technician', labelEs: 'Técnico de laboratorio médico', labelAr: 'تقني مختبر طبي', labelPt: 'Técnico de laboratório médico' },
  { code: 'PHARMACIEN', parent: 'SANTE', labelFr: 'Pharmacien / Préparateur en pharmacie', labelEn: 'Pharmacist / Pharmacy technician', labelEs: 'Farmacéutico', labelAr: 'صيدلي', labelPt: 'Farmacêutico' },
  { code: 'AGENT_SANTE_COMMUNAUTAIRE', parent: 'SANTE', labelFr: 'Agent de santé communautaire', labelEn: 'Community health worker', labelEs: 'Agente de salud comunitaria', labelAr: 'عامل صحة مجتمعية', labelPt: 'Agente de saúde comunitária' },
  { code: 'TRAVAILLEUR_SOCIAL', parent: 'SANTE', labelFr: 'Travailleur social', labelEn: 'Social worker', labelEs: 'Trabajador social', labelAr: 'أخصائي اجتماعي', labelPt: 'Assistente social' },

  // --- Éducation -----------------------------------------------------------
  { code: 'ENSEIGNANT_PRIMAIRE', parent: 'EDUCATION', labelFr: 'Enseignant du primaire', labelEn: 'Primary school teacher', labelEs: 'Maestro de primaria', labelAr: 'معلّم ابتدائي', labelPt: 'Professor do ensino básico' },
  { code: 'ENSEIGNANT_SECONDAIRE', parent: 'EDUCATION', labelFr: 'Enseignant du secondaire', labelEn: 'Secondary school teacher', labelEs: 'Profesor de secundaria', labelAr: 'أستاذ ثانوي', labelPt: 'Professor do ensino secundário' },
  { code: 'FORMATEUR', parent: 'EDUCATION', labelFr: 'Formateur professionnel', labelEn: 'Vocational trainer', labelEs: 'Formador profesional', labelAr: 'مكوّن مهني', labelPt: 'Formador profissional' },
  { code: 'EDUCATEUR_PETITE_ENFANCE', parent: 'EDUCATION', labelFr: 'Éducateur de jeunes enfants', labelEn: 'Early years educator', labelEs: 'Educador infantil', labelAr: 'مربي أطفال', labelPt: 'Educador de infância' },
  { code: 'SURVEILLANT', parent: 'EDUCATION', labelFr: 'Surveillant / Conseiller d’éducation', labelEn: 'School supervisor', labelEs: 'Supervisor escolar', labelAr: 'مراقب تربوي', labelPt: 'Vigilante escolar' },

  // --- Transport -----------------------------------------------------------
  { code: 'CHAUFFEUR', parent: 'TRANSPORT', labelFr: 'Chauffeur', labelEn: 'Driver', labelEs: 'Conductor', labelAr: 'سائق', labelPt: 'Motorista' },
  { code: 'CONDUCTEUR_MOTOTAXI', parent: 'TRANSPORT', labelFr: 'Conducteur de moto-taxi', labelEn: 'Motorcycle taxi rider', labelEs: 'Mototaxista', labelAr: 'سائق دراجة أجرة', labelPt: 'Mototaxista' },
  { code: 'LIVREUR', parent: 'TRANSPORT', labelFr: 'Livreur / Coursier', labelEn: 'Delivery rider', labelEs: 'Repartidor', labelAr: 'موصّل طلبات', labelPt: 'Estafeta' },
  { code: 'MAGASINIER', parent: 'TRANSPORT', labelFr: 'Magasinier / Gestionnaire de stock', labelEn: 'Warehouse operative / Stock controller', labelEs: 'Almacenero', labelAr: 'أمين مخزن', labelPt: 'Fiel de armazém' },
  { code: 'AGENT_TRANSIT', parent: 'TRANSPORT', labelFr: 'Agent de transit et de douane', labelEn: 'Freight forwarding and customs agent', labelEs: 'Agente de tránsito y aduanas', labelAr: 'وكيل شحن وجمارك', labelPt: 'Agente de trânsito e alfândega' },
  { code: 'RESPONSABLE_LOGISTIQUE', parent: 'TRANSPORT', labelFr: 'Responsable logistique', labelEn: 'Logistics manager', labelEs: 'Responsable de logística', labelAr: 'مسؤول لوجستيات', labelPt: 'Responsável de logística' },

  // --- Hôtellerie ----------------------------------------------------------
  { code: 'CUISINIER', parent: 'HOTELLERIE', labelFr: 'Cuisinier', labelEn: 'Cook / Chef', labelEs: 'Cocinero', labelAr: 'طبّاخ', labelPt: 'Cozinheiro' },
  { code: 'SERVEUR', parent: 'HOTELLERIE', labelFr: 'Serveur / Serveuse', labelEn: 'Waiter / Waitress', labelEs: 'Camarero', labelAr: 'نادل', labelPt: 'Empregado de mesa' },
  { code: 'RECEPTIONNISTE', parent: 'HOTELLERIE', labelFr: 'Réceptionniste', labelEn: 'Receptionist', labelEs: 'Recepcionista', labelAr: 'موظف استقبال', labelPt: 'Rececionista' },
  { code: 'GOUVERNANTE', parent: 'HOTELLERIE', labelFr: 'Gouvernante / Agent d’entretien hôtelier', labelEn: 'Housekeeper', labelEs: 'Gobernanta', labelAr: 'مشرفة تدبير فندقي', labelPt: 'Governanta' },
  { code: 'PATISSIER', parent: 'HOTELLERIE', labelFr: 'Pâtissier / Boulanger', labelEn: 'Pastry chef / Baker', labelEs: 'Pastelero / Panadero', labelAr: 'حلواني / خبّاز', labelPt: 'Pasteleiro / Padeiro' },
  { code: 'GUIDE_TOURISTIQUE', parent: 'HOTELLERIE', labelFr: 'Guide touristique', labelEn: 'Tour guide', labelEs: 'Guía turístico', labelAr: 'مرشد سياحي', labelPt: 'Guia turístico' },

  // --- Artisanat -----------------------------------------------------------
  { code: 'COUTURIER', parent: 'ARTISANAT', labelFr: 'Couturier / Styliste', labelEn: 'Tailor / Fashion designer', labelEs: 'Sastre / Diseñador de moda', labelAr: 'خيّاط / مصمم أزياء', labelPt: 'Alfaiate / Estilista' },
  { code: 'COIFFEUR', parent: 'ARTISANAT', labelFr: 'Coiffeur / Coiffeuse', labelEn: 'Hairdresser', labelEs: 'Peluquero', labelAr: 'حلّاق', labelPt: 'Cabeleireiro' },
  { code: 'ESTHETICIENNE', parent: 'ARTISANAT', labelFr: 'Esthéticien / Esthéticienne', labelEn: 'Beautician', labelEs: 'Esteticista', labelAr: 'أخصائي تجميل', labelPt: 'Esteticista' },
  { code: 'MENUISIER', parent: 'ARTISANAT', labelFr: 'Menuisier / Ébéniste', labelEn: 'Carpenter / Cabinetmaker', labelEs: 'Carpintero / Ebanista', labelAr: 'نجّار', labelPt: 'Carpinteiro / Marceneiro' },
  { code: 'SOUDEUR', parent: 'ARTISANAT', labelFr: 'Soudeur / Ferronnier', labelEn: 'Welder / Metalworker', labelEs: 'Soldador', labelAr: 'لحّام / حدّاد', labelPt: 'Soldador / Serralheiro' },
  { code: 'CORDONNIER', parent: 'ARTISANAT', labelFr: 'Cordonnier / Maroquinier', labelEn: 'Cobbler / Leatherworker', labelEs: 'Zapatero', labelAr: 'إسكافي', labelPt: 'Sapateiro' },
  { code: 'ARTISAN_ART', parent: 'ARTISANAT', labelFr: 'Artisan d’art (sculpture, vannerie, perlage)', labelEn: 'Craft artisan (carving, basketry, beadwork)', labelEs: 'Artesano de arte', labelAr: 'حرفي فني', labelPt: 'Artesão de arte' },

  // --- Finance -------------------------------------------------------------
  { code: 'COMPTABLE', parent: 'FINANCE', labelFr: 'Comptable', labelEn: 'Accountant', labelEs: 'Contable', labelAr: 'محاسب', labelPt: 'Contabilista' },
  { code: 'AIDE_COMPTABLE', parent: 'FINANCE', labelFr: 'Aide-comptable', labelEn: 'Accounts assistant', labelEs: 'Auxiliar contable', labelAr: 'مساعد محاسب', labelPt: 'Assistente de contabilidade' },
  { code: 'CHARGE_CLIENTELE_BANQUE', parent: 'FINANCE', labelFr: 'Chargé de clientèle bancaire', labelEn: 'Bank customer adviser', labelEs: 'Gestor de clientes bancarios', labelAr: 'مستشار عملاء مصرفي', labelPt: 'Gestor de cliente bancário' },
  { code: 'AGENT_MICROFINANCE', parent: 'FINANCE', labelFr: 'Agent de microfinance', labelEn: 'Microfinance officer', labelEs: 'Agente de microfinanzas', labelAr: 'موظف تمويل أصغر', labelPt: 'Agente de microfinanças' },
  { code: 'AGENT_MOBILE_MONEY', parent: 'FINANCE', labelFr: 'Agent de mobile money', labelEn: 'Mobile money agent', labelEs: 'Agente de dinero móvil', labelAr: 'وكيل نقود متنقلة', labelPt: 'Agente de dinheiro móvel' },
  { code: 'AUDITEUR', parent: 'FINANCE', labelFr: 'Auditeur / Contrôleur de gestion', labelEn: 'Auditor / Management controller', labelEs: 'Auditor / Controller', labelAr: 'مدقق / مراقب تسيير', labelPt: 'Auditor / Controlador de gestão' },

  // --- Communication -------------------------------------------------------
  { code: 'JOURNALISTE', parent: 'COMMUNICATION', labelFr: 'Journaliste', labelEn: 'Journalist', labelEs: 'Periodista', labelAr: 'صحفي', labelPt: 'Jornalista' },
  { code: 'CHARGE_COMMUNICATION', parent: 'COMMUNICATION', labelFr: 'Chargé de communication', labelEn: 'Communications officer', labelEs: 'Responsable de comunicación', labelAr: 'مكلّف بالاتصال', labelPt: 'Responsável de comunicação' },
  { code: 'GRAPHISTE', parent: 'COMMUNICATION', labelFr: 'Graphiste / Infographiste', labelEn: 'Graphic designer', labelEs: 'Diseñador gráfico', labelAr: 'مصمم جرافيك', labelPt: 'Designer gráfico' },
  { code: 'PHOTOGRAPHE', parent: 'COMMUNICATION', labelFr: 'Photographe / Vidéaste', labelEn: 'Photographer / Videographer', labelEs: 'Fotógrafo / Videógrafo', labelAr: 'مصوّر', labelPt: 'Fotógrafo / Videógrafo' },
  { code: 'MONTEUR_VIDEO', parent: 'COMMUNICATION', labelFr: 'Monteur vidéo', labelEn: 'Video editor', labelEs: 'Editor de vídeo', labelAr: 'مونتير فيديو', labelPt: 'Editor de vídeo' },
  { code: 'CHARGE_MARKETING', parent: 'COMMUNICATION', labelFr: 'Chargé de marketing', labelEn: 'Marketing officer', labelEs: 'Responsable de marketing', labelAr: 'مكلّف بالتسويق', labelPt: 'Responsável de marketing' },
  { code: 'TRADUCTEUR', parent: 'COMMUNICATION', labelFr: 'Traducteur / Interprète', labelEn: 'Translator / Interpreter', labelEs: 'Traductor / Intérprete', labelAr: 'مترجم', labelPt: 'Tradutor / Intérprete' },

  // --- Gestion -------------------------------------------------------------
  { code: 'ASSISTANT_ADMIN', parent: 'GESTION', labelFr: 'Assistant administratif', labelEn: 'Administrative assistant', labelEs: 'Asistente administrativo', labelAr: 'مساعد إداري', labelPt: 'Assistente administrativo' },
  { code: 'SECRETAIRE', parent: 'GESTION', labelFr: 'Secrétaire', labelEn: 'Secretary', labelEs: 'Secretario', labelAr: 'سكرتير', labelPt: 'Secretário' },
  { code: 'CHARGE_RH', parent: 'GESTION', labelFr: 'Chargé des ressources humaines', labelEn: 'Human resources officer', labelEs: 'Responsable de recursos humanos', labelAr: 'مكلّف بالموارد البشرية', labelPt: 'Técnico de recursos humanos' },
  { code: 'CHEF_PROJET', parent: 'GESTION', labelFr: 'Chef de projet', labelEn: 'Project manager', labelEs: 'Jefe de proyecto', labelAr: 'مدير مشروع', labelPt: 'Gestor de projeto' },
  { code: 'CHARGE_SUIVI_EVALUATION', parent: 'GESTION', labelFr: 'Chargé de suivi-évaluation', labelEn: 'Monitoring and evaluation officer', labelEs: 'Responsable de seguimiento y evaluación', labelAr: 'مكلّف بالمتابعة والتقييم', labelPt: 'Técnico de monitorização e avaliação' },
  { code: 'JURISTE', parent: 'GESTION', labelFr: 'Juriste', labelEn: 'Legal officer', labelEs: 'Jurista', labelAr: 'مستشار قانوني', labelPt: 'Jurista' },

  // --- Industrie -----------------------------------------------------------
  { code: 'MECANICIEN', parent: 'INDUSTRIE', labelFr: 'Mécanicien automobile', labelEn: 'Motor mechanic', labelEs: 'Mecánico de automóviles', labelAr: 'ميكانيكي سيارات', labelPt: 'Mecânico de automóveis' },
  { code: 'TECHNICIEN_MAINTENANCE', parent: 'INDUSTRIE', labelFr: 'Technicien de maintenance industrielle', labelEn: 'Industrial maintenance technician', labelEs: 'Técnico de mantenimiento industrial', labelAr: 'تقني صيانة صناعية', labelPt: 'Técnico de manutenção industrial' },
  { code: 'OPERATEUR_PRODUCTION', parent: 'INDUSTRIE', labelFr: 'Opérateur de production', labelEn: 'Production operative', labelEs: 'Operario de producción', labelAr: 'عامل إنتاج', labelPt: 'Operador de produção' },
  { code: 'FROID_CLIMATISATION', parent: 'INDUSTRIE', labelFr: 'Technicien froid et climatisation', labelEn: 'Refrigeration and air-conditioning technician', labelEs: 'Técnico de frío y climatización', labelAr: 'تقني تبريد وتكييف', labelPt: 'Técnico de frio e climatização' },
  { code: 'QUALITICIEN', parent: 'INDUSTRIE', labelFr: 'Technicien qualité / QHSE', labelEn: 'Quality / HSE technician', labelEs: 'Técnico de calidad / SSMA', labelAr: 'تقني جودة وسلامة', labelPt: 'Técnico de qualidade / HSE' },

  // --- Énergie -------------------------------------------------------------
  { code: 'TECHNICIEN_SOLAIRE', parent: 'ENERGIE', labelFr: 'Technicien en énergie solaire', labelEn: 'Solar energy technician', labelEs: 'Técnico de energía solar', labelAr: 'تقني طاقة شمسية', labelPt: 'Técnico de energia solar' },
  { code: 'ELECTROTECHNICIEN', parent: 'ENERGIE', labelFr: 'Électrotechnicien', labelEn: 'Electrical technician', labelEs: 'Electrotécnico', labelAr: 'تقني كهرباء', labelPt: 'Eletrotécnico' },
  { code: 'AGENT_EAU_ASSAINISSEMENT', parent: 'ENERGIE', labelFr: 'Agent eau et assainissement', labelEn: 'Water and sanitation officer', labelEs: 'Técnico de agua y saneamiento', labelAr: 'تقني مياه وصرف صحي', labelPt: 'Técnico de água e saneamento' },
  { code: 'CHARGE_ENVIRONNEMENT', parent: 'ENERGIE', labelFr: 'Chargé d’environnement', labelEn: 'Environmental officer', labelEs: 'Responsable de medio ambiente', labelAr: 'مكلّف بالبيئة', labelPt: 'Técnico de ambiente' },
  { code: 'AGENT_GESTION_DECHETS', parent: 'ENERGIE', labelFr: 'Agent de gestion des déchets', labelEn: 'Waste management operative', labelEs: 'Operario de gestión de residuos', labelAr: 'عامل تدبير النفايات', labelPt: 'Operador de gestão de resíduos' },
];

// --- COMPÉTENCES ------------------------------------------------------------
//
// La `category` sert deux choses : regrouper la saisie dans le back-office, et
// signaler à la diversification que deux offres se ressemblent.
export const COMPETENCES = [
  // --- Numérique -----------------------------------------------------------
  { code: 'BUREAUTIQUE', category: 'Numérique', labelFr: 'Bureautique (traitement de texte, tableur)', labelEn: 'Office software (word processing, spreadsheets)', labelEs: 'Ofimática', labelAr: 'برمجيات مكتبية', labelPt: 'Informática de escritório' },
  { code: 'EXCEL', category: 'Numérique', labelFr: 'Tableur avancé (Excel)', labelEn: 'Advanced spreadsheets (Excel)', labelEs: 'Hoja de cálculo avanzada (Excel)', labelAr: 'جداول بيانات متقدمة', labelPt: 'Folha de cálculo avançada (Excel)' },
  { code: 'JAVASCRIPT', category: 'Numérique', labelFr: 'JavaScript', labelEn: 'JavaScript', labelEs: 'JavaScript', labelAr: 'جافاسكريبت', labelPt: 'JavaScript' },
  { code: 'PYTHON', category: 'Numérique', labelFr: 'Python', labelEn: 'Python', labelEs: 'Python', labelAr: 'بايثون', labelPt: 'Python' },
  { code: 'PHP', category: 'Numérique', labelFr: 'PHP', labelEn: 'PHP', labelEs: 'PHP', labelAr: 'PHP', labelPt: 'PHP' },
  { code: 'JAVA', category: 'Numérique', labelFr: 'Java', labelEn: 'Java', labelEs: 'Java', labelAr: 'جافا', labelPt: 'Java' },
  { code: 'SQL', category: 'Numérique', labelFr: 'Bases de données SQL', labelEn: 'SQL databases', labelEs: 'Bases de datos SQL', labelAr: 'قواعد بيانات SQL', labelPt: 'Bases de dados SQL' },
  { code: 'REACT', category: 'Numérique', labelFr: 'React', labelEn: 'React', labelEs: 'React', labelAr: 'React', labelPt: 'React' },
  { code: 'WORDPRESS', category: 'Numérique', labelFr: 'WordPress', labelEn: 'WordPress', labelEs: 'WordPress', labelAr: 'ووردبريس', labelPt: 'WordPress' },
  { code: 'RESEAUX_INFORMATIQUES', category: 'Numérique', labelFr: 'Réseaux informatiques', labelEn: 'Computer networks', labelEs: 'Redes informáticas', labelAr: 'شبكات حاسوبية', labelPt: 'Redes informáticas' },
  { code: 'MAINTENANCE_INFORMATIQUE', category: 'Numérique', labelFr: 'Maintenance informatique', labelEn: 'IT maintenance', labelEs: 'Mantenimiento informático', labelAr: 'صيانة الحاسوب', labelPt: 'Manutenção informática' },
  { code: 'CYBERSECURITE_BASE', category: 'Numérique', labelFr: 'Bases de la cybersécurité', labelEn: 'Cybersecurity fundamentals', labelEs: 'Fundamentos de ciberseguridad', labelAr: 'أساسيات الأمن السيبراني', labelPt: 'Fundamentos de cibersegurança' },
  { code: 'ANALYSE_DONNEES', category: 'Numérique', labelFr: 'Analyse de données', labelEn: 'Data analysis', labelEs: 'Análisis de datos', labelAr: 'تحليل البيانات', labelPt: 'Análise de dados' },

  // --- Création ------------------------------------------------------------
  { code: 'DESIGN_GRAPHIQUE', category: 'Création', labelFr: 'Design graphique', labelEn: 'Graphic design', labelEs: 'Diseño gráfico', labelAr: 'التصميم الجرافيكي', labelPt: 'Design gráfico' },
  { code: 'PHOTOSHOP', category: 'Création', labelFr: 'Retouche photo (Photoshop)', labelEn: 'Photo editing (Photoshop)', labelEs: 'Edición fotográfica (Photoshop)', labelAr: 'تحرير الصور', labelPt: 'Edição de imagem (Photoshop)' },
  { code: 'MONTAGE_VIDEO', category: 'Création', labelFr: 'Montage vidéo', labelEn: 'Video editing', labelEs: 'Edición de vídeo', labelAr: 'مونتاج الفيديو', labelPt: 'Edição de vídeo' },
  { code: 'PHOTOGRAPHIE', category: 'Création', labelFr: 'Photographie', labelEn: 'Photography', labelEs: 'Fotografía', labelAr: 'التصوير الفوتوغرافي', labelPt: 'Fotografia' },
  { code: 'DESIGN_UI_UX', category: 'Création', labelFr: 'Conception d’interfaces (UI/UX)', labelEn: 'Interface design (UI/UX)', labelEs: 'Diseño de interfaces (UI/UX)', labelAr: 'تصميم الواجهات', labelPt: 'Design de interfaces (UI/UX)' },
  { code: 'CAO_DAO', category: 'Création', labelFr: 'Dessin assisté par ordinateur (CAO/DAO)', labelEn: 'Computer-aided design (CAD)', labelEs: 'Diseño asistido por ordenador (CAD)', labelAr: 'التصميم بمساعدة الحاسوب', labelPt: 'Desenho assistido por computador (CAD)' },

  // --- Langues -------------------------------------------------------------
  { code: 'FRANCAIS', category: 'Langues', labelFr: 'Français', labelEn: 'French', labelEs: 'Francés', labelAr: 'الفرنسية', labelPt: 'Francês' },
  { code: 'ANGLAIS', category: 'Langues', labelFr: 'Anglais', labelEn: 'English', labelEs: 'Inglés', labelAr: 'الإنجليزية', labelPt: 'Inglês' },
  { code: 'ESPAGNOL', category: 'Langues', labelFr: 'Espagnol', labelEn: 'Spanish', labelEs: 'Español', labelAr: 'الإسبانية', labelPt: 'Espanhol' },
  { code: 'ARABE', category: 'Langues', labelFr: 'Arabe', labelEn: 'Arabic', labelEs: 'Árabe', labelAr: 'العربية', labelPt: 'Árabe' },
  { code: 'PORTUGAIS', category: 'Langues', labelFr: 'Portugais', labelEn: 'Portuguese', labelEs: 'Portugués', labelAr: 'البرتغالية', labelPt: 'Português' },

  // --- Gestion -------------------------------------------------------------
  { code: 'COMPTABILITE', category: 'Gestion', labelFr: 'Comptabilité générale', labelEn: 'General accounting', labelEs: 'Contabilidad general', labelAr: 'المحاسبة العامة', labelPt: 'Contabilidade geral' },
  { code: 'COMPTABILITE_OHADA', category: 'Gestion', labelFr: 'Comptabilité OHADA (SYSCOHADA)', labelEn: 'OHADA accounting (SYSCOHADA)', labelEs: 'Contabilidad OHADA', labelAr: 'محاسبة أوهادا', labelPt: 'Contabilidade OHADA' },
  { code: 'GESTION_STOCK', category: 'Gestion', labelFr: 'Gestion des stocks', labelEn: 'Stock management', labelEs: 'Gestión de existencias', labelAr: 'تسيير المخزون', labelPt: 'Gestão de stocks' },
  { code: 'GESTION_PROJET', category: 'Gestion', labelFr: 'Gestion de projet', labelEn: 'Project management', labelEs: 'Gestión de proyectos', labelAr: 'إدارة المشاريع', labelPt: 'Gestão de projetos' },
  { code: 'GESTION_RH', category: 'Gestion', labelFr: 'Gestion des ressources humaines', labelEn: 'Human resources management', labelEs: 'Gestión de recursos humanos', labelAr: 'تسيير الموارد البشرية', labelPt: 'Gestão de recursos humanos' },
  { code: 'PAIE', category: 'Gestion', labelFr: 'Gestion de la paie', labelEn: 'Payroll management', labelEs: 'Gestión de nóminas', labelAr: 'تسيير الأجور', labelPt: 'Processamento salarial' },
  { code: 'SECRETARIAT', category: 'Gestion', labelFr: 'Secrétariat et accueil', labelEn: 'Secretarial and front-desk work', labelEs: 'Secretariado y recepción', labelAr: 'السكرتارية والاستقبال', labelPt: 'Secretariado e receção' },
  { code: 'REDACTION_ADMINISTRATIVE', category: 'Gestion', labelFr: 'Rédaction administrative', labelEn: 'Administrative writing', labelEs: 'Redacción administrativa', labelAr: 'التحرير الإداري', labelPt: 'Redação administrativa' },
  { code: 'SUIVI_EVALUATION', category: 'Gestion', labelFr: 'Suivi et évaluation de projet', labelEn: 'Monitoring and evaluation', labelEs: 'Seguimiento y evaluación', labelAr: 'المتابعة والتقييم', labelPt: 'Monitorização e avaliação' },
  { code: 'DROIT_TRAVAIL', category: 'Gestion', labelFr: 'Droit du travail', labelEn: 'Employment law', labelEs: 'Derecho laboral', labelAr: 'قانون الشغل', labelPt: 'Direito do trabalho' },

  // --- Commerce ------------------------------------------------------------
  { code: 'VENTE', category: 'Commerce', labelFr: 'Techniques de vente', labelEn: 'Sales techniques', labelEs: 'Técnicas de venta', labelAr: 'تقنيات البيع', labelPt: 'Técnicas de venda' },
  { code: 'NEGOCIATION', category: 'Commerce', labelFr: 'Négociation commerciale', labelEn: 'Commercial negotiation', labelEs: 'Negociación comercial', labelAr: 'التفاوض التجاري', labelPt: 'Negociação comercial' },
  { code: 'RELATION_CLIENT', category: 'Commerce', labelFr: 'Relation client', labelEn: 'Customer relations', labelEs: 'Atención al cliente', labelAr: 'العلاقة مع الزبون', labelPt: 'Relação com o cliente' },
  { code: 'MARKETING_DIGITAL', category: 'Commerce', labelFr: 'Marketing digital', labelEn: 'Digital marketing', labelEs: 'Marketing digital', labelAr: 'التسويق الرقمي', labelPt: 'Marketing digital' },
  { code: 'RESEAUX_SOCIAUX', category: 'Commerce', labelFr: 'Animation de réseaux sociaux', labelEn: 'Social media management', labelEs: 'Gestión de redes sociales', labelAr: 'إدارة الشبكات الاجتماعية', labelPt: 'Gestão de redes sociais' },
  { code: 'CAISSE', category: 'Commerce', labelFr: 'Tenue de caisse', labelEn: 'Till operation', labelEs: 'Manejo de caja', labelAr: 'إدارة الصندوق', labelPt: 'Operação de caixa' },
  { code: 'MERCHANDISING', category: 'Commerce', labelFr: 'Merchandising', labelEn: 'Merchandising', labelEs: 'Merchandising', labelAr: 'التسويق البصري', labelPt: 'Merchandising' },

  // --- Technique -----------------------------------------------------------
  { code: 'ELECTRICITE', category: 'Technique', labelFr: 'Électricité', labelEn: 'Electrical work', labelEs: 'Electricidad', labelAr: 'الكهرباء', labelPt: 'Eletricidade' },
  { code: 'PLOMBERIE', category: 'Technique', labelFr: 'Plomberie', labelEn: 'Plumbing', labelEs: 'Fontanería', labelAr: 'السباكة', labelPt: 'Canalização' },
  { code: 'MACONNERIE', category: 'Technique', labelFr: 'Maçonnerie', labelEn: 'Masonry', labelEs: 'Albañilería', labelAr: 'البناء', labelPt: 'Alvenaria' },
  { code: 'SOUDURE', category: 'Technique', labelFr: 'Soudure', labelEn: 'Welding', labelEs: 'Soldadura', labelAr: 'اللحام', labelPt: 'Soldadura' },
  { code: 'MENUISERIE', category: 'Technique', labelFr: 'Menuiserie', labelEn: 'Carpentry', labelEs: 'Carpintería', labelAr: 'النجارة', labelPt: 'Carpintaria' },
  { code: 'MECANIQUE_AUTO', category: 'Technique', labelFr: 'Mécanique automobile', labelEn: 'Motor mechanics', labelEs: 'Mecánica del automóvil', labelAr: 'ميكانيك السيارات', labelPt: 'Mecânica automóvel' },
  { code: 'FROID_CLIM', category: 'Technique', labelFr: 'Froid et climatisation', labelEn: 'Refrigeration and air conditioning', labelEs: 'Frío y climatización', labelAr: 'التبريد والتكييف', labelPt: 'Frio e climatização' },
  { code: 'ENERGIE_SOLAIRE', category: 'Technique', labelFr: 'Installation solaire photovoltaïque', labelEn: 'Solar photovoltaic installation', labelEs: 'Instalación solar fotovoltaica', labelAr: 'تركيب الطاقة الشمسية', labelPt: 'Instalação solar fotovoltaica' },
  { code: 'TOPOGRAPHIE', category: 'Technique', labelFr: 'Topographie', labelEn: 'Surveying', labelEs: 'Topografía', labelAr: 'المساحة', labelPt: 'Topografia' },
  { code: 'MAINTENANCE_INDUSTRIELLE', category: 'Technique', labelFr: 'Maintenance industrielle', labelEn: 'Industrial maintenance', labelEs: 'Mantenimiento industrial', labelAr: 'الصيانة الصناعية', labelPt: 'Manutenção industrial' },
  { code: 'QHSE', category: 'Technique', labelFr: 'Qualité, hygiène, sécurité, environnement (QHSE)', labelEn: 'Quality, health, safety and environment (QHSE)', labelEs: 'Calidad, higiene, seguridad y medio ambiente', labelAr: 'الجودة والصحة والسلامة والبيئة', labelPt: 'Qualidade, higiene, segurança e ambiente' },
  { code: 'CONDUITE', category: 'Technique', labelFr: 'Conduite (permis)', labelEn: 'Driving (licence)', labelEs: 'Conducción (permiso)', labelAr: 'القيادة (رخصة)', labelPt: 'Condução (carta)' },

  // --- Agriculture ---------------------------------------------------------
  { code: 'CULTURE_MARAICHERE', category: 'Agriculture', labelFr: 'Culture maraîchère', labelEn: 'Market gardening', labelEs: 'Horticultura', labelAr: 'زراعة الخضروات', labelPt: 'Horticultura' },
  { code: 'ELEVAGE', category: 'Agriculture', labelFr: 'Élevage', labelEn: 'Animal husbandry', labelEs: 'Ganadería', labelAr: 'تربية الماشية', labelPt: 'Criação de animais' },
  { code: 'AVICULTURE', category: 'Agriculture', labelFr: 'Aviculture', labelEn: 'Poultry farming', labelEs: 'Avicultura', labelAr: 'تربية الدواجن', labelPt: 'Avicultura' },
  { code: 'PISCICULTURE', category: 'Agriculture', labelFr: 'Pisciculture', labelEn: 'Fish farming', labelEs: 'Piscicultura', labelAr: 'تربية الأسماك', labelPt: 'Piscicultura' },
  { code: 'TRANSFORMATION_ALIMENTAIRE', category: 'Agriculture', labelFr: 'Transformation alimentaire', labelEn: 'Food processing', labelEs: 'Transformación alimentaria', labelAr: 'التحويل الغذائي', labelPt: 'Transformação alimentar' },
  { code: 'AGRICULTURE_BIO', category: 'Agriculture', labelFr: 'Agriculture biologique', labelEn: 'Organic farming', labelEs: 'Agricultura ecológica', labelAr: 'الزراعة العضوية', labelPt: 'Agricultura biológica' },
  { code: 'IRRIGATION', category: 'Agriculture', labelFr: 'Techniques d’irrigation', labelEn: 'Irrigation techniques', labelEs: 'Técnicas de riego', labelAr: 'تقنيات الري', labelPt: 'Técnicas de irrigação' },

  // --- Santé ---------------------------------------------------------------
  { code: 'SOINS_INFIRMIERS', category: 'Santé', labelFr: 'Soins infirmiers', labelEn: 'Nursing care', labelEs: 'Cuidados de enfermería', labelAr: 'الرعاية التمريضية', labelPt: 'Cuidados de enfermagem' },
  { code: 'PREMIERS_SECOURS', category: 'Santé', labelFr: 'Premiers secours', labelEn: 'First aid', labelEs: 'Primeros auxilios', labelAr: 'الإسعافات الأولية', labelPt: 'Primeiros socorros' },
  { code: 'ANALYSE_MEDICALE', category: 'Santé', labelFr: 'Analyses médicales', labelEn: 'Medical laboratory analysis', labelEs: 'Análisis clínicos', labelAr: 'التحاليل الطبية', labelPt: 'Análises clínicas' },
  { code: 'HYGIENE_HOSPITALIERE', category: 'Santé', labelFr: 'Hygiène hospitalière', labelEn: 'Hospital hygiene', labelEs: 'Higiene hospitalaria', labelAr: 'النظافة الاستشفائية', labelPt: 'Higiene hospitalar' },
  { code: 'SENSIBILISATION_SANTE', category: 'Santé', labelFr: 'Sensibilisation communautaire en santé', labelEn: 'Community health outreach', labelEs: 'Sensibilización comunitaria en salud', labelAr: 'التوعية الصحية المجتمعية', labelPt: 'Sensibilização comunitária em saúde' },

  // --- Hôtellerie ----------------------------------------------------------
  { code: 'CUISINE', category: 'Hôtellerie', labelFr: 'Cuisine', labelEn: 'Cooking', labelEs: 'Cocina', labelAr: 'الطبخ', labelPt: 'Cozinha' },
  { code: 'PATISSERIE', category: 'Hôtellerie', labelFr: 'Pâtisserie et boulangerie', labelEn: 'Pastry and baking', labelEs: 'Pastelería y panadería', labelAr: 'الحلويات والخبز', labelPt: 'Pastelaria e panificação' },
  { code: 'SERVICE_TABLE', category: 'Hôtellerie', labelFr: 'Service en salle', labelEn: 'Table service', labelEs: 'Servicio de sala', labelAr: 'خدمة الطاولات', labelPt: 'Serviço de mesa' },
  { code: 'HYGIENE_ALIMENTAIRE', category: 'Hôtellerie', labelFr: 'Hygiène alimentaire (HACCP)', labelEn: 'Food hygiene (HACCP)', labelEs: 'Higiene alimentaria (HACCP)', labelAr: 'سلامة الأغذية', labelPt: 'Higiene alimentar (HACCP)' },
  { code: 'ACCUEIL_HOTELIER', category: 'Hôtellerie', labelFr: 'Accueil et réception', labelEn: 'Front desk and reception', labelEs: 'Recepción hotelera', labelAr: 'الاستقبال الفندقي', labelPt: 'Receção hoteleira' },

  // --- Artisanat -----------------------------------------------------------
  { code: 'COUTURE', category: 'Artisanat', labelFr: 'Couture', labelEn: 'Sewing', labelEs: 'Costura', labelAr: 'الخياطة', labelPt: 'Costura' },
  { code: 'STYLISME', category: 'Artisanat', labelFr: 'Stylisme et modélisme', labelEn: 'Fashion design and pattern making', labelEs: 'Diseño y patronaje de moda', labelAr: 'تصميم الأزياء', labelPt: 'Estilismo e modelagem' },
  { code: 'COIFFURE', category: 'Artisanat', labelFr: 'Coiffure', labelEn: 'Hairdressing', labelEs: 'Peluquería', labelAr: 'الحلاقة', labelPt: 'Cabeleireiro' },
  { code: 'ESTHETIQUE', category: 'Artisanat', labelFr: 'Esthétique et soins du corps', labelEn: 'Beauty and body care', labelEs: 'Estética y cuidado corporal', labelAr: 'التجميل والعناية بالجسم', labelPt: 'Estética e cuidados corporais' },
  { code: 'ARTISANAT_LOCAL', category: 'Artisanat', labelFr: 'Artisanat local (vannerie, sculpture, perlage)', labelEn: 'Local crafts (basketry, carving, beadwork)', labelEs: 'Artesanía local', labelAr: 'الحرف المحلية', labelPt: 'Artesanato local' },

  // --- Transversal ---------------------------------------------------------
  //
  // Les compétences que tout le monde revendique et que personne ne définit.
  // Elles ont leur place : beaucoup d'offres pour jeunes débutants ne
  // demandent rien d'autre, et ne pas les proposer obligerait le recruteur à
  // laisser le champ vide — ce qui rend l'offre inclassable.
  { code: 'TRAVAIL_EQUIPE', category: 'Transversal', labelFr: 'Travail en équipe', labelEn: 'Teamwork', labelEs: 'Trabajo en equipo', labelAr: 'العمل الجماعي', labelPt: 'Trabalho em equipa' },
  { code: 'COMMUNICATION_ORALE', category: 'Transversal', labelFr: 'Communication orale', labelEn: 'Oral communication', labelEs: 'Comunicación oral', labelAr: 'التواصل الشفوي', labelPt: 'Comunicação oral' },
  { code: 'ORGANISATION', category: 'Transversal', labelFr: 'Organisation et rigueur', labelEn: 'Organisation and rigour', labelEs: 'Organización y rigor', labelAr: 'التنظيم والدقة', labelPt: 'Organização e rigor' },
  { code: 'AUTONOMIE', category: 'Transversal', labelFr: 'Autonomie', labelEn: 'Autonomy', labelEs: 'Autonomía', labelAr: 'الاستقلالية', labelPt: 'Autonomia' },
  { code: 'ADAPTABILITE', category: 'Transversal', labelFr: 'Adaptabilité', labelEn: 'Adaptability', labelEs: 'Adaptabilidad', labelAr: 'القدرة على التكيّف', labelPt: 'Adaptabilidade' },
  { code: 'RESOLUTION_PROBLEMES', category: 'Transversal', labelFr: 'Résolution de problèmes', labelEn: 'Problem solving', labelEs: 'Resolución de problemas', labelAr: 'حل المشكلات', labelPt: 'Resolução de problemas' },
];

// --- SYNONYMES --------------------------------------------------------------
//
// `terme` est la forme telle qu'on la tape ; le script la normalise avant de
// l'écrire (minuscules, sans accent, sans ponctuation). `canonical` est ce qui
// sera cherché en plus. `skill` ou `occupation` rattache le synonyme au
// référentiel — c'est la moitié la plus utile : une offre étiquetée
// « JavaScript » remonte alors pour « JS » même si son texte ne contient ni
// l'un ni l'autre.
export const SYNONYMES = [
  // --- Abréviations françaises courantes -----------------------------------
  { terme: 'RH', canonical: 'ressources humaines', skill: 'GESTION_RH' },
  { terme: 'GRH', canonical: 'gestion des ressources humaines', skill: 'GESTION_RH' },
  { terme: 'BTP', canonical: 'bâtiment travaux publics' },
  { terme: 'TP', canonical: 'travaux publics' },
  { terme: 'compta', canonical: 'comptabilité', skill: 'COMPTABILITE' },
  { terme: 'info', canonical: 'informatique' },
  { terme: 'élec', canonical: 'électricité', skill: 'ELECTRICITE' },
  { terme: 'méca', canonical: 'mécanique', skill: 'MECANIQUE_AUTO' },
  { terme: 'resto', canonical: 'restauration' },
  { terme: 'clim', canonical: 'climatisation', skill: 'FROID_CLIM' },
  { terme: 'QHSE', canonical: 'qualité hygiène sécurité environnement', skill: 'QHSE' },
  { terme: 'HSE', canonical: 'hygiène sécurité environnement', skill: 'QHSE' },
  { terme: 'CAO', canonical: 'conception assistée par ordinateur', skill: 'CAO_DAO' },
  { terme: 'DAO', canonical: 'dessin assisté par ordinateur', skill: 'CAO_DAO' },
  { terme: 'SIG', canonical: 'système d’information géographique' },
  { terme: 'ONG', canonical: 'organisation non gouvernementale' },
  { terme: 'PME', canonical: 'petite et moyenne entreprise' },
  { terme: 'com', canonical: 'communication' },
  { terme: 'admin', canonical: 'administration' },
  { terme: 'secrétariat', canonical: 'secrétaire', occupation: 'SECRETAIRE' },

  // --- Anglais → français --------------------------------------------------
  //
  // LE CAS LE PLUS IMPORTANT DE CETTE TABLE. Le Cameroun est bilingue : un
  // candidat de Bamenda ou Buea cherche en anglais, l'offre de Douala est
  // rédigée en français. Sans ces entrées, il conclut qu'il n'y a pas d'offre.
  { terme: 'developer', canonical: 'développeur', occupation: 'DEV_WEB' },
  { terme: 'software developer', canonical: 'développeur', occupation: 'DEV_WEB' },
  { terme: 'web developer', canonical: 'développeur web', occupation: 'DEV_WEB' },
  { terme: 'accountant', canonical: 'comptable', occupation: 'COMPTABLE' },
  { terme: 'accounting', canonical: 'comptabilité', skill: 'COMPTABILITE' },
  { terme: 'nurse', canonical: 'infirmier', occupation: 'INFIRMIER' },
  { terme: 'nursing', canonical: 'soins infirmiers', skill: 'SOINS_INFIRMIERS' },
  { terme: 'teacher', canonical: 'enseignant', occupation: 'ENSEIGNANT_SECONDAIRE' },
  { terme: 'driver', canonical: 'chauffeur', occupation: 'CHAUFFEUR' },
  { terme: 'sales', canonical: 'vente', skill: 'VENTE' },
  { terme: 'salesman', canonical: 'commercial', occupation: 'COMMERCIAL' },
  { terme: 'cashier', canonical: 'caissier', occupation: 'CAISSIER' },
  { terme: 'secretary', canonical: 'secrétaire', occupation: 'SECRETAIRE' },
  { terme: 'engineer', canonical: 'ingénieur' },
  { terme: 'welder', canonical: 'soudeur', occupation: 'SOUDEUR' },
  { terme: 'plumber', canonical: 'plombier', occupation: 'PLOMBIER' },
  { terme: 'electrician', canonical: 'électricien', occupation: 'ELECTRICIEN_BATIMENT' },
  { terme: 'mason', canonical: 'maçon', occupation: 'MACON' },
  { terme: 'carpenter', canonical: 'menuisier', occupation: 'MENUISIER' },
  { terme: 'mechanic', canonical: 'mécanicien', occupation: 'MECANICIEN' },
  { terme: 'tailor', canonical: 'couturier', occupation: 'COUTURIER' },
  { terme: 'hairdresser', canonical: 'coiffeur', occupation: 'COIFFEUR' },
  { terme: 'cook', canonical: 'cuisinier', occupation: 'CUISINIER' },
  { terme: 'chef', canonical: 'cuisinier', occupation: 'CUISINIER' },
  { terme: 'waiter', canonical: 'serveur', occupation: 'SERVEUR' },
  { terme: 'receptionist', canonical: 'réceptionniste', occupation: 'RECEPTIONNISTE' },
  { terme: 'farmer', canonical: 'agriculteur', occupation: 'AGRICULTEUR' },
  { terme: 'journalist', canonical: 'journaliste', occupation: 'JOURNALISTE' },
  { terme: 'lawyer', canonical: 'juriste', occupation: 'JURISTE' },
  { terme: 'architect', canonical: 'architecte', occupation: 'ARCHITECTE' },
  { terme: 'pharmacist', canonical: 'pharmacien', occupation: 'PHARMACIEN' },
  { terme: 'midwife', canonical: 'sage-femme', occupation: 'SAGE_FEMME' },
  { terme: 'social worker', canonical: 'travailleur social', occupation: 'TRAVAILLEUR_SOCIAL' },
  { terme: 'project manager', canonical: 'chef de projet', occupation: 'CHEF_PROJET' },
  { terme: 'human resources', canonical: 'ressources humaines', skill: 'GESTION_RH' },
  { terme: 'internship', canonical: 'stage' },
  { terme: 'trainee', canonical: 'stagiaire' },
  { terme: 'apprenticeship', canonical: 'apprentissage' },
  { terme: 'part time', canonical: 'temps partiel' },
  { terme: 'full time', canonical: 'temps plein' },
  { terme: 'remote', canonical: 'télétravail à distance' },
  { terme: 'call center', canonical: 'centre d’appels', occupation: 'TELEVENDEUR' },
  { terme: 'customer service', canonical: 'relation client', skill: 'RELATION_CLIENT' },
  { terme: 'warehouse', canonical: 'magasinier entrepôt', occupation: 'MAGASINIER' },
  { terme: 'logistics', canonical: 'logistique' },
  { terme: 'marketing', canonical: 'marketing', skill: 'MARKETING_DIGITAL' },
  { terme: 'graphic designer', canonical: 'graphiste', occupation: 'GRAPHISTE' },
  { terme: 'data analyst', canonical: 'analyste de données', occupation: 'DATA_ANALYST' },
  { terme: 'IT support', canonical: 'maintenance informatique', skill: 'MAINTENANCE_INFORMATIQUE' },
  { terme: 'network', canonical: 'réseaux informatiques', skill: 'RESEAUX_INFORMATIQUES' },
  { terme: 'first aid', canonical: 'premiers secours', skill: 'PREMIERS_SECOURS' },
  { terme: 'teamwork', canonical: 'travail en équipe', skill: 'TRAVAIL_EQUIPE' },

  // --- Technologies : sigles et variantes ----------------------------------
  { terme: 'JS', canonical: 'JavaScript', skill: 'JAVASCRIPT' },
  { terme: 'node', canonical: 'JavaScript', skill: 'JAVASCRIPT' },
  { terme: 'nodejs', canonical: 'JavaScript', skill: 'JAVASCRIPT' },
  { terme: 'reactjs', canonical: 'React', skill: 'REACT' },
  { terme: 'py', canonical: 'Python', skill: 'PYTHON' },
  { terme: 'BD', canonical: 'base de données', skill: 'SQL' },
  { terme: 'BDD', canonical: 'base de données', skill: 'SQL' },
  { terme: 'database', canonical: 'base de données', skill: 'SQL' },
  { terme: 'postgres', canonical: 'SQL base de données', skill: 'SQL' },
  { terme: 'mysql', canonical: 'SQL base de données', skill: 'SQL' },
  { terme: 'photoshop', canonical: 'retouche photo', skill: 'PHOTOSHOP' },
  { terme: 'excel', canonical: 'tableur', skill: 'EXCEL' },
  { terme: 'word', canonical: 'bureautique traitement de texte', skill: 'BUREAUTIQUE' },
  { terme: 'office', canonical: 'bureautique', skill: 'BUREAUTIQUE' },
  { terme: 'UI', canonical: 'conception d’interfaces', skill: 'DESIGN_UI_UX' },
  { terme: 'UX', canonical: 'conception d’interfaces', skill: 'DESIGN_UI_UX' },
  { terme: 'community manager', canonical: 'réseaux sociaux', occupation: 'COMMUNITY_MANAGER' },
  { terme: 'CM', canonical: 'community manager', occupation: 'COMMUNITY_MANAGER' },

  // --- Vocabulaire d'Afrique centrale --------------------------------------
  //
  // Ces mots sont ceux que les jeunes emploient réellement. Un référentiel qui
  // ne les connaît pas ne trouve rien quand ils cherchent — et c'est
  // précisément pour eux que la plateforme existe.
  { terme: 'benskin', canonical: 'moto-taxi', occupation: 'CONDUCTEUR_MOTOTAXI' },
  { terme: 'bendskin', canonical: 'moto-taxi', occupation: 'CONDUCTEUR_MOTOTAXI' },
  { terme: 'mototaxi', canonical: 'moto-taxi', occupation: 'CONDUCTEUR_MOTOTAXI' },
  { terme: 'okada', canonical: 'moto-taxi', occupation: 'CONDUCTEUR_MOTOTAXI' },
  { terme: 'call box', canonical: 'mobile money transfert d’argent', occupation: 'AGENT_MOBILE_MONEY' },
  { terme: 'MoMo', canonical: 'mobile money', occupation: 'AGENT_MOBILE_MONEY' },
  { terme: 'mobile money', canonical: 'mobile money', occupation: 'AGENT_MOBILE_MONEY' },
  { terme: 'OM', canonical: 'mobile money', occupation: 'AGENT_MOBILE_MONEY' },
  { terme: 'tontine', canonical: 'microfinance épargne', occupation: 'AGENT_MICROFINANCE' },
  { terme: 'EMF', canonical: 'établissement de microfinance', occupation: 'AGENT_MICROFINANCE' },
  { terme: 'boutiquier', canonical: 'vendeur commerce', occupation: 'VENDEUR' },
  { terme: 'OHADA', canonical: 'comptabilité OHADA', skill: 'COMPTABILITE_OHADA' },
  { terme: 'SYSCOHADA', canonical: 'comptabilité OHADA', skill: 'COMPTABILITE_OHADA' },
  { terme: 'champ', canonical: 'agriculture exploitation agricole', occupation: 'AGRICULTEUR' },
  { terme: 'poulailler', canonical: 'aviculture élevage', skill: 'AVICULTURE' },
  { terme: 'étang piscicole', canonical: 'pisciculture', skill: 'PISCICULTURE' },
];
