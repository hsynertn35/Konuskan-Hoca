/* KONUŞKAN hoca – tek dosyalık istemci uygulaması (saf JS, derleme gerektirmez) */
'use strict';

/* ============================== Yardımcılar ============================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('eo_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('eo_' + k, JSON.stringify(v)); } catch { /* yoksay */ } },
  del(k) { try { localStorage.removeItem('eo_' + k); } catch { /* yoksay */ } },
};
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const cleanKey = (k) => (k || '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');

const DEFAULT_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const DEFAULT_EVAL_MODEL = 'gemini-flash-lite-latest';
const API_HOST = 'https://generativelanguage.googleapis.com';

/* Model listesi: anahtarın erişebildiği modelleri sorar; eski/kapatılmış model adlarına karşı otomatik düzeltme sağlar */
async function listModels() {
  const r = await fetch(`${API_HOST}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': cleanKey(LS.get('apiKey', '') || ($('#apiKey') && $('#apiKey').value)) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'Model listesi alınamadı (' + r.status + ')');
  return j.models || [];
}
function pickEvalModel(models, speed = 'fast') {
  const verOf = (n) => ((n.match(/^gemini-([\d.]+)-flash/) || [])[1] || '0').split('.').map(Number);
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) { const d = (b[i] || 0) - (a[i] || 0); if (d) return d; } return 0; };
  const names = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  const byVer = (re) => names.filter((n) => re.test(n)).sort((a, b) => cmp(verOf(a), verOf(b)));
  const flash = byVer(/^gemini-[\d.]+-flash$/); const lite = byVer(/^gemini-[\d.]+-flash-lite$/);
  const order = speed === 'fast' ? [lite[0], flash[0]] : [flash[0], lite[0]];
  const alias = speed === 'fast' ? ['gemini-flash-lite-latest', 'gemini-flash-latest'] : ['gemini-flash-latest', 'gemini-flash-lite-latest'];
  return order.find(Boolean) || alias.find((a) => names.includes(a)) || null;
}

/* ============================== Veriler ============================== */
const BRAND = 'KONUŞKAN hoca';
const SCHOOL_LINE = 'Hekimhan Anadolu Lisesi · TÜBİTAK 4006-A Projesi';

/* Öğretilen diller. Yeni dil eklemek için buraya bir satır, konu/dil yapısı tablolarına bir sütun eklemek yeterlidir. */
const LANGS = {
  en: { id: 'en', name: 'İngilizce', eng: 'English', native: 'English', teachers: { female: 'Ms. Emma', male: 'Mr. James' }, placeholder: 'Type your answer in English…', note: '' },
  de: { id: 'de', name: 'Almanca', eng: 'German', native: 'Deutsch', teachers: { female: 'Frau Schmidt', male: 'Herr Müller' }, placeholder: 'Schreibe deine Antwort auf Deutsch…', note: 'Pay attention to articles (der/die/das), cases and verb position when correcting.' },
  fr: { id: 'fr', name: 'Fransızca', eng: 'French', native: 'Français', teachers: { female: 'Madame Dubois', male: 'Monsieur Martin' }, placeholder: 'Écris ta réponse en français…', note: 'Pay attention to gender agreement, liaison and silent letters when correcting.' },
  it: { id: 'it', name: 'İtalyanca', eng: 'Italian', native: 'Italiano', teachers: { female: 'Signora Rossi', male: 'Signor Bianchi' }, placeholder: 'Scrivi la tua risposta in italiano…', note: 'Pay attention to articles, gender agreement, double consonants and verb endings when correcting.' },
  ru: { id: 'ru', name: 'Rusça', eng: 'Russian', native: 'Русский', teachers: { female: 'Анна Ивановна', male: 'Дмитрий Петрович' }, placeholder: 'Напишите свой ответ по-русски…', note: 'Pay attention to word stress, cases, gender agreement and verb aspect when correcting.' },
  ko: { id: 'ko', name: 'Korece', eng: 'Korean', native: '한국어', teachers: { female: '김 선생님', male: '박 선생님' }, placeholder: '한국어로 답을 입력하세요…', note: 'Use the polite 해요-style (해요체) at A1–B1 and explain speech levels (존댓말 / 반말) when relevant. Pay attention to particles (은/는, 이/가, 을/를) and pronunciation of final consonants.' },
  zh: { id: 'zh', name: 'Çince', eng: 'Mandarin Chinese', native: '中文', teachers: { female: '李老师', male: '王老师' }, placeholder: '请用中文输入你的回答…', note: 'Speak Standard Mandarin (Putonghua) with simplified characters in any text. Pay close attention to the four tones, measure words and word order, and correct tone mistakes gently.' },
  ar: { id: 'ar', name: 'Arapça', eng: 'Modern Standard Arabic', native: 'العربية', dir: 'rtl', teachers: { female: 'الأستاذة ليلى', male: 'الأستاذ كريم' }, placeholder: 'اكتب إجابتك بالعربية…', note: 'Speak clear Modern Standard Arabic (Fusha). Pay attention to the pronunciation of Arabic-specific letters, gender agreement and case endings, but do not over-correct at A1–A2.' },
};
const LANG_IDS = Object.keys(LANGS);
const langOf = (id) => LANGS[id] || LANGS.en;
const teacherName = (cfg) => langOf(cfg.lang).teachers[cfg.teacherGender] || langOf(cfg.lang).teachers.female;

/* Konu: Türkçe ad + her dildeki karşılığı. Sıra: tr, en, de, fr, it, ru, ko, zh, ar */
const X = (tr, en, de, fr, it, ru, ko, zh, ar) => ({ tr, x: { en, de, fr, it, ru, ko, zh, ar } });

/* Sınıfa göre ünite konuları (MEB lise İngilizce temalarına yakın) */
const THEMES = {
  9: [
    X('Yurt Dışında Eğitim', 'Studying Abroad', 'Studieren im Ausland', 'Étudier à l’étranger', 'Studiare all’estero', 'Учёба за границей', '해외 유학', '出国留学', 'الدراسة في الخارج'),
    X('Çevrem', 'My Environment', 'Meine Umgebung', 'Mon environnement', 'Il mio ambiente', 'Моё окружение', '나의 주변 환경', '我的周围环境', 'بيئتي المحيطة'),
    X('Filmler', 'Movies', 'Filme', 'Les films', 'I film', 'Фильмы', '영화', '电影', 'الأفلام'),
    X('Doğada İnsan', 'Human in Nature', 'Der Mensch in der Natur', 'L’homme dans la nature', 'L’uomo nella natura', 'Человек и природа', '자연 속의 인간', '人与自然', 'الإنسان والطبيعة'),
    X('İlham Veren İnsanlar', 'Inspirational People', 'Inspirierende Menschen', 'Des personnes inspirantes', 'Persone che ispirano', 'Вдохновляющие люди', '영감을 주는 사람들', '激励人心的人物', 'شخصيات ملهمة'),
    X('Kültürler Arası Köprüler', 'Bridging Cultures', 'Brücken zwischen Kulturen', 'Des ponts entre les cultures', 'Ponti tra le culture', 'Мосты между культурами', '문화 간의 다리', '文化交流的桥梁', 'جسور بين الثقافات'),
    X('Dünya Mirası', 'World Heritage', 'Weltkulturerbe', 'Le patrimoine mondial', 'Il patrimonio mondiale', 'Всемирное наследие', '세계 유산', '世界遗产', 'التراث العالمي'),
    X('Acil Durumlar ve Sağlık Sorunları', 'Emergencies and Health Problems', 'Notfälle und Gesundheitsprobleme', 'Urgences et problèmes de santé', 'Emergenze e problemi di salute', 'Чрезвычайные ситуации и проблемы со здоровьем', '응급 상황과 건강 문제', '紧急情况与健康问题', 'حالات الطوارئ والمشكلات الصحية'),
    X('Fuarda', 'At the Fair', 'Auf der Messe', 'À la foire', 'Alla fiera', 'На ярмарке', '박람회에서', '在博览会上', 'في المعرض'),
  ],
  10: [
    X('Okul Hayatı', 'School Life', 'Das Schulleben', 'La vie scolaire', 'La vita scolastica', 'Школьная жизнь', '학교생활', '学校生活', 'الحياة المدرسية'),
    X('Planlar', 'Plans', 'Pläne', 'Les projets', 'I progetti', 'Планы', '계획', '计划', 'الخطط'),
    X('Efsaneler', 'Legends', 'Legenden', 'Les légendes', 'Le leggende', 'Легенды', '전설', '传说', 'الأساطير'),
    X('Seyahat', 'Travel', 'Reisen', 'Les voyages', 'I viaggi', 'Путешествия', '여행', '旅行', 'السفر'),
    X('Davetler ve Kutlamalar', 'Invitations and Celebrations', 'Einladungen und Feiern', 'Invitations et célébrations', 'Inviti e celebrazioni', 'Приглашения и праздники', '초대와 축하', '邀请与庆祝', 'الدعوات والاحتفالات'),
    X('Televizyon ve Sosyal Medya', 'Television and Social Media', 'Fernsehen und soziale Medien', 'Télévision et réseaux sociaux', 'Televisione e social media', 'Телевидение и социальные сети', '텔레비전과 소셜 미디어', '电视与社交媒体', 'التلفاز ووسائل التواصل الاجتماعي'),
    X('Festivaller ve Karnavallar', 'Festivals and Carnivals', 'Feste und Karneval', 'Festivals et carnavals', 'Festival e carnevali', 'Фестивали и карнавалы', '축제와 카니발', '节日与狂欢节', 'المهرجانات والكرنفالات'),
    X('Gezegeni Korumak', 'Protecting the Planet', 'Den Planeten schützen', 'Protéger la planète', 'Proteggere il pianeta', 'Защита планеты', '지구 보호', '保护地球', 'حماية الكوكب'),
    X('Dijital Çağ', 'The Digital Age', 'Das digitale Zeitalter', 'L’ère numérique', 'L’era digitale', 'Цифровая эпоха', '디지털 시대', '数字时代', 'العصر الرقمي'),
  ],
  11: [
    X('Geleceğin Meslekleri', 'Jobs of the Future', 'Berufe der Zukunft', 'Les métiers du futur', 'I lavori del futuro', 'Профессии будущего', '미래의 직업', '未来的职业', 'وظائف المستقبل'),
    X('Hobiler ve Beceriler', 'Hobbies and Skills', 'Hobbys und Fähigkeiten', 'Loisirs et compétences', 'Hobby e abilità', 'Хобби и навыки', '취미와 기술', '爱好与技能', 'الهوايات والمهارات'),
    X('Zor Zamanlar', 'Hard Times', 'Schwere Zeiten', 'Les temps difficiles', 'Tempi difficili', 'Трудные времена', '어려운 시기', '艰难时期', 'الأوقات الصعبة'),
    X('Ne Hayat!', 'What a Life!', 'Was für ein Leben!', 'Quelle vie !', 'Che vita!', 'Вот это жизнь!', '정말 대단한 삶!', '多么精彩的人生！', 'يا لها من حياة!'),
    X('Geçmişe Yolculuk', 'Back to the Past', 'Zurück in die Vergangenheit', 'Retour vers le passé', 'Ritorno al passato', 'Назад в прошлое', '과거로의 여행', '回到过去', 'العودة إلى الماضي'),
    X('Kalbini Aç', 'Open Your Heart', 'Öffne dein Herz', 'Ouvre ton cœur', 'Apri il tuo cuore', 'Откройте своё сердце', '마음을 열어요', '敞开心扉', 'افتح قلبك'),
    X('Türkiye Hakkında Gerçekler', 'Facts about Turkey', 'Fakten über die Türkei', 'Faits sur la Turquie', 'Fatti sulla Turchia', 'Факты о Турции', '튀르키예에 관한 사실들', '关于土耳其的事实', 'حقائق عن تركيا'),
    X('Spor', 'Sports', 'Sport', 'Le sport', 'Lo sport', 'Спорт', '스포츠', '体育运动', 'الرياضة'),
    X('Arkadaşlarım', 'My Friends', 'Meine Freunde', 'Mes amis', 'I miei amici', 'Мои друзья', '내 친구들', '我的朋友们', 'أصدقائي'),
  ],
  12: [
    X('Müzik', 'Music', 'Musik', 'La musique', 'La musica', 'Музыка', '음악', '音乐', 'الموسيقى'),
    X('Arkadaşlık', 'Friendship', 'Freundschaft', 'L’amitié', 'L’amicizia', 'Дружба', '우정', '友谊', 'الصداقة'),
    X('İnsan Hakları', 'Human Rights', 'Menschenrechte', 'Les droits de l’homme', 'I diritti umani', 'Права человека', '인권', '人权', 'حقوق الإنسان'),
    X('Yakında', 'Coming Soon', 'Bald', 'Bientôt', 'Prossimamente', 'Скоро', '곧', '即将到来', 'قريبًا'),
    X('Psikoloji', 'Psychology', 'Psychologie', 'La psychologie', 'La psicologia', 'Психология', '심리학', '心理学', 'علم النفس'),
    X('İyilikler', 'Favors', 'Gefälligkeiten', 'Rendre service', 'Fare un favore', 'Услуги и просьбы', '부탁과 호의', '帮忙与恩惠', 'المعروف والخدمات'),
    X('Haber Hikâyeleri', 'News Stories', 'Nachrichten', 'Les actualités', 'Le notizie', 'Новости', '뉴스 이야기', '新闻故事', 'الأخبار'),
    X('Alternatif Enerji', 'Alternative Energy', 'Alternative Energien', 'Les énergies alternatives', 'Le energie alternative', 'Альтернативная энергия', '대체 에너지', '替代能源', 'الطاقة البديلة'),
    X('Teknoloji ve Görgü Kuralları', 'Technology and Manners', 'Technik und Umgangsformen', 'Technologie et savoir-vivre', 'Tecnologia e buone maniere', 'Технологии и этикет', '기술과 예절', '科技与礼仪', 'التكنولوجيا وآداب السلوك'),
  ],
};

/* Genel konu kategorileri (her sınıf için) */
const TOPIC_GROUPS = [
  { title: '🏠 Günlük Hayat', items: [
    X('Kendimi Tanıtma', 'Introducing Myself', 'Sich vorstellen', 'Se présenter', 'Presentarsi', 'Рассказ о себе', '자기소개', '自我介绍', 'التعريف بنفسي'),
    X('Ailem', 'My Family', 'Meine Familie', 'Ma famille', 'La mia famiglia', 'Моя семья', '우리 가족', '我的家人', 'عائلتي'),
    X('Evim', 'My Home', 'Mein Zuhause', 'Ma maison', 'La mia casa', 'Мой дом', '우리 집', '我的家', 'منزلي'),
    X('Günlük Rutinim', 'My Daily Routine', 'Mein Tagesablauf', 'Ma routine quotidienne', 'La mia routine quotidiana', 'Мой распорядок дня', '나의 하루 일과', '我的日常作息', 'روتيني اليومي'),
    X('Yemek ve İçecek', 'Food and Drinks', 'Essen und Trinken', 'La nourriture et les boissons', 'Cibo e bevande', 'Еда и напитки', '음식과 음료', '饮食', 'الطعام والشراب'),
    X('Restoranda', 'At the Restaurant', 'Im Restaurant', 'Au restaurant', 'Al ristorante', 'В ресторане', '식당에서', '在餐厅', 'في المطعم'),
    X('Alışveriş', 'Shopping', 'Einkaufen', 'Faire les courses', 'Fare shopping', 'Покупки', '쇼핑', '购物', 'التسوق'),
    X('Hava Durumu ve Mevsimler', 'Weather and Seasons', 'Wetter und Jahreszeiten', 'La météo et les saisons', 'Meteo e stagioni', 'Погода и времена года', '날씨와 계절', '天气与季节', 'الطقس والفصول'),
    X('Giysiler ve Moda', 'Clothes and Fashion', 'Kleidung und Mode', 'Les vêtements et la mode', 'Abbigliamento e moda', 'Одежда и мода', '옷과 패션', '服装与时尚', 'الملابس والموضة'),
    X('Evcil Hayvanlar', 'Pets', 'Haustiere', 'Les animaux de compagnie', 'Gli animali domestici', 'Домашние животные', '반려동물', '宠物', 'الحيوانات الأليفة'),
  ] },
  { title: '🏫 Okul ve Eğitim', items: [
    X('Okul Günüm', 'My School Day', 'Mein Schultag', 'Ma journée d’école', 'La mia giornata a scuola', 'Мой школьный день', '나의 학교 하루', '我的校园一天', 'يومي في المدرسة'),
    X('Dersler ve Öğretmenler', 'Lessons and Teachers', 'Fächer und Lehrer', 'Les cours et les professeurs', 'Materie e insegnanti', 'Уроки и учителя', '수업과 선생님', '课程与老师', 'الدروس والمعلمون'),
    X('Sınavlar ve Çalışma Alışkanlıkları', 'Exams and Study Habits', 'Prüfungen und Lerngewohnheiten', 'Examens et habitudes d’étude', 'Esami e metodi di studio', 'Экзамены и привычки учёбы', '시험과 공부 습관', '考试与学习习惯', 'الامتحانات وعادات الدراسة'),
    X('Üniversite Hayali', 'Dreaming of University', 'Der Traum vom Studium', 'Rêver de l’université', 'Il sogno dell’università', 'Мечта об университете', '대학의 꿈', '大学梦想', 'حلم الجامعة'),
    X('Yabancı Dil Öğrenmek', 'Learning Foreign Languages', 'Fremdsprachen lernen', 'Apprendre des langues étrangères', 'Imparare le lingue straniere', 'Изучение иностранных языков', '외국어 배우기', '学习外语', 'تعلم اللغات الأجنبية'),
    X('Okul Kulüpleri', 'School Clubs', 'Schul-AGs', 'Les clubs scolaires', 'I club scolastici', 'Школьные кружки', '학교 동아리', '学校社团', 'الأندية المدرسية'),
    X('Kütüphane ve Okumak', 'The Library and Reading', 'Bibliothek und Lesen', 'La bibliothèque et la lecture', 'La biblioteca e la lettura', 'Библиотека и чтение', '도서관과 독서', '图书馆与阅读', 'المكتبة والقراءة'),
    X('Değişim Programları', 'Exchange Programs', 'Austauschprogramme', 'Les programmes d’échange', 'Programmi di scambio', 'Программы обмена', '교환 학생 프로그램', '交换项目', 'برامج التبادل الطلابي'),
  ] },
  { title: '✈️ Seyahat ve Şehir', items: [
    X('Tatil Planları', 'Holiday Plans', 'Urlaubspläne', 'Projets de vacances', 'Piani per le vacanze', 'Планы на отпуск', '휴가 계획', '假期计划', 'خطط العطلة'),
    X('Havalimanında', 'At the Airport', 'Am Flughafen', 'À l’aéroport', 'In aeroporto', 'В аэропорту', '공항에서', '在机场', 'في المطار'),
    X('Otelde', 'At the Hotel', 'Im Hotel', 'À l’hôtel', 'In albergo', 'В отеле', '호텔에서', '在酒店', 'في الفندق'),
    X('Yol Tarifi', 'Asking for Directions', 'Nach dem Weg fragen', 'Demander son chemin', 'Chiedere indicazioni', 'Как спросить дорогу', '길 묻기', '问路', 'السؤال عن الاتجاهات'),
    X('Toplu Taşıma', 'Public Transport', 'Öffentliche Verkehrsmittel', 'Les transports en commun', 'I mezzi pubblici', 'Общественный транспорт', '대중교통', '公共交通', 'وسائل النقل العام'),
    X('Şehrim', 'My City', 'Meine Stadt', 'Ma ville', 'La mia città', 'Мой город', '우리 도시', '我的城市', 'مدينتي'),
    X('Ünlü Yerler ve Turizm', 'Famous Places and Tourism', 'Berühmte Orte und Tourismus', 'Lieux célèbres et tourisme', 'Luoghi famosi e turismo', 'Известные места и туризм', '유명한 장소와 관광', '名胜古迹与旅游', 'الأماكن الشهيرة والسياحة'),
    X('Kamp ve Doğa Gezileri', 'Camping and Nature Trips', 'Camping und Naturausflüge', 'Camping et excursions dans la nature', 'Campeggio e gite nella natura', 'Кемпинг и походы', '캠핑과 자연 여행', '露营与自然之旅', 'التخييم والرحلات في الطبيعة'),
  ] },
  { title: '💪 Sağlık ve Spor', items: [
    X('Doktorda', 'At the Doctor’s', 'Beim Arzt', 'Chez le médecin', 'Dal medico', 'У врача', '병원에서', '在医院', 'عند الطبيب'),
    X('Sağlıklı Yaşam', 'Healthy Living', 'Gesund leben', 'Vivre sainement', 'Vivere sano', 'Здоровый образ жизни', '건강한 생활', '健康生活', 'الحياة الصحية'),
    X('Beslenme', 'Nutrition', 'Ernährung', 'L’alimentation', 'L’alimentazione', 'Питание', '영양', '营养', 'التغذية'),
    X('Spor ve Egzersiz', 'Sports and Exercise', 'Sport und Bewegung', 'Sport et exercice', 'Sport e esercizio fisico', 'Спорт и упражнения', '운동', '运动与锻炼', 'الرياضة والتمارين'),
    X('Takım Sporları', 'Team Sports', 'Mannschaftssport', 'Les sports d’équipe', 'Gli sport di squadra', 'Командные виды спорта', '팀 스포츠', '团队运动', 'الرياضات الجماعية'),
    X('Uyku ve Stres', 'Sleep and Stress', 'Schlaf und Stress', 'Sommeil et stress', 'Sonno e stress', 'Сон и стресс', '수면과 스트레스', '睡眠与压力', 'النوم والتوتر'),
    X('Olimpiyatlar', 'The Olympic Games', 'Die Olympischen Spiele', 'Les Jeux olympiques', 'I Giochi olimpici', 'Олимпийские игры', '올림픽', '奥运会', 'الألعاب الأولمبية'),
    X('Ruh Sağlığı', 'Mental Health', 'Psychische Gesundheit', 'La santé mentale', 'La salute mentale', 'Психическое здоровье', '정신 건강', '心理健康', 'الصحة النفسية'),
  ] },
  { title: '💻 Teknoloji ve Medya', items: [
    X('Akıllı Telefonlar', 'Smartphones', 'Smartphones', 'Les smartphones', 'Gli smartphone', 'Смартфоны', '스마트폰', '智能手机', 'الهواتف الذكية'),
    X('İnternet ve Güvenlik', 'The Internet and Safety', 'Internet und Sicherheit', 'Internet et sécurité', 'Internet e sicurezza', 'Интернет и безопасность', '인터넷과 안전', '互联网与安全', 'الإنترنت والأمان'),
    X('Yapay Zekâ', 'Artificial Intelligence', 'Künstliche Intelligenz', 'L’intelligence artificielle', 'L’intelligenza artificiale', 'Искусственный интеллект', '인공지능', '人工智能', 'الذكاء الاصطناعي'),
    X('Video Oyunları', 'Video Games', 'Videospiele', 'Les jeux vidéo', 'I videogiochi', 'Видеоигры', '비디오 게임', '电子游戏', 'ألعاب الفيديو'),
    X('Sosyal Medya Kullanımı', 'Using Social Media', 'Nutzung sozialer Medien', 'L’usage des réseaux sociaux', 'L’uso dei social media', 'Использование соцсетей', '소셜 미디어 사용', '使用社交媒体', 'استخدام وسائل التواصل الاجتماعي'),
    X('Robotlar ve Gelecek', 'Robots and the Future', 'Roboter und die Zukunft', 'Les robots et l’avenir', 'I robot e il futuro', 'Роботы и будущее', '로봇과 미래', '机器人与未来', 'الروبوتات والمستقبل'),
    X('Haber Okuryazarlığı', 'News Literacy', 'Nachrichtenkompetenz', 'L’éducation aux médias', 'Alfabetizzazione mediatica', 'Медиаграмотность', '뉴스 리터러시', '新闻素养', 'الثقافة الإخبارية'),
    X('Uzay ve Keşifler', 'Space and Discoveries', 'Weltraum und Entdeckungen', 'L’espace et les découvertes', 'Lo spazio e le scoperte', 'Космос и открытия', '우주와 발견', '太空与发现', 'الفضاء والاكتشافات'),
  ] },
  { title: '🎨 Kültür, Sanat ve Eğlence', items: [
    X('Müzik Zevkim', 'My Taste in Music', 'Mein Musikgeschmack', 'Mes goûts musicaux', 'I miei gusti musicali', 'Мои музыкальные предпочтения', '나의 음악 취향', '我的音乐品味', 'ذوقي الموسيقي'),
    X('Kitaplar ve Yazarlar', 'Books and Authors', 'Bücher und Autoren', 'Livres et auteurs', 'Libri e autori', 'Книги и писатели', '책과 작가', '书籍与作家', 'الكتب والمؤلفون'),
    X('Sinema ve Diziler', 'Cinema and TV Series', 'Kino und Serien', 'Cinéma et séries', 'Cinema e serie TV', 'Кино и сериалы', '영화와 드라마', '电影与电视剧', 'السينما والمسلسلات'),
    X('Resim ve Sanat', 'Painting and Art', 'Malerei und Kunst', 'La peinture et l’art', 'Pittura e arte', 'Живопись и искусство', '그림과 예술', '绘画与艺术', 'الرسم والفن'),
    X('Tiyatro ve Sahne', 'Theatre and Stage', 'Theater und Bühne', 'Le théâtre et la scène', 'Teatro e palcoscenico', 'Театр и сцена', '연극과 무대', '戏剧与舞台', 'المسرح والعروض'),
    X('Geleneksel Türk Kültürü', 'Traditional Turkish Culture', 'Traditionelle türkische Kultur', 'La culture turque traditionnelle', 'La cultura tradizionale turca', 'Традиционная турецкая культура', '전통 튀르키예 문화', '土耳其传统文化', 'الثقافة التركية التقليدية'),
    X('Bayramlar ve Gelenekler', 'Holidays and Traditions', 'Feiertage und Traditionen', 'Fêtes et traditions', 'Feste e tradizioni', 'Праздники и традиции', '명절과 전통', '节日与传统', 'الأعياد والتقاليد'),
    X('Türk Mutfağı', 'Turkish Cuisine', 'Die türkische Küche', 'La cuisine turque', 'La cucina turca', 'Турецкая кухня', '튀르키예 요리', '土耳其美食', 'المطبخ التركي'),
  ] },
  { title: '🌍 Doğa, Çevre ve Toplum', items: [
    X('İklim Değişikliği', 'Climate Change', 'Klimawandel', 'Le changement climatique', 'Il cambiamento climatico', 'Изменение климата', '기후 변화', '气候变化', 'تغيّر المناخ'),
    X('Geri Dönüşüm', 'Recycling', 'Recycling', 'Le recyclage', 'Il riciclaggio', 'Переработка отходов', '재활용', '回收利用', 'إعادة التدوير'),
    X('Nesli Tükenen Hayvanlar', 'Endangered Animals', 'Gefährdete Tierarten', 'Les animaux en danger', 'Animali in via di estinzione', 'Исчезающие животные', '멸종 위기 동물', '濒危动物', 'الحيوانات المهددة بالانقراض'),
    X('Doğal Afetler', 'Natural Disasters', 'Naturkatastrophen', 'Les catastrophes naturelles', 'I disastri naturali', 'Стихийные бедствия', '자연재해', '自然灾害', 'الكوارث الطبيعية'),
    X('Gönüllülük', 'Volunteering', 'Ehrenamt', 'Le bénévolat', 'Il volontariato', 'Волонтёрство', '자원봉사', '志愿服务', 'العمل التطوعي'),
    X('Sokak Hayvanlarına Yardım', 'Helping Stray Animals', 'Streunenden Tieren helfen', 'Aider les animaux errants', 'Aiutare gli animali randagi', 'Помощь бездомным животным', '유기동물 돕기', '帮助流浪动物', 'مساعدة الحيوانات الضالة'),
    X('Saygı ve Hoşgörü', 'Respect and Tolerance', 'Respekt und Toleranz', 'Respect et tolérance', 'Rispetto e tolleranza', 'Уважение и толерантность', '존중과 관용', '尊重与宽容', 'الاحترام والتسامح'),
    X('Kırsal ve Şehir Yaşamı', 'Rural and City Life', 'Land- und Stadtleben', 'Vie rurale et vie urbaine', 'Vita di campagna e di città', 'Жизнь в деревне и в городе', '시골 생활과 도시 생활', '乡村与城市生活', 'الحياة الريفية والحياة الحضرية'),
  ] },
  { title: '💼 Meslekler ve Gelecek', items: [
    X('Hayalimdeki Meslek', 'My Dream Job', 'Mein Traumberuf', 'Mon métier de rêve', 'Il lavoro dei miei sogni', 'Профессия моей мечты', '나의 꿈의 직업', '我理想的职业', 'وظيفة أحلامي'),
    X('İş Görüşmesi', 'A Job Interview', 'Das Vorstellungsgespräch', 'Un entretien d’embauche', 'Un colloquio di lavoro', 'Собеседование', '취업 면접', '求职面试', 'مقابلة عمل'),
    X('Girişimcilik', 'Entrepreneurship', 'Unternehmertum', 'L’entrepreneuriat', 'L’imprenditorialità', 'Предпринимательство', '창업', '创业', 'ريادة الأعمال'),
    X('Para ve Tasarruf', 'Money and Saving', 'Geld und Sparen', 'L’argent et l’épargne', 'Soldi e risparmio', 'Деньги и сбережения', '돈과 저축', '金钱与储蓄', 'المال والادخار'),
    X('Gelecekteki Hayatım', 'My Future Life', 'Mein zukünftiges Leben', 'Ma vie future', 'La mia vita futura', 'Моя будущая жизнь', '나의 미래 생활', '我未来的生活', 'حياتي المستقبلية'),
    X('Takım Çalışması', 'Teamwork', 'Teamarbeit', 'Le travail d’équipe', 'Lavorare in squadra', 'Командная работа', '팀워크', '团队合作', 'العمل الجماعي'),
    X('Liderlik', 'Leadership', 'Führung', 'Le leadership', 'La leadership', 'Лидерство', '리더십', '领导力', 'القيادة'),
    X('Başarı Hikâyeleri', 'Success Stories', 'Erfolgsgeschichten', 'Histoires de réussite', 'Storie di successo', 'Истории успеха', '성공 이야기', '成功故事', 'قصص النجاح'),
  ] },
  { title: '🤔 Tartışma ve Eleştirel Düşünme', items: [
    X('Okulda Telefon Yasağı', 'A Phone Ban at School', 'Handyverbot in der Schule', 'L’interdiction du téléphone à l’école', 'Il divieto del cellulare a scuola', 'Запрет телефонов в школе', '학교 내 휴대폰 금지', '学校禁用手机', 'حظر الهاتف في المدرسة'),
    X('Ödev Gerekli mi?', 'Is Homework Necessary?', 'Sind Hausaufgaben nötig?', 'Les devoirs sont-ils nécessaires ?', 'I compiti sono necessari?', 'Нужны ли домашние задания?', '숙제는 필요한가?', '作业有必要吗？', 'هل الواجبات المنزلية ضرورية؟'),
    X('Yapay Zekâ İşlerimizi Alır mı?', 'Will AI Take Our Jobs?', 'Nimmt die KI uns die Arbeit weg?', 'L’IA va-t-elle prendre nos emplois ?', 'L’IA ci toglierà il lavoro?', 'Заберёт ли ИИ наши рабочие места?', '인공지능이 일자리를 빼앗을까?', '人工智能会抢走我们的工作吗？', 'هل سيأخذ الذكاء الاصطناعي وظائفنا؟'),
    X('Okulda Üniforma', 'School Uniforms', 'Schuluniformen', 'L’uniforme scolaire', 'La divisa scolastica', 'Школьная форма', '교복', '校服', 'الزي المدرسي'),
    X('Şehirde mi Köyde mi Yaşamak?', 'Living in the City or the Countryside?', 'Leben in der Stadt oder auf dem Land?', 'Vivre en ville ou à la campagne ?', 'Vivere in città o in campagna?', 'Жить в городе или в деревне?', '도시와 시골, 어디서 살까?', '住在城市还是乡村？', 'العيش في المدينة أم الريف؟'),
    X('Sosyal Medyanın Artıları ve Eksileri', 'Pros and Cons of Social Media', 'Vor- und Nachteile sozialer Medien', 'Avantages et inconvénients des réseaux sociaux', 'Pro e contro dei social media', 'Плюсы и минусы соцсетей', '소셜 미디어의 장단점', '社交媒体的利与弊', 'إيجابيات وسلبيات وسائل التواصل الاجتماعي'),
    X('Başarı Nedir?', 'What Is Success?', 'Was ist Erfolg?', 'Qu’est-ce que la réussite ?', 'Che cos’è il successo?', 'Что такое успех?', '성공이란 무엇인가?', '什么是成功？', 'ما هو النجاح؟'),
    X('Mutluluğun Sırrı', 'The Secret of Happiness', 'Das Geheimnis des Glücks', 'Le secret du bonheur', 'Il segreto della felicità', 'Секрет счастья', '행복의 비결', '幸福的秘诀', 'سرّ السعادة'),
  ] },
];
const allTopics = () => [...Object.values(THEMES).flat(), ...TOPIC_GROUPS.flatMap((g) => g.items)];
const findTopic = (tr) => allTopics().find((t) => t.tr === tr) || null;

/* Dil yapıları: Türkçe ad + seçili dildeki karşılığı (null = o dilde yok). Sıra: tr, en, de, fr, it, ru, ko, zh, ar */
const G = (tr, en, de, fr, it, ru, ko, zh, ar) => ({ tr, en, de, fr, it, ru, ko, zh, ar });
const GRAMMAR = [
  G('Selamlaşma ve tanışma', 'Greetings & introductions', 'Begrüßung und Vorstellung', 'Salutations et présentations', 'Saluti e presentazioni', 'Приветствие и знакомство', '인사와 소개', '问候与自我介绍', 'التحية والتعارف'),
  G('Sayılar', 'Numbers', 'Zahlen', 'Les nombres', 'I numeri', 'Числа', '숫자', '数字', 'الأعداد'),
  G('Renkler', 'Colors', 'Farben', 'Les couleurs', 'I colori', 'Цвета', '색깔', '颜色', 'الألوان'),
  G('Zamirler', 'Pronouns', 'Pronomen', 'Les pronoms', 'I pronomi', 'Местоимения', '대명사', '代词', 'الضمائر'),
  G('“Olmak” fiili', 'The verb “to be”', 'Das Verb „sein“', 'Le verbe « être »', 'Il verbo «essere»', 'Глагол «быть»', '이다 / 있다', '动词“是”', 'الفعل «كان»'),
  G('Tanımlıklar', 'Articles: a / an / the', 'Artikel: der / die / das', 'Les articles : le / la / un / une', 'Gli articoli', null, null, null, 'أل التعريف'),
  G('Çoğul isimler', 'Plurals', 'Plural', 'Le pluriel', 'Il plurale', 'Множественное число', '복수 표현 (-들)', '复数 (们)', 'الجمع'),
  G('İyelik', 'Possessives', 'Possessivpronomen', 'Les adjectifs possessifs', 'Gli aggettivi possessivi', 'Притяжательные местоимения', '소유 표현 (의)', '所有格 (的)', 'الإضافة وضمائر الملكية'),
  G('Soru kelimeleri', 'Question words', 'Fragewörter', 'Les mots interrogatifs', 'Le parole interrogative', 'Вопросительные слова', '의문사', '疑问词', 'أدوات الاستفهام'),
  G('Yer ve zaman edatları', 'Prepositions', 'Präpositionen', 'Les prépositions', 'Le preposizioni', 'Предлоги', '위치·시간 표현', '介词与方位词', 'حروف الجر'),
  G('Olumsuz cümleler', 'Negation', 'Verneinung: nicht / kein', 'La négation : ne … pas', 'La negazione', 'Отрицание', '부정문', '否定句', 'النفي'),
  G('Geniş zaman', 'Present simple', 'Präsens', 'Le présent', 'Il presente', 'Настоящее время', '현재 시제', null, 'الفعل المضارع'),
  G('Şimdiki zaman', 'Present continuous', null, '« Être en train de »', 'Stare + gerundio', null, '-고 있다', '正在 + 动词', null),
  G('Geçmiş zaman', 'Past simple', 'Perfekt und Präteritum', 'Le passé composé', 'Il passato prossimo', 'Прошедшее время', '과거 시제', null, 'الفعل الماضي'),
  G('Gelecek zaman', 'Future: will / going to', 'Futur I', 'Le futur proche et le futur simple', 'Il futuro', 'Будущее время', '미래 시제', '将来：会 / 要', 'المستقبل'),
  G('Karşılaştırma ve üstünlük', 'Comparatives & superlatives', 'Komparativ und Superlativ', 'Le comparatif et le superlatif', 'Comparativo e superlativo', 'Сравнительная и превосходная степень', '비교 표현', '比较句', 'أفعل التفضيل'),
  G('Kip fiilleri', 'Modals: can, must, should', 'Modalverben', 'Les verbes modaux', 'I verbi modali', 'Модальные глаголы', '능력·의무 표현', '能愿动词', 'التعبير عن القدرة والوجوب'),
  G('Miktar ifadeleri', 'Countable / uncountable', 'Mengenangaben', 'Les articles partitifs', 'Gli articoli partitivi', 'Выражение количества', '수량 표현', '量词', 'العدد والمعدود'),
  G('Sonucu şimdiye uzanan geçmiş', 'Present perfect', null, null, null, null, null, null, null),
  G('Koşul cümleleri', 'Conditionals', 'Konditionalsätze', 'Les phrases conditionnelles', 'Il periodo ipotetico', 'Условные предложения', '조건문', '条件句', 'الجملة الشرطية'),
  G('Edilgen çatı', 'Passive voice', 'Passiv', 'La voix passive', 'La forma passiva', 'Страдательный залог', '피동 표현', '被动句', 'المبني للمجهول'),
  G('Dolaylı anlatım', 'Reported speech', 'Indirekte Rede', 'Le discours rapporté', 'Il discorso indiretto', 'Косвенная речь', '간접 화법', '间接引语', 'الكلام غير المباشر'),
  G('Hitap biçimleri', null, 'Du und Sie', 'Tu et vous', 'Tu e Lei', 'Ты и Вы', '존댓말과 반말', '你和您', null),
  G('Dönüşlü fiiller', null, 'Reflexive Verben', 'Les verbes pronominaux', 'I verbi riflessivi', 'Возвратные глаголы', null, null, null),
  G('Cümlede fiilin yeri', null, 'Satzstellung', null, null, null, null, null, null),
  G('İsim halleri', null, 'Nominativ, Akkusativ, Dativ', null, null, 'Падежи', null, null, 'الإعراب'),
  G('İsim cinsiyeti ve uyum', null, 'Das Genus der Nomen', 'Le genre et l’accord', 'Genere e accordo', 'Род существительных', null, null, 'المذكر والمؤنث'),
  G('Edat + tanımlık birleşimi', null, null, null, 'Le preposizioni articolate', null, null, null, null),
  G('Fiil görünüşü', null, null, null, null, 'Вид глагола: совершенный / несовершенный', null, null, null),
  G('Ek ve parçacıklar', null, null, null, null, null, '조사: 은/는, 이/가, 을/를', null, null),
  G('Zaman parçacıkları', null, null, null, null, null, null, '“了”“过”“着”', null),
  G('Tonlar ve telaffuz', null, null, null, null, null, null, '声调与拼音', null),
  G('İsim cümlesi ve fiil cümlesi', null, null, null, null, null, null, null, 'الجملة الاسمية والفعلية'),
  G('Saat ve tarih', 'Telling time & dates', 'Uhrzeit und Datum', 'L’heure et la date', 'L’ora e la data', 'Время и дата', '시간과 날짜', '时间与日期', 'الوقت والتاريخ'),
  G('Günler, aylar, mevsimler', 'Days, months & seasons', 'Wochentage, Monate, Jahreszeiten', 'Jours, mois et saisons', 'Giorni, mesi e stagioni', 'Дни, месяцы, времена года', '요일, 달, 계절', '星期、月份、季节', 'الأيام والشهور والفصول'),
  G('Aile üyeleri', 'Family members', 'Familienmitglieder', 'Les membres de la famille', 'I membri della famiglia', 'Члены семьи', '가족 구성원', '家庭成员', 'أفراد الأسرة'),
  G('Meslekler', 'Jobs & occupations', 'Berufe', 'Les métiers', 'Le professioni', 'Профессии', '직업', '职业', 'المهن'),
  G('Vücut bölümleri', 'Parts of the body', 'Körperteile', 'Les parties du corps', 'Le parti del corpo', 'Части тела', '신체 부위', '身体部位', 'أجزاء الجسم'),
  G('Duygular ve hisler', 'Feelings & emotions', 'Gefühle', 'Les émotions', 'Le emozioni', 'Чувства и эмоции', '감정 표현', '情感表达', 'المشاعر'),
  G('Sıfatlar', 'Adjectives', 'Adjektive', 'Les adjectifs', 'Gli aggettivi', 'Прилагательные', '형용사', '形容词', 'الصفات'),
  G('Zarflar', 'Adverbs', 'Adverbien', 'Les adverbes', 'Gli avverbi', 'Наречия', '부사', '副词', 'الظروف'),
  G('Bağlaçlar', 'Conjunctions & linkers', 'Konjunktionen', 'Les connecteurs', 'Le congiunzioni', 'Союзы', '접속 표현', '连词', 'أدوات الربط'),
  G('Sıra sayıları', 'Ordinal numbers', 'Ordnungszahlen', 'Les nombres ordinaux', 'I numeri ordinali', 'Порядковые числительные', '서수', '序数词', 'الأعداد الترتيبية'),
  G('Emir cümleleri', 'Imperatives', 'Imperativ', 'L’impératif', 'L’imperativo', 'Повелительное наклонение', '명령·권유 표현', '祈使句', 'فعل الأمر'),
  G('Rica, izin ve nezaket', 'Polite requests & permission', 'Höfliche Bitten', 'Demandes polies', 'Richieste e permessi', 'Вежливые просьбы', '정중한 부탁과 허락', '礼貌用语与请求', 'الطلب والاستئذان بلطف'),
  G('Öneri ve tavsiye', 'Suggestions & advice', 'Vorschläge und Ratschläge', 'Suggestions et conseils', 'Suggerimenti e consigli', 'Предложения и советы', '제안과 조언', '建议与劝告', 'الاقتراحات والنصائح'),
  G('Tarif etme', 'Describing people & things', 'Personen und Dinge beschreiben', 'Décrire des personnes et des choses', 'Descrivere persone e cose', 'Описание людей и предметов', '사람·사물 묘사', '描述人和事物', 'وصف الأشخاص والأشياء'),
  G('Fikir bildirme', 'Giving opinions', 'Meinung äußern', 'Donner son avis', 'Esprimere opinioni', 'Выражение мнения', '의견 말하기', '表达观点', 'إبداء الرأي'),
  G('Alışveriş kalıpları', 'Shopping phrases', 'Einkaufsdialoge', 'Phrases pour faire les courses', 'Frasi per fare shopping', 'Фразы для покупок', '쇼핑 표현', '购物用语', 'عبارات التسوق'),
  G('Yol tarifi kalıpları', 'Giving directions', 'Den Weg beschreiben', 'Indiquer le chemin', 'Dare indicazioni', 'Как объяснить дорогу', '길 안내 표현', '指路用语', 'وصف الطريق'),
  G('Sebep ve sonuç', 'Cause & effect', 'Grund und Folge', 'Cause et conséquence', 'Causa ed effetto', 'Причина и следствие', '원인과 결과', '因果关系', 'السبب والنتيجة'),
  G('Deyimler', 'Idioms', 'Redewendungen', 'Les expressions idiomatiques', 'Modi di dire', 'Идиомы', '관용구', '成语与惯用语', 'التعابير الاصطلاحية'),
  G('Birleşik fiiller', 'Phrasal verbs', 'Trennbare Verben', null, null, null, null, null, null),
  G('Dilek ve varsayım kipi', 'Wishes & hypotheticals', 'Konjunktiv II', 'Le subjonctif', 'Il congiuntivo', 'Сослагательное наклонение', '소망과 가정 표현', '愿望与假设', null),
];
const MAX_TOPICS = 5;
const MAX_GRAM = 15;
const VOICES = {
  female: [['Kore', 'Kore'], ['Aoede', 'Aoede'], ['Leda', 'Leda'], ['Zephyr', 'Zephyr']],
  male: [['Puck', 'Puck'], ['Charon', 'Charon'], ['Fenrir', 'Fenrir'], ['Orus', 'Orus']],
};

const MODE_HINTS = {
  encouraging: 'Öğretmen sabırlı ve cesaretlendirici olur, az düzeltir, iyi yönleri öne çıkarır; rapor puanı cömert verilir.',
  medium: 'Öğretmen MEB dil öğretim ölçütlerine göre dengeli davranır; hataları kısaca düzeltir; puanlama standarttır.',
  hard: 'Öğretmen katıdır: her önemli hatayı hemen düzelttirir, uzun ve nitelikli cevap bekler; puanlama sert olur.',
};

/* ============================== Durum ============================== */
const state = {
  topics: new Set(), // seçili konuların Türkçe adları (en çok MAX_TOPICS)
  grammar: new Set(), // seçili dil yapılarının Türkçe adları (en çok MAX_GRAM)
  session: null,
  lastRec: null,
  activeTab: 'medium',
  view: 'setup',
  reportRecId: null,
};


/* ============================== IndexedDB ============================== */
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open('ingilizce-ogretmenim', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('sessions', { keyPath: 'id' });
      rq.onsuccess = () => { this._db = rq.result; res(this._db); };
      rq.onerror = () => rej(rq.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('sessions', mode);
      const r = fn(t.objectStore('sessions'));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  },
  put(rec) { return this.tx('readwrite', (s) => s.put(rec)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
  all() { return this.tx('readonly', (s) => s.getAll()); },
  get(id) { return this.tx('readonly', (s) => s.get(id)); },
};

/* ============================== Gezinme ============================== */
function showView(name) {
  state.view = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  const navName = ['session', 'report'].includes(name) ? 'setup' : name;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === navName));
  window.scrollTo(0, 0);
  if (name === 'history') renderHistory();
  renderLiveBar(true);
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view === 'setup' && state.session?.active) { showView('session'); return; }
  showView(b.dataset.view);
});

/* ============================== Görünüm ayarları ============================== */
const UI_DEF = { theme: 'cream', fs: '1', font: 'system', motion: 'on', transcript: 'show', hints: 'show' };
const THEME_COLOR = { cream: '#f0b429', dark: '#17130b', contrast: '#ffd400' };
const getUI = () => ({ ...UI_DEF, ...(LS.get('ui', {}) || {}) });
function applyUI() {
  const u = getUI(); const r = document.documentElement;
  r.dataset.theme = u.theme; r.style.setProperty('--fs', u.fs); r.dataset.font = u.font; r.dataset.motion = u.motion;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[u.theme] || '#f0b429');
}
function setUI(k, v) { LS.set('ui', { ...getUI(), [k]: v }); applyUI(); }
function initUISettings() {
  const map = { uiTheme: 'theme', uiSize: 'fs', uiFont: 'font', uiMotion: 'motion', uiTranscript: 'transcript', uiHints: 'hints' };
  const u = getUI();
  for (const [id, key] of Object.entries(map)) {
    const el = $('#' + id); if (!el) continue;
    el.value = u[key]; if (el.value !== u[key]) el.selectedIndex = 0;
    el.onchange = () => setUI(key, el.value);
  }
  applyUI();
}

/* ============================== Ayarlar ============================== */
function initSettings() {
  $('#apiKey').value = LS.get('apiKey', '') || '';
  $('#liveModel').value = LS.get('liveModel', DEFAULT_LIVE_MODEL);
  $('#evalModel').value = LS.get('evalModel', DEFAULT_EVAL_MODEL);
  $('#recPref').value = LS.get('recPref', 'ask');
  $('#evalSpeed').value = getEvalSpeed(); $('#evalAudio').value = LS.get('evalAudio', 'on');
  $('#evalSpeed').onchange = async () => {
    LS.set('evalSpeed', $('#evalSpeed').value);
    if (LS.get('evalModelManual') || !getKey()) return;
    try { const pick = pickEvalModel(await listModels(), getEvalSpeed()); if (pick) { LS.set('evalModel', pick); $('#evalModel').value = pick; toast('Değerlendirme modeli: ' + pick); } } catch (e) { toast('Model seçilemedi: ' + e.message); }
  };
  $('#evalAudio').onchange = () => LS.set('evalAudio', $('#evalAudio').value);
  $('#apiKey').addEventListener('input', (e) => { const c = cleanKey(e.target.value); if (c !== e.target.value) e.target.value = c; });
  $('#btnShowKey').onclick = () => { const i = $('#apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; };
  $('#btnPaste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); $('#apiKey').value = cleanKey(t); toast('Yapıştırıldı. Şimdi “Kaydet ve Test Et”e bas.'); }
    catch { $('#apiKey').focus(); toast('Kutuya tıklayıp Ctrl+V (telefonda uzun bas → Yapıştır) yap.'); }
  };
  $('#btnSaveKey').onclick = saveAndTestKey;
  $('#btnClearKey').onclick = () => { LS.del('apiKey'); $('#apiKey').value = ''; setKeyStatus('Anahtar silindi.', ''); };
  $('#liveModel').onchange = () => LS.set('liveModel', $('#liveModel').value.trim() || DEFAULT_LIVE_MODEL);
  $('#evalModel').onchange = () => { const v = $('#evalModel').value.trim(); LS.set('evalModel', v || DEFAULT_EVAL_MODEL); LS.set('evalModelManual', !!v); };
  $('#btnResetModels').onclick = () => {
    $('#liveModel').value = DEFAULT_LIVE_MODEL; $('#evalModel').value = DEFAULT_EVAL_MODEL;
    LS.set('liveModel', DEFAULT_LIVE_MODEL); LS.set('evalModel', DEFAULT_EVAL_MODEL); LS.del('evalModelManual'); toast('Varsayılan modeller yüklendi; “Kaydet ve Test Et” ile güncelini otomatik seçtir.');
  };
  $('#recPref').onchange = () => LS.set('recPref', $('#recPref').value);
}
function setKeyStatus(msg, cls) { const s = $('#keyStatus'); s.textContent = msg; s.className = 'status ' + cls; }
const getKey = () => cleanKey(LS.get('apiKey', '') || $('#apiKey').value);
const getLiveModel = () => (LS.get('liveModel', DEFAULT_LIVE_MODEL) || DEFAULT_LIVE_MODEL).replace(/^models\//, '');
const getEvalSpeed = () => LS.get('evalSpeed', 'fast');
const getEvalAudio = () => LS.get('evalAudio', 'on') === 'on';
const getEvalModel = () => (LS.get('evalModel', DEFAULT_EVAL_MODEL) || DEFAULT_EVAL_MODEL).replace(/^models\//, '');

async function saveAndTestKey() {
  const key = cleanKey($('#apiKey').value);
  if (!key) { setKeyStatus('Önce anahtarı yapıştır.', 'bad'); return; }
  LS.set('apiKey', key);
  setKeyStatus('Test ediliyor…', '');
  try {
    const r = await fetch(`${API_HOST}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setKeyStatus('Anahtar çalışmadı: ' + (j.error?.message || r.status), 'bad'); return;
    }
    const j = await r.json();
    const all = j.models || [];
    const live = all.filter((m) => (m.supportedGenerationMethods || []).includes('bidiGenerateContent')).map((m) => m.name.replace(/^models\//, ''));
    const notes = [];
    if (live.length && !live.includes(getLiveModel())) {
      const pick = live.find((n) => /native-audio/.test(n)) || live[0];
      $('#liveModel').value = pick; LS.set('liveModel', pick); notes.push('canlı model: ' + pick);
    }
    const evalNames = all.map((m) => m.name.replace(/^models\//, ''));
    if (!LS.get('evalModelManual') || !evalNames.includes(getEvalModel())) {
      const pick = pickEvalModel(all, getEvalSpeed());
      if (pick && pick !== getEvalModel()) { $('#evalModel').value = pick; LS.set('evalModel', pick); notes.push('değerlendirme modeli: ' + pick); }
    }
    setKeyStatus('Anahtar geçerli ve kaydedildi ✓' + (notes.length ? ' (otomatik güncellendi → ' + notes.join(', ') + ')' : ''), 'ok');
  } catch (e) {
    setKeyStatus('İnternet/ağ hatası: ' + e.message, 'bad');
  }
}
/* ============================== Ders kurulumu ============================== */
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LEVEL_INFO = {
  A1: '🌼 A1 – Başlangıç: tanıdık kelimeler ve çok basit cümleler. Hoca çok yavaş, tatlı ve sabırlı konuşur.',
  A2: '🌼 A2 – Temel: günlük basit konular. Hoca yavaş, tatlı ve sabırlı konuşur.',
  B1: '📗 B1 – Orta: bağlantılı konuşma, deneyim ve fikir anlatma.',
  B2: '📘 B2 – Orta üstü: ayrıntılı, akıcı ve tartışmalı konuşma.',
  C1: '📙 C1 – İleri: akıcı, esnek ve iyi yapılandırılmış uzun konuşma.',
  C2: '🏆 C2 – Ustalık: doğala yakın, ince anlam farkları ve üst düzey anlatım.',
};
const isGentleLevel = (level) => level === 'A1' || level === 'A2';

/* Süre seçici: 1–15 dk düğmeleri + kendin yaz (+ isteğe bağlı "süresiz/hedef yok") */
function makeDurPicker(box, { def = 5, unlimitedLabel = null, max = 180, onChange } = {}) {
  box.innerHTML = '<div class="durchips"></div><div class="durcustom"><input type="number" inputmode="numeric" min="1" step="1" placeholder="Kendin yaz"><span>dakika</span></div>';
  const chips = box.querySelector('.durchips'); const inp = box.querySelector('input'); inp.max = max;
  let val = def;
  const draw = () => {
    chips.innerHTML = '';
    const add = (label, v) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = 'chip' + (val === v && !inp.value ? ' sel' : '');
      b.onclick = () => { val = v; inp.value = ''; draw(); onChange && onChange(val); };
      chips.appendChild(b);
    };
    for (let i = 1; i <= 15; i++) add(i + ' dk', i);
    if (unlimitedLabel) add(unlimitedLabel, 0);
  };
  inp.oninput = () => {
    const n = parseInt(inp.value, 10);
    if (n >= 1) { val = Math.min(max, n); draw(); onChange && onChange(val); }
  };
  draw();
  return {
    get: () => val,
    set: (v) => { val = v; if (v > 15) inp.value = v; else inp.value = ''; draw(); },
  };
}
let durPick = null; let upDurPick = null;

function fillLangSelects() {
  for (const id of ['lang', 'upLang']) {
    const sel = $('#' + id); if (!sel) continue; sel.innerHTML = '';
    LANG_IDS.forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = `${LANGS[k].name} (${LANGS[k].native})`; sel.appendChild(o); });
  }
  for (const id of ['level', 'upLevel']) {
    const sel = $('#' + id); if (!sel) continue; sel.innerHTML = '';
    LEVELS.forEach((l) => { const o = document.createElement('option'); o.value = l; o.textContent = l; sel.appendChild(o); });
  }
}

function initSetup() {
  fillLangSelects();
  const p = LS.get('profile', {});
  ['firstName', 'lastName', 'lang', 'level', 'teacherGender', 'mode', 'trHelp', 'micMode', 'customTopic'].forEach((id) => { if (p[id] !== undefined && $('#' + id)) $('#' + id).value = p[id]; });
  if (!LANGS[$('#lang').value]) $('#lang').value = 'en';
  if (p.level === undefined) $('#level').value = 'B1';
  if (Array.isArray(p.topics)) p.topics.forEach((t) => findTopic(t) && state.topics.add(t));
  if (Array.isArray(p.grammar)) p.grammar.forEach((t) => state.grammar.add(t));
  durPick = makeDurPicker($('#durBox'), { def: p.minutes ?? 5, unlimitedLabel: 'Süresiz' });
  if (p.minutes !== undefined) durPick.set(p.minutes);
  fillVoices(); if (p.voiceName) $('#voiceName').value = p.voiceName;
  renderThemes(); renderGrammar();
  $('#lang').onchange = () => { renderThemes(); renderGrammar(); };
  $('#level').onchange = updateLevelHint; updateLevelHint();
  $('#topicSet').onchange = renderThemes;
  $('#topicSearch').oninput = renderThemes;
  $('#teacherGender').onchange = fillVoices;
  $('#mode').onchange = () => { $('#modeHint').textContent = MODE_HINTS[$('#mode').value]; }; $('#mode').onchange();
  $('#btnStart').onclick = startLesson;
  // kayıt değerlendirme sayfası
  upDurPick = makeDurPicker($('#upDurBox'), { def: 0, unlimitedLabel: 'Hedef yok' });
  initUpload();
}
function updateLevelHint() { $('#levelHint').textContent = LEVEL_INFO[$('#level').value] || ''; }

const topicMatches = (t, q) => !q || [t.tr, ...Object.values(t.x)].some((s) => String(s).toLocaleLowerCase('tr').includes(q));
function renderThemes() {
  const L = $('#lang').value; const set = $('#topicSet').value; const q = $('#topicSearch').value.trim().toLocaleLowerCase('tr');
  const groups = [];
  if (set === 'all' || set === 'g') TOPIC_GROUPS.forEach((g) => groups.push([g.title, g.items]));
  if (set === 'all') [9, 10, 11, 12].forEach((n) => groups.push([`🎓 ${n}. sınıf üniteleri`, THEMES[n]]));
  else if (THEMES[set]) groups.push([`🎓 ${set}. sınıf üniteleri`, THEMES[set]]);
  const box = $('#themeChips'); box.innerHTML = ''; let shown = 0;
  groups.forEach(([title, items]) => {
    const list = items.filter((t) => topicMatches(t, q)); if (!list.length) return;
    const h = document.createElement('div'); h.className = 'tgroup'; h.textContent = title; box.appendChild(h);
    const wrap = document.createElement('div'); wrap.className = 'chips';
    list.forEach((t) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.tr = t.tr; shown++;
      b.className = 'chip' + (state.topics.has(t.tr) ? ' sel' : ''); b.textContent = `${t.tr} (${t.x[L]})`;
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
  });
  if (!shown) box.innerHTML = '<p class="muted">Bu aramaya uyan konu yok. Aşağıya kendi konunu yazabilirsin.</p>';
  renderTopicSel();
}
$('#themeChips').addEventListener('click', (e) => {
  const b = e.target.closest('button.chip'); if (!b) return; const tr = b.dataset.tr;
  if (state.topics.has(tr)) state.topics.delete(tr);
  else if (state.topics.size >= MAX_TOPICS) { toast(`En fazla ${MAX_TOPICS} konu seçebilirsin.`); return; }
  else state.topics.add(tr);
  b.classList.toggle('sel', state.topics.has(tr)); renderTopicSel();
});
function renderTopicSel() {
  const L = $('#lang').value; const box = $('#topicSel');
  if (!state.topics.size) { box.innerHTML = `Seçili konu yok. En fazla ${MAX_TOPICS} konu seçebilirsin; boş bırakırsan hoca serbest sohbetle başlar.`; return; }
  const names = [...state.topics].map(findTopic).filter(Boolean).map((t) => `<b>${esc(t.tr)}</b> <small>(${esc(t.x[L])})</small>`).join(' · ');
  box.innerHTML = `Seçili konular (${state.topics.size}/${MAX_TOPICS}): ${names} <button class="ghost sm" id="topicClear" type="button">Temizle</button>`;
  $('#topicClear').onclick = () => { state.topics.clear(); renderThemes(); };
}
function renderGrammar() {
  const L = $('#lang').value; const box = $('#grammarChips'); box.innerHTML = '';
  GRAMMAR.filter((g) => g[L]).forEach((g) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.tr = g.tr;
    b.className = 'chip' + (state.grammar.has(g.tr) ? ' sel' : ''); b.textContent = `${g.tr} (${g[L]})`;
    box.appendChild(b);
  });
  updateGramCount();
}
$('#grammarChips').addEventListener('click', (e) => {
  const b = e.target.closest('button.chip'); if (!b) return; const tr = b.dataset.tr;
  if (state.grammar.has(tr)) state.grammar.delete(tr);
  else if (state.grammar.size >= MAX_GRAM) { toast(`En fazla ${MAX_GRAM} dil yapısı seçebilirsin.`); return; }
  else state.grammar.add(tr);
  b.classList.toggle('sel', state.grammar.has(tr)); updateGramCount();
});
function updateGramCount() {
  const L = $('#lang').value; const n = GRAMMAR.filter((g) => state.grammar.has(g.tr) && g[L]).length;
  $('#gramCount').textContent = `Seçili: ${n}/${MAX_GRAM}`;
}
function fillVoices() {
  const g = $('#teacherGender').value; const sel = $('#voiceName'); sel.innerHTML = '';
  VOICES[g].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
}

function collectConfig() {
  const L = $('#lang').value;
  const custom = $('#customTopic').value.trim();
  const picked = [...state.topics].map(findTopic).filter(Boolean);
  const topic = custom || picked.map((t) => t.tr).join(' + ') || 'Serbest sohbet';
  const topicEn = custom || picked.map((t) => t.x.en).join(' + ') || 'Free conversation: getting to know the student';
  const topicNative = custom ? '' : picked.map((t) => t.x[L]).join(' + ');
  const minutes = durPick.get();
  return {
    firstName: $('#firstName').value.trim(), lastName: $('#lastName').value.trim(),
    lang: L, level: $('#level').value,
    topic, topicEn, topicNative, themeFromList: !custom && picked.length > 0,
    grammar: GRAMMAR.filter((g) => state.grammar.has(g.tr) && g[L]).map((g) => `${g.tr} (${g[L]})`),
    teacherGender: $('#teacherGender').value, voiceName: $('#voiceName').value,
    minutes, mode: $('#mode').value, trHelp: $('#trHelp').value, micMode: $('#micMode').value,
  };
}
function saveProfile() {
  const p = {}; ['firstName', 'lastName', 'lang', 'level', 'teacherGender', 'voiceName', 'mode', 'trHelp', 'micMode', 'customTopic'].forEach((id) => (p[id] = $('#' + id).value));
  p.minutes = durPick.get(); p.topics = [...state.topics]; p.grammar = [...state.grammar];
  LS.set('profile', p);
}

/* ============================== Öğretmen istemi ============================== */
function trInstruction(mode, L, level) {
  return {
    auto: `TURKISH HELP = LOW. Speak ${L}. Use Turkish only very sparingly: a short Turkish hint when the student is stuck or still does not understand after one retry${isGentleLevel(level) ? ' (a bit more often at A1/A2)' : ''}.`,
    none: `TURKISH HELP = OFF. Speak ONLY ${L} from now on. Never use Turkish, even if the student is stuck (rephrase more simply, use gestures-in-words, examples or easier questions instead).`,
    more: `TURKISH HELP = HIGH. You may explain grammar rules, instructions and new words in simple Turkish, then return to ${L} practice quickly. Keep the practice itself in ${L}.`,
  }[mode] || '';
}

function buildSystemPrompt(cfg) {
  const lg = langOf(cfg.lang); const L = lg.eng; const name = teacherName(cfg);
  const levelGuide = {
    A1: `A1 (absolute beginner). VOICE & STYLE (very important): speak VERY SLOWLY and clearly, with a soft, sweet, gentle, cheerful and melodic voice, like a kind and loving kindergarten teacher talking to a small child (warm and playful, but never insulting; the content must still respect a teenager). Leave short pauses between phrases. Use only the most common words and tiny sentences (3–6 words), one idea at a time. Repeat key words and say each new word twice, slowly. Celebrate every attempt with sweet praise in ${L}. Ask super simple questions: yes/no questions, either/or choices or one-word answers. Be extremely patient, never rush, and wait for the student.`,
    A2: `A2 (elementary). VOICE & STYLE (important): speak slowly, clearly and sweetly, with a warm, gentle, encouraging and friendly voice, like a caring teacher talking kindly to a young learner. Use short, simple sentences (max ~8–10 words) and everyday vocabulary. Pause between sentences; repeat or rephrase simply when the student hesitates. Praise often and warmly. Ask short questions about daily life, past events and plans, and offer two choices when the student is stuck. Avoid idioms.`,
    B1: `B1 (intermediate): use clear, natural ${L} at a moderate pace with some less common vocabulary. Ask for opinions, experiences and reasons ("why", "how"). Encourage connected speech with linking words.`,
    B2: `B2 (upper-intermediate): speak naturally with near-native clarity. Ask abstract, hypothetical and argumentative questions; expect detailed, well-structured answers with nuanced vocabulary.`,
    C1: `C1 (advanced): speak natural, fluent ${L} at a native-like pace with rich vocabulary, idioms and complex structures. Ask analytical, abstract and nuanced questions; challenge the student's reasoning; expect precise, well-organised extended answers; point out subtle errors in register, collocation and style.`,
    C2: `C2 (mastery): speak as an educated native speaker would, at natural speed, with sophisticated, idiomatic and precise language. Discuss complex, abstract and specialised topics; expect near-native accuracy, subtlety, irony and persuasive argumentation; correct even small imperfections in nuance, register, style and pronunciation.`,
  }[cfg.level] || '';
  const modeGuide = {
    encouraging: 'MODE = ENCOURAGING. Be warm, patient and very supportive. Praise specific good things often. Correct gently: at most ONE correction per turn, by repeating the correct form naturally and adding a very short tip. If the student struggles, simplify the question and cheer them on. Never make them feel bad.',
    medium: 'MODE = MEDIUM (aligned with the Turkish Ministry of National Education – MEB – communicative foreign-language curriculum for the level). Be friendly but balanced. Correct clear errors briefly right after the student finishes (say the correct sentence, give a 1-sentence reason), then continue. Expect answers of an appropriate length for the level and gently ask for more detail when answers are too short.',
    hard: `MODE = HARD (strict). Hold high standards. Correct every significant grammar, vocabulary or pronunciation error immediately and make the student repeat the corrected sentence before moving on. Demand longer, well-built answers; if an answer is too short or vague, say so politely but firmly and ask again. Ask challenging follow-up and critical-thinking questions. Do not give easy praise; acknowledge only genuinely good performance.${isGentleLevel(cfg.level) ? ' Even in this strict mode, at A1/A2 keep your voice slow, soft and kind: be strict about accuracy, never about tone.' : ''}`,
  }[cfg.mode];
  const tr = trInstruction(cfg.trHelp, L, cfg.level) + ' The student may change this setting during the lesson; whenever you receive a [SYSTEM] message about Turkish help, follow the newest one.';
  const time = cfg.minutes > 0
    ? `The lesson is planned for ${cfg.minutes} minutes. Keep the conversation going for the whole time. IMPORTANT: when the planned time is over the student may CONTINUE practising: NEVER end the lesson or say goodbye on your own; only wrap up if the student clearly says they want to stop. When you receive a message starting with [SYSTEM], follow it.`
    : 'This lesson has no fixed duration. Keep the conversation going until the student says they want to finish.';
  const grammar = cfg.grammar?.length
    ? `GRAMMAR / VOCABULARY TEACHING: while talking about the topic, also teach these points (Turkish name, then the ${L} term in brackets) one at a time in a conversational way: ${cfg.grammar.join('; ')}. For each point: give a very short explanation (1–2 sentences) with 1–2 examples, then ask the student to produce their own sentences or answer drill questions (e.g. numbers: ask them to count or say phone numbers, prices or dates; colors: ask the colors of things around them; pronouns: ask them to replace nouns with pronouns and make sentences; vocabulary groups: ask them to name items and use them in sentences). Check their answer, correct it, then move to the next point or return to the topic.`
    : `You may naturally introduce useful ${L} vocabulary and fix grammar as it comes up.`;
  const multi = / \+ /.test(cfg.topic || '');
  return `You are "${name}", the live ${L} speaking teacher inside the app "${BRAND}", talking by voice with a Turkish high-school student who is learning ${L}. Never say you are Gemini or mention any company or model name; if asked, say you are the AI ${L} teacher of this app. Speak ${L} with a ${cfg.teacherGender === 'female' ? 'warm female' : 'friendly male'} teacher personality.

STUDENT: ${cfg.firstName || 'the student'} ${cfg.lastName || ''}, Turkish high-school student, target CEFR level ${cfg.level} in ${L}.
TOPIC${multi ? 'S' : ''}: ${cfg.topicEn || cfg.topic} (Turkish: "${cfg.topic}"${cfg.topicNative ? `; in ${L}: "${cfg.topicNative}"` : ''})${cfg.themeFromList ? ' – chosen from the topic list of the app (school units and everyday themes)' : ''}.${multi ? ' There are several topics: after about 3–4 exchanges on one, move naturally to the next.' : ''}
${lg.note ? 'LANGUAGE NOTE: ' + lg.note : ''}

LEVEL: ${levelGuide}
${modeGuide}
${grammar}
${tr}
${time}

HOW TO TEACH:
1. Start now: greet the student by first name, introduce yourself in one short sentence, introduce the topic in 1–2 sentences, then ask your first question. Everything in ${L}.
2. Analyze the topic yourself and cover different sides over time: personal experience, likes/dislikes, descriptions, comparisons, past and future, opinions and reasons, hypothetical situations.
3. Listen to each answer, react to its content like a real conversation partner, then ask a follow-up that depends on what the student said.
4. About every 3–4 turns ask a critical-thinking question in ${L} about the topic (e.g. "Why do you think…?", "What would happen if…?", "Do you agree that…? Why / why not?"), adapted to the student's level.
5. Notice grammar, vocabulary and pronunciation mistakes. When the student mispronounces a word, say it correctly and ask them to repeat it. Correct as described in your MODE.
6. Keep every turn SHORT: 1–3 sentences (at A1 max 2), then ONE question. Never lecture for long. Always wait for the student.
7. Do not give scores or a final evaluation during the lesson; a detailed written report will be produced automatically afterwards. Short encouragement is fine.
8. If the student is silent for a while, gently prompt them or offer a hint or an easier question.
Stay on the educational purpose, be respectful and age-appropriate.`;
}

/* ============================== Ses dosyası yardımcıları ============================== */
function wavHeader(dataLen, rate = 16000) {
  const buf = new ArrayBuffer(44); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, dataLen, true);
  return buf;
}
/* Değerlendirme isteği ~20 MB ile sınırlı: WAV büyükse önce 8 kHz'e indirir (telaffuz için yeterli),
   yine büyükse yalnızca SON kısmını gönderir. Saklanan kayıt her zaman tam kalır. */
async function fitAudio(blob, capBytes) {
  const raw = { blob, mime: blob.type && !/wav/i.test(blob.type) ? blob.type : 'audio/wav' };
  if (!blob || blob.size <= capBytes) return raw;
  if (!/wav/i.test(blob.type || 'audio/wav')) return raw; // WAV dışı dosya zaten ≤ 14 MB'a sınırlı
  const buf = new Int16Array((await blob.arrayBuffer()).slice(44));
  let data = buf; let rate = 16000;
  if (buf.length * 2 > capBytes) { // 2'şer örnek ortalayıp 8 kHz yap
    const n = Math.floor(buf.length / 2); data = new Int16Array(n);
    for (let i = 0; i < n; i++) data[i] = (buf[2 * i] + buf[2 * i + 1]) >> 1;
    rate = 8000;
  }
  let len = Math.min(data.length * 2, capBytes - 44); len -= len % 2;
  const tail = data.subarray(data.length - len / 2);
  return { blob: new Blob([wavHeader(len, rate), tail], { type: 'audio/wav' }), mime: 'audio/wav' };
}

/* ============================== Ses yardımcıları ============================== */
function downsample(f32, srcRate, dstRate = 16000) {
  if (srcRate === dstRate) return f32;
  const ratio = srcRate / dstRate; const n = Math.floor(f32.length / ratio); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(f32.length, Math.floor((i + 1) * ratio)); let s = 0;
    for (let j = a; j < b; j++) s += f32[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}
const f32ToI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
function b64FromBytes(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
function bytesFromB64(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function buildWav(int16Chunks, rate = 16000, maxBytes = Infinity) {
  let total = int16Chunks.reduce((a, c) => a + c.length * 2, 0);
  let chunks = int16Chunks;
  if (total > maxBytes) { // sondan kırp
    let acc = 0; const keep = [];
    for (let i = chunks.length - 1; i >= 0; i--) { acc += chunks[i].length * 2; keep.unshift(chunks[i]); if (acc >= maxBytes) break; }
    chunks = keep; total = acc;
  }
  const buf = new ArrayBuffer(44 + total); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + total, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, total, true);
  let off = 44; for (const c of chunks) { new Int16Array(buf, off, c.length).set(c); off += c.length * 2; }
  return { blob: new Blob([buf], { type: 'audio/wav' }), truncated: chunks !== int16Chunks };
}
const blobToB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });

const WORKLET_SRC = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}
process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b.slice(0));this.n=0}}}return true}}
registerProcessor('cap',Cap);`;

/* ============================== Canlı oturum ============================== */
class LiveSession {
  constructor(cfg) {
    this.cfg = cfg; this.active = false; this.ending = false; this.handle = null; this.retries = 0;
    this.transcript = []; this.pcm = []; this.speakSec = 0; this.elapsed = 0; this.overSent = false;
    this.micMode = cfg.micMode === 'manual' ? 'manual' : 'auto';
    this.muted = this.micMode === 'manual';
    this.hintsOn = getUI().hints !== 'hide'; this.lastHintFor = '';
    this.sources = new Set(); this.nextT = 0; this.startedAt = 0; this.setupDone = false;
  }
  async start() {
    const key = getKey(); if (!key) throw new Error('API anahtarı yok. Ayarlar bölümüne yapıştır.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu cihaz/tarayıcı mikrofonu desteklemiyor (HTTPS gerekir).');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.inCtx = new AC(); this.outCtx = new AC();
    await this.inCtx.resume(); await this.outCtx.resume();
    await this.setupMic();
    this.active = true;
    await this.connect();
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), 1000);
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { /* yoksay */ }
  }
  async setupMic() {
    const src = this.inCtx.createMediaStreamSource(this.stream);
    const sink = this.inCtx.createGain(); sink.gain.value = 0; sink.connect(this.inCtx.destination);
    const onChunk = (f32) => this.onMic(f32);
    if (this.inCtx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await this.inCtx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.inCtx, 'cap'); this.node.port.onmessage = (e) => onChunk(e.data);
    } else {
      this.node = this.inCtx.createScriptProcessor(2048, 1, 1);
      this.node.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    src.connect(this.node); this.node.connect(sink);
  }
  onMic(f32) {
    if (!this.active) return;
    const d = downsample(f32, this.inCtx.sampleRate); let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / Math.max(1, d.length));
    const m = $('#micLevel'); if (m) m.style.width = (this.muted ? 0 : Math.min(100, rms * 600)) + '%';
    if (this.muted) return;
    const i16 = f32ToI16(d);
    if (rms > 0.012) this.speakSec += d.length / 16000;
    this.pcm.push(i16);
    if (this.ws && this.ws.readyState === 1 && this.setupDone) {
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64FromBytes(new Uint8Array(i16.buffer)), mimeType: 'audio/pcm;rate=16000' } } }));
    }
  }
  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(getKey())}`;
      const ws = new WebSocket(url); this.ws = ws; this.setupDone = false; let settled = false;
      ws.onopen = () => {
        const c = this.cfg;
        ws.send(JSON.stringify({ setup: {
          model: 'models/' + getLiveModel(),
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voiceName } } } },
          systemInstruction: { parts: [{ text: buildSystemPrompt(c) }] },
          inputAudioTranscription: {}, outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
          sessionResumption: this.handle ? { handle: this.handle } : {},
        } }));
      };
      ws.onmessage = async (ev) => {
        let txt = ev.data; if (txt instanceof Blob) txt = await txt.text(); else if (txt instanceof ArrayBuffer) txt = new TextDecoder().decode(txt);
        let m; try { m = JSON.parse(txt); } catch { return; }
        if (m.setupComplete) {
          this.setupDone = true; this.retries = 0;
          if (!settled) { settled = true; resolve(); this.kickoff(); } else this.afterResume();
        }
        this.handleMsg(m);
      };
      ws.onerror = () => { /* onclose ayrıntıyı verir */ };
      ws.onclose = (ev) => {
        this.setupDone = false;
        if (!settled) { settled = true; reject(new Error(`Bağlantı kurulamadı (${ev.code}) ${ev.reason || ''}`.trim())); return; }
        if (this.active && !this.ending) this.reconnect(ev);
      };
    });
  }
  kickoff() {
    const Lg = langOf(this.cfg.lang).eng; const slow = isGentleLevel(this.cfg.level) ? ' Remember: speak slowly, sweetly and gently, like to a small child.' : '';
    this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: `Hello! Please start the ${Lg} lesson now.${slow}` }] }], turnComplete: true } }));
    setOrb('listening', 'Öğretmen hazırlanıyor…');
  }
  idleLabel() { return this.muted ? (this.micMode === 'manual' ? 'Hazır olunca “Konuşmaya başla”ya bas' : 'Mikrofon kapalı') : 'Sıra sende, konuş!'; }
  afterResume() { setOrb('listening', this.idleLabel()); }
  async reconnect(ev) {
    if (this.retries >= 5 || !this.handle) { this.fail(`Bağlantı koptu (${ev.code}) ${ev.reason || ''}`.trim()); return; }
    this.retries++; setOrb('', 'Yeniden bağlanıyor…');
    await sleep(800 * this.retries);
    try { await this.connect(); } catch (e) { this.fail(e.message); }
  }
  fail(msg) { toast(msg, 6000); if (this.active && !this.ending) endLesson(true); }
  handleMsg(m) {
    if (m.sessionResumptionUpdate?.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    const sc = m.serverContent; if (!sc) return;
    if (sc.interrupted) this.stopPlayback();
    if (sc.modelTurn?.parts) for (const p of sc.modelTurn.parts) if (p.inlineData?.data) this.play(p.inlineData.data);
    if (sc.inputTranscription?.text) this.addText('s', sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.addText('t', sc.outputTranscription.text);
    if (sc.turnComplete && this.transcript[this.transcript.length - 1]?.role === 't') setTimeout(() => showHint(false), 700);
  }
  addText(role, text) {
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.role === role) last.text += text; else this.transcript.push({ role, text, t: this.elapsed });
    renderTranscript();
  }
  play(b64) {
    const u8 = bytesFromB64(b64); const i16 = new Int16Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 2));
    const f = new Float32Array(i16.length); for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
    const buf = this.outCtx.createBuffer(1, f.length, 24000); buf.copyToChannel(f, 0);
    const s = this.outCtx.createBufferSource(); s.buffer = buf; s.connect(this.outCtx.destination);
    const now = this.outCtx.currentTime; if (this.nextT < now + 0.03) this.nextT = now + 0.05;
    s.start(this.nextT); this.nextT += buf.duration;
    this.sources.add(s); setOrb('speaking', 'Öğretmen konuşuyor');
    s.onended = () => { this.sources.delete(s); if (!this.sources.size && this.active) setOrb('listening', this.idleLabel()); };
  }
  stopPlayback() { this.sources.forEach((s) => { try { s.stop(); } catch { /* yoksay */ } }); this.sources.clear(); this.nextT = 0; }
  tick() {
    this.elapsed = (Date.now() - this.startedAt) / 1000;
    const target = this.cfg.minutes * 60; const tm = $('#timer');
    if (target > 0 && this.elapsed >= target) {
      tm.textContent = '+' + fmtTime(this.elapsed - target); tm.classList.add('over');
      if (!this.overSent) {
        this.overSent = true; toast('⏱ Planlanan süre doldu. Konuşmaya devam edebilirsin; bitirmek için “Dersi Bitir”e bas.', 6000);
        this.sendSystem(`[SYSTEM] The planned lesson time is over, but the student wants to keep practising. Do NOT say goodbye or end the lesson. In one short sentence in ${langOf(this.cfg.lang).eng}${isGentleLevel(this.cfg.level) ? ' (slow, simple and sweet)' : ''} mention that the planned time is over but you can keep talking for as long as they like, then continue the conversation with your next question.`);
      }
    } else { tm.textContent = target > 0 ? fmtTime(target - this.elapsed) : fmtTime(this.elapsed); tm.classList.remove('over'); }
    updateLiveTime();
  }
  sendText(t) { if (this.ws?.readyState === 1 && this.setupDone) this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: true } })); }
  sendSystem(t) { this.sendText(t); }
  setMuted(v) {
    this.muted = v;
    if (v && this.ws?.readyState === 1 && this.setupDone) this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    if (!v) this.stopPlayback(); // konuşmaya başlayınca hocanın sesi kesilir
    setOrb(this.sources.size ? 'speaking' : 'listening', this.idleLabel());
    updateMicBtn();
  }
  stop() {
    this.ending = true; this.active = false; clearInterval(this.timer);
    this.elapsed = this.startedAt ? (Date.now() - this.startedAt) / 1000 : this.elapsed;
    try { this.ws?.close(); } catch { /* yoksay */ }
    this.stopPlayback();
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* yoksay */ }
    try { this.node?.disconnect(); } catch { /* yoksay */ }
    try { this.inCtx?.close(); this.outCtx?.close(); } catch { /* yoksay */ }
    try { this.wake?.release(); } catch { /* yoksay */ }
  }
}

function setOrb(cls, label) { const o = $('#orb'); o.className = 'orb ' + cls; $('#orbLabel').textContent = label; }
function renderTranscript() {
  const s = state.session; if (!s) return; const box = $('#transcript');
  box.innerHTML = s.transcript.map((m) => `<div class="msg ${m.role}" dir="auto"><small>${m.role === 't' ? esc(teacherName(s.cfg)) : esc(s.cfg.firstName || 'Sen')}</small>${esc(m.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

/* ============================== Ders sırasındaki denetimler ============================== */
function updateMicBtn() {
  const s = state.session; const b = $('#btnMic'); if (!s) return;
  const manual = s.micMode === 'manual';
  b.className = 'micbtn ' + (s.muted ? 'off' : 'live');
  b.textContent = manual ? (s.muted ? '🎙 Konuşmaya başla' : '⏹ Bitirdim – hoca dinlesin') : (s.muted ? '🔇 Mikrofon kapalı – aç' : '🎙 Mikrofon açık (eller serbest)');
}
function updateToggleButtons() {
  const s = state.session; if (!s) return;
  const hidden = $('#transcript').classList.contains('hidden');
  $('#btnTrans').textContent = hidden ? '💬 Transkript: gizli' : '💬 Transkript: açık';
  $('#btnHintsToggle').textContent = s.hintsOn ? '💡 İpuçları: açık' : '💡 İpuçları: gizli';
}
$('#btnMic').onclick = () => { const s = state.session; if (s) s.setMuted(!s.muted); };
$('#btnTrans').onclick = () => { $('#transcript').classList.toggle('hidden'); updateToggleButtons(); };
$('#btnHintsToggle').onclick = () => {
  const s = state.session; if (!s) return; s.hintsOn = !s.hintsOn;
  if (!s.hintsOn) $('#hintCard').hidden = true; else showHint(false);
  updateToggleButtons();
};
$('#btnHint').onclick = () => showHint(true);
$('#liveTr').onchange = () => {
  const s = state.session; if (!s) return; const v = $('#liveTr').value; s.cfg.trHelp = v;
  s.sendSystem(`[SYSTEM] The student changed the Turkish-help setting. From now on follow this and ignore any earlier Turkish-help instruction. ${trInstruction(v, langOf(s.cfg.lang).eng, s.cfg.level)} Do not mention this message; just continue the conversation naturally.`);
  toast(v === 'none' ? 'Türkçe yardım kapatıldı.' : v === 'more' ? 'Türkçe yardım: çok.' : 'Türkçe yardım: az.');
  if (v === 'none') $('#hintCard').hidden = true; else showHint(false);
};
$('#liveMic').onchange = () => {
  const s = state.session; if (!s) return; s.micMode = $('#liveMic').value; s.cfg.micMode = s.micMode;
  s.setMuted(s.micMode === 'manual');
  toast(s.micMode === 'manual' ? 'Elle mod: konuşmak için düğmeye bas, bitince tekrar bas.' : 'Eller serbest mod: hoca seni kendiliğinden dinler.');
};
$('#btnText').onclick = () => { $('#textRow').hidden = !$('#textRow').hidden; if (!$('#textRow').hidden) $('#textInput').focus(); };
function sendTyped() {
  const s = state.session; const i = $('#textInput'); const t = i.value.trim(); if (!s || !t) return;
  s.stopPlayback(); s.sendText(t);
  s.transcript.push({ role: 's', text: t, t: s.elapsed, typed: true }); renderTranscript(); i.value = '';
}
$('#btnSendText').onclick = sendTyped;
$('#textInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTyped(); });
$('#btnEnd').onclick = () => endLesson();

/* Türkçe ipucu: hocanın son cümlesinin çevirisi + nasıl cevap verilir + örnek başlangıç */
let hintCtl = null;
async function showHint(manual) {
  const s = state.session; if (!s || !s.active) return;
  const last = [...s.transcript].reverse().find((m) => m.role === 't'); const card = $('#hintCard');
  if (!last) { if (manual) toast('Hoca henüz bir şey sormadı.'); return; }
  if (!manual && (!s.hintsOn || s.cfg.trHelp === 'none')) return;
  if (!manual && last.text === s.lastHintFor) return;
  s.lastHintFor = last.text; hintCtl?.abort(); const ctl = hintCtl = new AbortController();
  card.hidden = false; card.innerHTML = '<span class="spin"></span> İpucu hazırlanıyor…';
  const L = langOf(s.cfg.lang).eng;
  try {
    const h = await callGemini({
      signal: ctl.signal, gen: { temperature: 0.4, maxOutputTokens: 500 },
      parts: [{ text: `You are a friendly ${L} tutor helping a Turkish high-school student (level ${s.cfg.level}) during a live speaking lesson. The teacher just said (in ${L}): "${last.text.trim().slice(-600)}"
Return ONLY JSON: {"tr":"natural Turkish translation of the teacher's message","tip":"one short Turkish tip on how to answer (max 20 words)","starter":"a short example answer in ${L} the student could say, matching level ${s.cfg.level} (max 18 words)","starter_tr":"Turkish translation of the starter"}` }],
    });
    if (ctl.signal.aborted) return;
    card.innerHTML = `<button class="ghost sm x" id="hintX" type="button">✕</button><div><b>🇹🇷 Hoca diyor ki:</b> ${esc(h.tr)}</div><div>💡 ${esc(h.tip)}</div><div>🗣 Şöyle başlayabilirsin: <i dir="auto">${esc(h.starter)}</i> <span class="muted">(${esc(h.starter_tr)})</span></div>`;
    $('#hintX').onclick = () => { card.hidden = true; };
  } catch (e) {
    if (e.name === 'AbortError') return;
    card.innerHTML = manual ? `İpucu alınamadı: ${esc(e.message)}` : ''; card.hidden = !manual;
  }
}

/* Ders sürerken başka sekmelerde gezinirken görünen şerit */
function renderLiveBar(rebuild) {
  const bar = $('#liveBar'); const s = state.session;
  if (!s || !s.active || state.view === 'session') { bar.hidden = true; bar.innerHTML = ''; return; }
  if (!rebuild && !bar.hidden) { updateLiveTime(); return; }
  bar.hidden = false;
  bar.innerHTML = `<div class="job live"><span class="jt">🎙 Ders sürüyor: <b>${esc(teacherName(s.cfg))}</b> · ${esc(s.cfg.topic)} · ⏱ <span id="lbTime">${$('#timer').textContent}</span></span><button class="ghost sm" data-a="back" type="button">Derse dön</button><button class="ghost sm" data-a="end" type="button">Bitir</button></div>`;
}
function updateLiveTime() { const t = $('#lbTime'); if (t) t.textContent = $('#timer').textContent; }
$('#liveBar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.a === 'back') showView('session'); else if (b.dataset.a === 'end') endLesson();
});

/* ============================== Ders akışı ============================== */
async function startLesson() {
  if (state.session?.active) { showView('session'); return; }
  if (!getKey()) { toast('Önce Ayarlar bölümüne API anahtarını gir.'); showView('settings'); return; }
  const cfg = collectConfig();
  if (!cfg.firstName) { toast('Lütfen adını yaz.'); $('#firstName').focus(); return; }
  saveProfile();
  const btn = $('#btnStart'); btn.disabled = true; btn.textContent = 'Bağlanıyor…';
  const s = new LiveSession(cfg); state.session = s;
  try {
    showView('session');
    $('#sessTeacher').textContent = teacherName(cfg);
    $('#sessInfo').textContent = `${langOf(cfg.lang).name} · ${cfg.topic} · ${cfg.level} · ${{ encouraging: 'Teşvik edici', medium: 'Orta', hard: 'Zor' }[cfg.mode]}`;
    const ti = $('#textInput'); ti.placeholder = langOf(cfg.lang).placeholder; ti.dir = langOf(cfg.lang).dir || 'auto';
    $('#transcript').innerHTML = ''; $('#transcript').classList.toggle('hidden', getUI().transcript === 'hide');
    $('#hintCard').hidden = true; $('#textRow').hidden = true;
    const tm = $('#timer'); tm.classList.remove('over'); tm.textContent = cfg.minutes > 0 ? fmtTime(cfg.minutes * 60) : '00:00';
    $('#liveTr').value = cfg.trHelp; $('#liveMic').value = s.micMode;
    setOrb('', 'Bağlanıyor…'); updateMicBtn(); updateToggleButtons();
    await s.start();
    renderLiveBar(true);
  } catch (e) {
    s.stop(); state.session = null; showView('setup');
    toast(e.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi.' : e.message, 7000);
  } finally { btn.disabled = false; btn.textContent = '▶ Derse Başla'; }
}

let ending = false;
const countWords = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
async function endLesson() {
  const s = state.session; if (!s || ending) return; ending = true;
  s.stop(); hintCtl?.abort(); $('#hintCard').hidden = true;
  const studentWords = countWords(s.transcript.filter((m) => m.role === 's').map((m) => m.text).join(' '));
  if (s.elapsed < 15 || (!studentWords && !s.pcm.length)) {
    toast('Ders çok kısa olduğu için değerlendirilmedi.'); state.session = null; ending = false; showView('setup'); return;
  }
  const meta = { elapsedSec: Math.round(s.elapsed), targetSec: s.cfg.minutes * 60, studentSpeakSec: Math.round(s.speakSec), words: studentWords };
  meta.ratio = meta.targetSec > 0 ? Math.min(1, meta.elapsedSec / meta.targetSec) : 1;
  const fullWav = s.pcm.length ? buildWav(s.pcm, 16000) : null;
  const pref = LS.get('recPref', 'ask');
  // Ders bitince KAYIT HEMEN geçmişe yazılır; değerlendirme arka planda sürer, uygulama kapansa bile açılınca devam eder.
  const rec = {
    v: 3, id: 'ses_' + Date.now(), date: Date.now(),
    cfg: { ...s.cfg }, transcript: s.transcript.filter((m) => m.text), meta,
    report: null, error: null, status: 'evaluating',
    audio: fullWav ? fullWav.blob : null,
    keepAudio: pref === 'keep' ? true : pref === 'delete' ? false : null, // null = kullanıcıya sorulacak
  };
  try { await DB.put(rec); } catch (e) { toast('Geçmişe kaydedilemedi: ' + e.message, 6000); }
  state.session = null; ending = false;
  renderLiveBar(true);
  runEvaluation(rec);
  renderPending(rec);
}

/* ============================== Arka plan değerlendirme ============================== */
const jobs = new Map(); // id -> { ctrl, rec }  (çalışan değerlendirmeler)
const attention = new Map(); // id -> rec       (iş çubuğunda gösterilecek kayıtlar)
const noticed = new Set(); // sonucu görülmüş/kapatılmış kayıtlar

const needsAttention = (rec) => rec.status === 'evaluating' || !noticed.has(rec.id) || (rec.audio && rec.keepAudio === null);

async function runEvaluation(rec) {
  if (jobs.has(rec.id)) return;
  const ctrl = new AbortController(); jobs.set(rec.id, { ctrl, rec });
  rec.status = 'evaluating'; rec.error = null; noticed.delete(rec.id); attention.set(rec.id, rec); renderJobBar();
  try { await DB.put(rec); } catch { /* yoksay */ }
  try {
    let wav = null; const isUp = rec.cfg.source === 'upload';
    if (rec.audio && (isUp || getEvalAudio())) wav = await fitAudio(rec.audio, (isUp ? 14.2 : getEvalSpeed() === 'fast' ? 8 : 14.2) * 1024 * 1024);
    rec.report = await evaluate({ cfg: rec.cfg, transcript: rec.transcript }, rec.meta, wav, ctrl.signal);
    if (isUp && !rec.transcript?.length && rec.report.transcript) { // yüklenen kayıtta döküm modelden gelir
      rec.transcript = [{ role: 's', text: String(rec.report.transcript), t: 0 }]; rec.meta.words = countWords(rec.report.transcript);
    }
    rec.status = 'done'; rec.error = null; rec.evalModel = getEvalModel(); rec.evaluatedAt = Date.now();
  } catch (e) {
    if (ctrl.signal.aborted) { rec.status = 'cancelled'; rec.error = 'Değerlendirme iptal edildi.'; }
    else { rec.status = 'error'; rec.error = e.message; }
  }
  jobs.delete(rec.id);
  if (rec.deleted) { attention.delete(rec.id); renderJobBar(); return; }
  if (rec.keepAudio === false) rec.audio = null;
  try { await DB.put(rec); } catch (e) { toast('Geçmişe kaydedilemedi: ' + e.message, 6000); }
  const watching = state.view === 'report' && state.reportRecId === rec.id;
  if (watching) { noticed.add(rec.id); renderReport(rec); }
  else if (rec.status === 'done') toast(`✅ Rapor hazır: ${rec.cfg.firstName} · ${rec.cfg.topic}`, 5000);
  if (!needsAttention(rec)) attention.delete(rec.id);
  renderJobBar();
  if (state.view === 'history') renderHistory();
}
function cancelEvaluation(id) { const j = jobs.get(id); if (j) j.ctrl.abort(); }
async function removeRecord(id) {
  const j = jobs.get(id); if (j) { j.rec.deleted = true; j.ctrl.abort(); }
  attention.delete(id); noticed.delete(id);
  await DB.del(id); renderJobBar();
}

function renderJobBar() {
  const bar = $('#jobBar'); const rows = [];
  for (const rec of attention.values()) {
    const who = `<b>${esc(rec.cfg.firstName)}</b> · ${esc(rec.cfg.topic)}`;
    if (rec.status === 'evaluating') {
      rows.push(`<div class="job" data-id="${rec.id}"><span class="spin"></span><span class="jt">Değerlendiriliyor: ${who} <i>(başka sekmelere geçebilirsin, iptal edene kadar sürer)</i></span><button class="ghost sm" data-a="view" type="button">Göster</button><button class="ghost sm" data-a="cancel" type="button">İptal</button></div>`);
    } else if (!noticed.has(rec.id)) {
      if (rec.status === 'done') rows.push(`<div class="job" data-id="${rec.id}"><span class="jt">✅ Rapor hazır: ${who}</span><button class="primary sm" data-a="open" type="button">Raporu aç</button><button class="ghost sm" data-a="close" type="button">Kapat</button></div>`);
      else rows.push(`<div class="job" data-id="${rec.id}"><span class="jt">${rec.status === 'cancelled' ? '⛔ İptal edildi' : '⚠ Değerlendirilemedi'}: ${who}${rec.status === 'error' ? ' – ' + esc(rec.error || '') : ''}</span><button class="primary sm" data-a="retry" type="button">Tekrar dene</button><button class="ghost sm" data-a="close" type="button">Kapat</button></div>`);
    }
    if (rec.audio && rec.keepAudio === null) {
      rows.push(`<div class="job" data-id="${rec.id}"><span class="jt">🎧 Ses kaydı daha sonra kullanılmak üzere saklansın mı? (${who})</span><label class="check"><input type="checkbox" class="remember"> hatırla</label><button class="primary sm" data-a="keep" type="button">Sakla</button><button class="ghost sm" data-a="drop" type="button">Sil</button></div>`);
    }
  }
  bar.innerHTML = rows.join(''); bar.hidden = !rows.length;
}
$('#jobBar').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const el = b.closest('.job'); const id = el.dataset.id; const rec = attention.get(id); if (!rec) return;
  const a = b.dataset.a;
  if (a === 'view' || a === 'open') { if (a === 'open') noticed.add(id); renderReport(rec); }
  else if (a === 'cancel') cancelEvaluation(id);
  else if (a === 'close') { noticed.add(id); }
  else if (a === 'retry') { runEvaluation(rec); renderPending(rec); return; }
  else if (a === 'keep' || a === 'drop') {
    const keep = a === 'keep'; rec.keepAudio = keep;
    if (el.querySelector('.remember')?.checked) { LS.set('recPref', keep ? 'keep' : 'delete'); $('#recPref').value = keep ? 'keep' : 'delete'; }
    if (!keep && rec.status !== 'evaluating') rec.audio = null; // değerlendirme sürüyorsa bitince silinir
    try { await DB.put(rec); } catch { /* yoksay */ }
  }
  if (!needsAttention(rec)) attention.delete(id);
  renderJobBar();
});

/* Açılışta: yarım kalan değerlendirmeleri sürdür, cevaplanmamış ses sorularını tekrar sor */
async function resumePending() {
  let all = []; try { all = await DB.all(); } catch { return; }
  for (const rec of all) {
    if (rec.status === 'evaluating') { runEvaluation(rec); }
    else if (rec.audio && rec.keepAudio === null) { noticed.add(rec.id); attention.set(rec.id, rec); }
  }
  renderJobBar();
}

function renderPending(rec) {
  showView('report'); state.reportRecId = rec.id;
  $('#reportCard').innerHTML = `<h2>⏳ Değerlendiriliyor…</h2>
    <p class="muted">Hoca ${rec.cfg.source === 'upload' ? 'ses kaydını dinliyor' : 'konuşmanı ' + (rec.audio ? 've ses kaydını ' : '') + 'inceliyor'}; ayrıntılı rapor (puanlar, kelime listesi, çalışma planı) bir iki dakika sürebilir.</p>
    <p>Üst menüden <b>Geçmiş</b> veya <b>Ayarlar</b>'a geçebilirsin. Değerlendirme arka planda <b>sen iptal edene kadar</b> sürer, uygulamayı kapatsan bile açınca devam eder. Hazır olunca üstte haber verilir ve raporun tamamı <b>Geçmiş</b>'e kaydedilir.</p>
    <div class="row"><button class="danger" id="rpCancel" type="button">Değerlendirmeyi iptal et</button><button class="ghost" id="rpNew" type="button">➕ Yeni ders</button></div>`;
  $('#rpCancel').onclick = () => cancelEvaluation(rec.id);
  $('#rpNew').onclick = () => showView('setup');
}

/* ============================== Gemini çağrısı (ortak) ============================== */
async function callGemini({ parts, gen = {}, signal, model }) {
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3, ...gen } };
  let lastErr; let m = model || getEvalModel(); let discovered = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const r = await fetch(`${API_HOST}/v1beta/models/${m}:generateContent`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getKey() }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = j.error?.message || 'İstek başarısız (' + r.status + ')';
        // Model kapatılmış / bulunamıyorsa: anahtarın erişebildiği en yeni hızlı modeli bul, kaydet ve tekrar dene
        if (!discovered && (r.status === 404 || /no longer available|not found|not supported|deprecated/i.test(msg))) {
          discovered = true;
          const pick = pickEvalModel(await listModels(), getEvalSpeed());
          if (pick && pick !== m) { m = pick; LS.set('evalModel', pick); const el = $('#evalModel'); if (el) el.value = pick; attempt--; toast('Değerlendirme modeli otomatik güncellendi: ' + pick, 5000); continue; }
        }
        const err = new Error(msg); if ([400, 401, 403].includes(r.status)) err.fatal = true; throw err;
      }
      let txt = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      if (!txt) throw new Error(j.promptFeedback?.blockReason ? 'İçerik engellendi: ' + j.promptFeedback.blockReason : 'Boş yanıt');
      return JSON.parse(txt);
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; if (e.fatal) throw e; lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

/* ============================== Değerlendirme ============================== */
const SKILLS = ['grammar', 'vocabulary', 'fluency', 'coherence', 'pronunciation'];

async function evaluate(s, meta, wav, signal) {
  const c = s.cfg; const L = langOf(c.lang).eng;
  const lines = (s.transcript || []).filter((m) => m.text).map((m) => `${m.role === 't' ? 'TEACHER' : 'STUDENT'}: ${m.text.trim()}`).join('\n');
  const hasText = !!lines; const hasAudio = !!(wav?.blob?.size > 44);
  const header = `You are an expert CEFR (A1–C2) and Turkish MEB (Ministry of National Education) ${L} speaking examiner.
Language: ${L}. Student: ${c.firstName || 'Student'} ${c.lastName || ''}, Turkish high-school student, TARGET level ${c.level}. Topic: ${c.topicEn || c.topic || 'free speaking'}. Grammar points practised: ${(c.grammar || []).join(', ') || 'none'}.
Session length: ${meta.elapsedSec}s (planned: ${meta.targetSec ? meta.targetSec + 's' : 'none'}); student speaking time ≈ ${meta.studentSpeakSec}s; student words ≈ ${meta.words || 'unknown'}.
${hasText ? 'The lesson transcript is below: STUDENT lines are automatic speech transcriptions and may contain recognition errors – never blame the student for obvious transcription glitches.' : 'No transcript is supplied: LISTEN to the attached audio (it contains only the student speaking) and base everything on what you hear.'}
${hasAudio ? 'Use the attached audio to judge pronunciation, intonation, stress, rhythm and fluency (pauses, hesitations, fillers, self-corrections).' : 'No audio is supplied: say that pronunciation is only estimated from the transcript.'}
RELIABILITY RULES: base every judgement on concrete evidence from what the student actually said; quote real examples. If the student said very little (< ~40 words) set reliability.confidence to "low", say so honestly and do NOT give a CEFR level above A2. If the student mostly spoke Turkish instead of ${L}, say so and score accordingly. Do not inflate or invent; if unsure choose the lower level. Judge relative to the TARGET LEVEL ${c.level} but report the student's REAL CEFR level (A1, A2, B1, B2, C1 or C2) separately.
Write all comments, explanations and advice in TURKISH; keep ${L} examples in ${L}.`;
  const tail = `\n\nTRANSCRIPT:\n${hasText ? lines : '(none – use the audio)'}`;
  const audioPart = hasAudio ? [{ inlineData: { mimeType: wav.mime || 'audio/wav', data: await blobToB64(wav.blob) } }] : [];

  const pScores = `${header}

TASK 1 – SCORES. Give THREE separate evaluations of the same performance:
- "encouraging": generous and motivating; emphasise strengths; scores typically 6–12 points above medium (max 100).
- "medium": standard, fair evaluation following the MEB communicative curriculum and CEFR descriptors for ${c.level} (task achievement/topic development, grammatical accuracy, vocabulary range, fluency, coherence, pronunciation).
- "hard": strict examiner; expects the upper end of ${c.level}; scores typically 6–12 points below medium (min 0).
Scores are integers 0–100 and must satisfy encouraging ≥ medium ≥ hard for every skill.
Also estimate the student's real CEFR level overall and per skill, with 3–5 pieces of evidence, and complete an MEB-style can-do checklist of exactly 8 items for the target level ${c.level} (speaking/interaction descriptors adapted to ${L}).
Return ONLY valid JSON with exactly this shape:
{"reliability":{"confidence":"low|medium|high","note":"1-2 Turkish sentences"},
"cefr":{"overall":"A1..C2","grammar":"","vocabulary":"","fluency":"","coherence":"","pronunciation":"","evidence":["",""]},
"modes":{"encouraging":M,"medium":M,"hard":M},
"meb_checklist":[{"skill":"Turkish can-do statement for ${c.level}","status":"met|partly|not_met","note":"short Turkish note citing evidence"}]${hasText ? '' : ',\n"transcript":"verbatim transcription of the student\'s speech in the original language, no translation"'}}
where M = {"overall":0-100,"scores":{"grammar":0,"vocabulary":0,"fluency":0,"coherence":0,"pronunciation":0},"comments":{"grammar":"2-3 sentences","vocabulary":"","fluency":"","coherence":"","pronunciation":""},"summary":"4-5 sentences","strengths":["3-4 items"],"improvements":["3-4 items"],"advice":["5-6 specific, actionable items"]}${tail}`;

  const pAnalysis = `${header}

TASK 2 – DETAILED ANALYSIS for helping the student improve. Return ONLY valid JSON with exactly this shape:
{"errors":[{"said":"what the student said (original language)","correction":"correct version","type":"short Turkish label e.g. Dil bilgisi / Kelime / Söz dizimi / Zaman","explanation":"Turkish explanation of the rule behind the mistake","rule_example":"another correct example sentence in ${L}"}],
"improved_sentences":[{"original":"a real sentence of the student","improved":"a more natural or more advanced version suitable for the next level","why":"Turkish: what changed and why"}],
"missing_points":[{"area":"short Turkish label","detail":"Turkish: what was missing or weak compared with the target level and the topic, and exactly what to do about it"}],
"pronunciation_notes":[{"word":"","note":"Turkish: what was wrong and how to say it (use IPA or a simple Turkish-based respelling)"}],
"grammar_focus":["6-8 specific grammar topics to study, in Turkish with ${L} terms in brackets"],
"next_steps":["8-10 concrete practice ideas for this week"],
"study_plan":[{"day":"Gün 1","task":"Turkish, 10–20 minute task"}]}
Limits: "errors" up to 12 real mistakes from the student's speech (most important first); "improved_sentences" 6; "missing_points" 6–8; "pronunciation_notes" up to 10 (if audio is missing, base on likely problem words and say so); "study_plan" exactly 7 days.${tail}`;

  const pLex = `${header}

TASK 3 – PERSONAL VOCABULARY LIST. Create EXACTLY 45 useful ${L} words/short phrases for this student: closely related to the topic ("${c.topicEn || c.topic || 'what the student talked about'}") and suited to level ${c.level} (mostly ${c.level} with some of the next level), including words the student needed but missed or misused. No duplicates. Then add 8 useful sentence patterns/phrases.
Return ONLY valid JSON: {"vocabulary":[{"word":"","reading":"pinyin / romanization / transcription for Chinese, Korean, Russian, Arabic (empty string for other languages)","pos":"short Turkish part of speech e.g. isim, fiil, sıfat","meaning":"Turkish meaning","example":"example sentence in ${L}","example_tr":"Turkish translation of the example"}],
"phrases":[{"phrase":"","meaning":"Turkish","example":"in ${L}","example_tr":"Turkish"}]}${hasText ? '' : '\nThe student\'s speech is in the attached audio; listen to it to choose relevant words.'}${tail}`;

  const gen = { temperature: 0.25 };
  const [sc, an, lx] = await Promise.all([
    callGemini({ parts: [{ text: pScores }, ...audioPart], gen: { ...gen, maxOutputTokens: 12000 }, signal }),
    callGemini({ parts: [{ text: pAnalysis }, ...audioPart], gen: { ...gen, maxOutputTokens: 12000 }, signal }),
    callGemini({ parts: [{ text: pLex }, ...(hasText ? [] : audioPart)], gen: { ...gen, maxOutputTokens: 10000 }, signal }),
  ]);
  if (!sc.modes) throw new Error('Beklenmeyen rapor biçimi');
  const out = { v: 3, ...sc, ...an, vocabulary: lx.vocabulary || [], phrases: lx.phrases || [], audioUsed: hasAudio };
  out.cefr_estimate = out.cefr?.overall || out.cefr_estimate || '';
  normalizeReport(out);
  return out;
}

/* Üç modun puanları tutarlı olsun: teşvik ≥ orta ≥ zor (her beceri ve genel puan için) */
function normalizeReport(r) {
  const M = ['encouraging', 'medium', 'hard'];
  const fix = (get, set) => { const v = M.map((k) => clamp(get(r.modes[k]))).sort((a, b) => b - a); M.forEach((k, i) => set(r.modes[k], v[i])); };
  for (const k of M) { r.modes[k].scores = r.modes[k].scores || {}; r.modes[k].comments = r.modes[k].comments || {}; }
  SKILLS.forEach((sk) => fix((m) => m.scores[sk], (m, v) => { m.scores[sk] = v; }));
  fix((m) => m.overall, (m, v) => { m.overall = v; });
}

/* ============================== Rapor ============================== */
const CAT_LABEL = { grammar: 'Dil Bilgisi', vocabulary: 'Kelime', fluency: 'Akıcılık', coherence: 'Tutarlılık', pronunciation: 'Telaffuz' };
const MODE_LABEL = { encouraging: '😊 Teşvik edici', medium: '📘 Orta (MEB)', hard: '🔥 Zor (katı)' };
const scoreWord = (n) => (n >= 90 ? 'Mükemmel' : n >= 75 ? 'Çok iyi' : n >= 60 ? 'İyi' : n >= 45 ? 'Orta' : 'Geliştirilmeli');
const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const cefrOf = (rep) => rep?.cefr?.overall || rep?.cefr_estimate || '—';
function adjusted(rec, mode) {
  const m = rec.report.modes[mode]; const raw = clamp(m.overall); const ratio = rec.meta.ratio ?? 1;
  return { raw, ratio, final: Math.round(raw * ratio) };
}
function listHtml(arr) { return arr?.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'; }
const tbl = (head, rows, word) => `<div class="tblwrap"><table class="cmp"${word ? ' border="1" cellspacing="0" cellpadding="4"' : ''}><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td dir="auto">${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
const STATUS = { met: ['✔ Karşılandı', 'st-met'], partly: ['◐ Kısmen', 'st-partly'], not_met: ['✘ Karşılanmadı', 'st-not_met'] };

function metricsOf(rec) {
  const txt = (rec.transcript || []).filter((m) => m.role === 's').map((m) => m.text).join(' ');
  const words = txt.toLocaleLowerCase().match(/[\p{L}\p{N}'’]+/gu) || [];
  const cjk = /[㐀-鿿가-힯]/.test(txt);
  const n = rec.meta.words || words.length; const speak = rec.meta.studentSpeakSec || 0;
  return { words: n, unique: cjk ? null : new Set(words).size, wpm: !cjk && speak >= 10 && n ? Math.round(n / (speak / 60)) : null, speak };
}

function modeSectionHtml(rec, mode, word) {
  const m = rec.report.modes[mode]; const a = adjusted(rec, mode); const meta = rec.meta;
  const lv = rec.report.cefr || {};
  const bars = word
    ? tbl(['Beceri', 'Puan', 'Seviye'], Object.keys(CAT_LABEL).map((k) => [CAT_LABEL[k], clamp(m.scores?.[k]) + '/100', esc(lv[k] || '—')]), true)
    : `<div class="bars">${Object.keys(CAT_LABEL).map((k) => `<div class="bar"><div class="lbl"><span>${CAT_LABEL[k]}${lv[k] ? ` <span class="pill">${esc(lv[k])}</span>` : ''}</span><b>${clamp(m.scores?.[k])}/100</b></div><div class="track"><div class="fill" style="width:${clamp(m.scores?.[k])}%"></div></div></div>`).join('')}</div>`;
  const cm = Object.keys(CAT_LABEL).map((k) => `<li><b>${CAT_LABEL[k]}:</b> ${esc(m.comments?.[k] || '—')}</li>`).join('');
  const timeLine = meta.targetSec > 0
    ? `Süre oranı: ${fmtTime(meta.elapsedSec)} / ${fmtTime(meta.targetSec)} = <b>${a.ratio.toFixed(2)}</b> → ham puan ${a.raw} × ${a.ratio.toFixed(2)} = <b>${a.final}</b>${a.ratio < 1 ? '' : ' (planlanan süre tamamlandı)'}`
    : 'Süre hedefi yok – süre kesintisi uygulanmadı (ham puan = ' + a.raw + ').';
  return `<div class="score-big">${a.final}<small style="font-size:18px;color:var(--muted)"> / 100 · ${scoreWord(a.final)}</small></div>
    <p class="muted">${timeLine}</p>${bars}
    <div class="rep-sec"><h4>Genel Yorum</h4><p>${esc(m.summary)}</p></div>
    <div class="rep-sec"><h4>Beceri Yorumları</h4><ul>${cm}</ul></div>
    <div class="rep-sec"><h4>✅ Güçlü Yönler</h4>${listHtml(m.strengths)}</div>
    <div class="rep-sec"><h4>🔧 Geliştirilecek Yönler</h4>${listHtml(m.improvements)}</div>
    <div class="rep-sec"><h4>💡 Tavsiyeler</h4>${listHtml(m.advice)}</div>`;
}

function commonSectionHtml(rec, word) {
  const rep = rec.report; const S = [];
  const sec = (title, body) => body ? S.push(`<div class="rep-sec"><h4>${title}</h4>${body}</div>`) : 0;
  if (rep.reliability) sec('🧭 Ölçümün Güvenilirliği', `<div class="warnbox"><b>Güven düzeyi: ${esc({ low: 'düşük', medium: 'orta', high: 'yüksek' }[rep.reliability.confidence] || rep.reliability.confidence || '—')}.</b> ${esc(rep.reliability.note || '')}</div>`);
  if (rep.cefr) {
    const chips = [`<div class="cefr main"><b>${esc(rep.cefr.overall || '—')}</b>Genel seviye</div>`, ...Object.keys(CAT_LABEL).map((k) => `<div class="cefr"><b>${esc(rep.cefr[k] || '—')}</b>${CAT_LABEL[k]}</div>`)].join('');
    sec('🎯 Tahmini Dil Seviyesi (A1 – C2)', word ? tbl(['Genel', ...Object.values(CAT_LABEL)], [[esc(rep.cefr.overall || '—'), ...Object.keys(CAT_LABEL).map((k) => esc(rep.cefr[k] || '—'))]], true) + listHtml(rep.cefr.evidence)
      : `<div class="cefrrow">${chips}</div>${rep.cefr.evidence?.length ? '<p class="muted">Dayanak (senin konuşmandan):</p>' + listHtml(rep.cefr.evidence) : ''}`);
  } else if (rep.cefr_estimate) sec('🎯 Tahmini Dil Seviyesi', `<p><b>${esc(rep.cefr_estimate)}</b></p>`);
  const mt = metricsOf(rec);
  sec('📊 Konuşma Ölçümleri', word ? tbl(['Kelime', 'Farklı kelime', 'Dakikada kelime', 'Konuşma süresi'], [[mt.words || '—', mt.unique ?? '—', mt.wpm ?? '—', fmtTime(mt.speak)]], true)
    : `<div class="metrics"><div class="metric"><b>${mt.words || '—'}</b><span>kelime</span></div><div class="metric"><b>${mt.unique ?? '—'}</b><span>farklı kelime</span></div><div class="metric"><b>${mt.wpm ?? '—'}</b><span>dakikada kelime</span></div><div class="metric"><b>${fmtTime(mt.speak)}</b><span>konuşma süresi</span></div></div>`);
  if (rep.meb_checklist?.length) sec('🏫 MEB Kazanım Kontrol Listesi', tbl(['Kazanım', 'Durum', 'Not'], rep.meb_checklist.map((x) => { const st = STATUS[x.status] || [x.status || '—', '']; return [esc(x.skill), `<span class="${st[1]}">${st[0]}</span>`, esc(x.note)]; }), word));
  sec('❌ Önemli Hatalar ve Düzeltmeleri', rep.errors?.length ? tbl(['Söylediğin', 'Doğrusu', 'Tür', 'Açıklama ve ek örnek'], rep.errors.map((e) => [esc(e.said), `<b>${esc(e.correction)}</b>`, esc(e.type || ''), esc(e.explanation) + (e.rule_example ? `<br><i>${esc(e.rule_example)}</i>` : '')]), word) : '<p class="muted">Belirgin hata bulunamadı.</p>');
  if (rep.improved_sentences?.length) sec('✨ Cümlelerini Daha İyi Hale Getir', tbl(['Senin cümlen', 'Daha doğal / ileri seviye', 'Neden?'], rep.improved_sentences.map((e) => [esc(e.original), `<b>${esc(e.improved)}</b>`, esc(e.why)]), word));
  if (rep.missing_points?.length) sec('🧩 Eksik Taraflar', tbl(['Alan', 'Ne eksik, ne yapmalı?'], rep.missing_points.map((e) => [`<b>${esc(e.area)}</b>`, esc(e.detail)]), word));
  sec(`🗣 Telaffuz Notları ${rep.audioUsed || word ? '' : '<span class="pill">ses olmadan tahmin</span>'}`, rep.pronunciation_notes?.length ? tbl(['Kelime', 'Not'], rep.pronunciation_notes.map((e) => [esc(e.word), esc(e.note)]), word) : '<p class="muted">Telaffuz notu yok.</p>');
  sec('📚 Çalışılacak Dil Bilgisi', listHtml(rep.grammar_focus));
  if (rep.vocabulary?.length) sec(`📖 Konuya Özel Kelime Listesi (${rep.vocabulary.length})`, tbl(['#', 'Kelime', 'Anlam', 'Örnek cümle'], rep.vocabulary.map((e, i) => [i + 1, `<b>${esc(e.word)}</b>${e.reading ? `<br><small>${esc(e.reading)}</small>` : ''}${e.pos ? `<br><small>${esc(e.pos)}</small>` : ''}`, esc(e.meaning), `${esc(e.example)}${e.example_tr ? `<br><small>${esc(e.example_tr)}</small>` : ''}`]), word));
  if (rep.phrases?.length) sec('💬 Faydalı Kalıplar', tbl(['Kalıp', 'Anlam', 'Örnek'], rep.phrases.map((e) => [`<b>${esc(e.phrase)}</b>`, esc(e.meaning), `${esc(e.example)}${e.example_tr ? `<br><small>${esc(e.example_tr)}</small>` : ''}`]), word));
  sec('🚀 Sonraki Adımlar', listHtml(rep.next_steps));
  if (rep.study_plan?.length) sec('📅 7 Günlük Çalışma Planı', tbl(['Gün', 'Görev'], rep.study_plan.map((e) => [`<b>${esc(e.day)}</b>`, esc(e.task)]), word));
  return S.join('');
}
function transcriptHtml(rec, word) {
  const c = rec.cfg; if (!rec.transcript?.length) return '';
  const rows = rec.transcript.map((m) => `<div class="msg ${m.role}" dir="auto"><small>${m.role === 't' ? esc(teacherName(c)) : esc(c.firstName || 'Öğrenci')}</small>${esc(m.text)}</div>`).join('');
  return word ? `<h2>Konuşma Dökümü</h2>${rec.transcript.map((t) => `<p><b>${t.role === 't' ? esc(teacherName(c)) : esc(c.firstName || 'Öğrenci')}:</b> ${esc(t.text)}</p>`).join('')}`
    : `<details class="rep-sec"><summary><b>💬 Konuşma Dökümü</b> (${rec.transcript.length} bölüm)</summary>${rows}</details>`;
}

function renderReport(rec, mode) {
  const live = jobs.get(rec.id)?.rec; if (live) rec = live; // çalışan değerlendirmenin güncel kaydı
  if (rec.status === 'evaluating') { renderPending(rec); return; }
  showView('report'); state.reportRecId = rec.id;
  const card = $('#reportCard'); const c = rec.cfg;
  if (!rec.report) {
    card.innerHTML = `<h2>${rec.status === 'cancelled' ? '⛔ Değerlendirme iptal edildi' : 'Rapor oluşturulamadı'}</h2><p>${esc(rec.error || 'Bilinmeyen hata')}</p>
      <p class="muted">Kayıt Geçmiş'te saklı. İnternet/anahtar sorunu giderilince tekrar değerlendirebilirsin.</p>
      <div class="row"><button class="primary" id="rpRetry" type="button">Tekrar dene</button><button class="ghost" id="rpNew" type="button">Yeni ders</button></div>${transcriptHtml(rec)}`;
    $('#rpNew').onclick = () => showView('setup'); $('#rpRetry').onclick = () => { runEvaluation(rec); renderPending(rec); };
    return;
  }
  mode = mode || state.activeTab || c.mode || 'medium'; state.activeTab = mode;
  const meta = rec.meta; const up = c.source === 'upload';
  card.innerHTML = `
    <h2>📝 ${up ? 'Ses Kaydı Raporu' : 'Ders Raporu'}</h2>
    <p><b>${esc(c.firstName)} ${esc(c.lastName)}</b> · ${esc(langOf(c.lang).name)} · hedef ${esc(c.level)} · <i>${esc(c.topic)}</i></p>
    ${c.grammar?.length ? `<p class="muted">Dil yapıları: ${esc(c.grammar.join(' · '))}</p>` : ''}
    <p class="muted">${new Date(rec.date).toLocaleString('tr-TR')} · ${up ? 'Kayıt' : 'Ders'} süresi ${fmtTime(meta.elapsedSec)} · Senin konuşman ≈ ${fmtTime(meta.studentSpeakSec)} · ~${meta.words} kelime · Tahmini seviye: <b>${esc(cefrOf(rec.report))}</b></p>
    <div class="tabs" id="repTabs">${['encouraging', 'medium', 'hard'].map((k) => `<button type="button" data-m="${k}" class="${k === mode ? 'active' : ''}">${MODE_LABEL[k]} · ${adjusted(rec, k).final}</button>`).join('')}</div>
    <div id="repBody">${modeSectionHtml(rec, mode)}</div>
    ${commonSectionHtml(rec)}
    ${transcriptHtml(rec)}
    <div class="row">
      <button class="primary" id="rpWord" type="button">📄 Word indir (bu mod)</button>
      <button class="ghost" id="rpWordAll" type="button">📄 Word (3 mod birlikte)</button>
      <button class="ghost" id="rpNew" type="button">➕ Yeni ders</button>
    </div>
    <p class="muted">${rec.audio ? '🎧 Ses kaydı Geçmiş bölümünde saklandı. ' : 'Ses kaydı saklanmadı. '}Raporun tamamı Geçmiş bölümüne kaydedildi.</p>
    <p class="muted center-text">${esc(SCHOOL_LINE)}</p>`;
  $('#repTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) renderReport(rec, b.dataset.m); };
  $('#rpWord').onclick = () => exportWord(rec, [mode]);
  $('#rpWordAll').onclick = () => exportWord(rec, ['encouraging', 'medium', 'hard']);
  $('#rpNew').onclick = () => showView('setup');
  window.scrollTo(0, 0);
}

/* ============================== Word çıktısı ============================== */
function exportWord(rec, modes) {
  const c = rec.cfg; const rep = rec.report; const meta = rec.meta;
  const css = `body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#3a2c14}h1{color:#8a5200}h2{color:#8a5200;border-bottom:1px solid #d8c288;padding-bottom:3px}h4{color:#8a5200;margin-bottom:2px}
    table{border-collapse:collapse;width:100%}td,th{border:1px solid #b9a56b;padding:4px 6px;vertical-align:top}th{background:#fbf0cf}.big{font-size:26pt;color:#8a5200;font-weight:bold}.foot{color:#7d6b47;font-size:9pt;text-align:center;margin-top:24px}.pill{font-size:9pt}`;
  let body = `<h1>KONUŞKAN <span style="font-size:11pt;font-style:italic;font-weight:normal">hoca</span> – Konuşma Değerlendirme Raporu</h1>
    <table border="1" cellspacing="0" cellpadding="4"><tr><th>Öğrenci</th><td>${esc(c.firstName)} ${esc(c.lastName)}</td><th>Dil / Hedef seviye</th><td>${esc(langOf(c.lang).name)} / ${esc(c.level)}</td></tr>
    <tr><th>Konu</th><td>${esc(c.topic)}</td><th>Tarih</th><td>${new Date(rec.date).toLocaleString('tr-TR')}</td></tr>
    <tr><th>${c.source === 'upload' ? 'Kayıt' : 'Ders'} süresi</th><td>${fmtTime(meta.elapsedSec)}${meta.targetSec ? ' / hedef ' + fmtTime(meta.targetSec) : ''}</td><th>Tahmini seviye</th><td>${esc(cefrOf(rep))}</td></tr>
    ${c.grammar?.length ? `<tr><th>Dil yapıları</th><td colspan="3">${esc(c.grammar.join(' · '))}</td></tr>` : ''}</table>`;
  for (const mode of modes) body += `<h2>${MODE_LABEL[mode].replace(/^\S+\s/, '')} Değerlendirme</h2>${modeSectionHtml(rec, mode, true)}`;
  body += `<h2>Ayrıntılı Analiz</h2>${commonSectionHtml(rec, true)}${transcriptHtml(rec, true)}<p class="foot">${esc(SCHOOL_LINE)}</p>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Rapor</title><style>${css}</style></head><body>${body}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const safe = (s) => String(s).replace(/[^\w\-ığüşöçİĞÜŞÖÇ]+/g, '_');
  const fname = `Konuskan_Rapor_${safe(c.firstName)}_${safe(c.lastName)}_${new Date(rec.date).toISOString().slice(0, 10)}.doc`;
  // Android uygulamasında (WebView) doğrudan indirme çalışmaz: paylaşım menüsüyle Word/Drive/WhatsApp'a gönderilir
  if (window.Capacitor && navigator.canShare) {
    const file = new File([blob], fname, { type: 'application/msword' });
    if (navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'KONUŞKAN hoca raporu' }).catch(() => {}); return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ============================== Geçmiş ============================== */
async function renderHistory() {
  const box = $('#historyList');
  let all = []; try { all = await DB.all(); } catch (e) { box.innerHTML = `<p>Geçmiş okunamadı: ${esc(e.message)}</p>`; return; }
  all = all.map((r) => jobs.get(r.id)?.rec || r).filter((r) => !r.deleted);
  all.sort((a, b) => b.date - a.date);
  if (!all.length) { box.innerHTML = '<p class="muted">Henüz kayıtlı ders yok.</p>'; return; }
  box.innerHTML = all.map((r) => {
    const c = r.cfg; const busy = r.status === 'evaluating';
    const sc = busy ? '<span class="pill">⏳ değerlendiriliyor</span>'
      : r.report ? ['encouraging', 'medium', 'hard'].map((k) => `<span class="pill">${MODE_LABEL[k].split(' ')[0]} ${adjusted(r, k).final}</span>`).join('') + `<span class="pill">${esc(cefrOf(r.report))}</span>`
        : `<span class="pill">${r.status === 'cancelled' ? '⛔ iptal edildi' : '⚠ rapor yok'}</span>`;
    const btns = busy ? '<button class="ghost" data-a="view" type="button">Göster</button><button class="ghost" data-a="cancel" type="button">İptal</button>'
      : r.report ? '<button class="primary" data-a="open" type="button">Raporu aç</button><button class="ghost" data-a="word" type="button">📄 Word</button>'
        : '<button class="primary" data-a="retry" type="button">Tekrar değerlendir</button><button class="ghost" data-a="open" type="button">Dökümü gör</button>';
    return `<div class="hist-item" data-id="${r.id}"><b>${esc(c.firstName)} ${esc(c.lastName)}</b> · ${c.source === 'upload' ? '📁 kayıt · ' : ''}${esc(langOf(c.lang).name)} · ${esc(c.topic)} · ${esc(c.level)}<div class="muted">${new Date(r.date).toLocaleString('tr-TR')} · ${fmtTime(r.meta.elapsedSec)}</div><div>${sc}</div>
      <div class="row">${btns}${r.audio ? '<button class="ghost" data-a="play" type="button">🎧 Dinle</button><button class="ghost" data-a="delaudio" type="button">Sesi sil</button>' : ''}<button class="ghost" data-a="del" type="button">🗑 Sil</button></div><div class="aud"></div></div>`;
  }).join('') + '<div class="row"><button class="ghost" id="histClear" type="button">Tüm geçmişi sil</button></div>';
  $('#histClear').onclick = async () => { if (confirm('Tüm dersler, raporlar ve ses kayıtları silinsin mi?')) { for (const r of all) await removeRecord(r.id); renderHistory(); } };
  $$('.hist-item', box).forEach((el) => el.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return; const id = el.dataset.id;
    const rec = jobs.get(id)?.rec || await DB.get(id); if (!rec) return;
    const a = b.dataset.a;
    if (a === 'open' || a === 'view') { state.lastRec = rec; renderReport(rec); }
    else if (a === 'word') exportWord(rec, ['encouraging', 'medium', 'hard']);
    else if (a === 'cancel') cancelEvaluation(id);
    else if (a === 'retry') { runEvaluation(rec); renderPending(rec); }
    else if (a === 'play') { const url = URL.createObjectURL(rec.audio); $('.aud', el).innerHTML = `<audio controls autoplay src="${url}" style="width:100%;margin-top:8px"></audio>`; }
    else if (a === 'delaudio') { rec.audio = null; rec.keepAudio = false; await DB.put(rec); attention.delete(id); renderJobBar(); renderHistory(); }
    else if (a === 'del') { if (confirm('Bu kayıt silinsin mi?')) { await removeRecord(id); renderHistory(); } }
  });
}

/* ============================== Kayıt Değerlendir (canlı ders yerine ses kaydı) ============================== */
const up = { chunks: null, blob: null, mime: 'audio/wav', durSec: 0, speakSec: 0, rec: null, tmr: null, t0: 0 };
function initUpload() {
  const p = LS.get('upProfile', {});
  ['upFirst', 'upLast', 'upLang', 'upLevel', 'upTopic'].forEach((id) => { if (p[id] !== undefined) $('#' + id).value = p[id]; });
  if (!LANGS[$('#upLang').value]) $('#upLang').value = $('#lang').value || 'en';
  if (p.upLevel === undefined) $('#upLevel').value = 'B1';
  $('#upLang').onchange = () => { $('#upTopic').dir = langOf($('#upLang').value).dir || 'auto'; };
  $('#upRec').onclick = upStartRec; $('#upStop').onclick = upStopRec;
  $('#upFile').onchange = (e) => upLoadFile(e.target.files[0]);
  $('#upEval').onclick = upEvaluate;
}
function upSetAudio(blob, mime, durSec, speakSec, info) {
  up.blob = blob; up.mime = mime; up.durSec = Math.round(durSec); up.speakSec = Math.round(speakSec);
  const pl = $('#upPlayer'); if (pl.src) URL.revokeObjectURL(pl.src); pl.src = URL.createObjectURL(blob); pl.hidden = false;
  $('#upDur').value = up.durSec; $('#upInfo').textContent = info; $('#upEval').disabled = false;
}
async function upStartRec() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Bu cihaz/tarayıcı mikrofonu desteklemiyor (HTTPS gerekir).'); return; }
  if (state.session?.active) { toast('Önce canlı dersi bitir; mikrofon kullanımda.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC(); await ctx.resume();
    const src = ctx.createMediaStreamSource(stream); const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
    const chunks = []; let speak = 0;
    const onChunk = (f32) => { const d = downsample(f32, ctx.sampleRate); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; if (Math.sqrt(s / Math.max(1, d.length)) > 0.012) speak += d.length / 16000; chunks.push(f32ToI16(d)); };
    let node;
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, 'cap'); node.port.onmessage = (e) => onChunk(e.data);
    } else { node = ctx.createScriptProcessor(2048, 1, 1); node.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0))); }
    src.connect(node); node.connect(sink);
    up.rec = { stream, ctx, node, chunks, get speak() { return speak; } }; up.t0 = Date.now();
    $('#upRec').hidden = true; $('#upStop').hidden = false; $('#upEval').disabled = true;
    up.tmr = setInterval(() => { $('#upTimer').textContent = fmtTime((Date.now() - up.t0) / 1000); }, 500);
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi.' : e.message, 6000); }
}
function upStopRec() {
  const r = up.rec; if (!r) return; clearInterval(up.tmr); up.rec = null;
  try { r.node.disconnect(); r.stream.getTracks().forEach((t) => t.stop()); r.ctx.close(); } catch { /* yoksay */ }
  $('#upRec').hidden = false; $('#upStop').hidden = true;
  const dur = r.chunks.reduce((a, c) => a + c.length, 0) / 16000;
  if (dur < 3) { toast('Kayıt çok kısa (en az birkaç saniye konuş).'); return; }
  const w = buildWav(r.chunks, 16000);
  upSetAudio(w.blob, 'audio/wav', dur, r.speak, `🎙 Kayıt alındı: ${fmtTime(dur)}`);
}
const guessMime = (f) => f.type || ({ mp3: 'audio/mp3', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm' }[(f.name.split('.').pop() || '').toLowerCase()] || 'audio/mpeg');
function mediaDuration(blob) {
  return new Promise((res) => { const a = new Audio(); a.preload = 'metadata'; const u = URL.createObjectURL(blob); a.src = u; a.onloadedmetadata = () => { res(isFinite(a.duration) ? a.duration : 0); URL.revokeObjectURL(u); }; a.onerror = () => { res(0); URL.revokeObjectURL(u); }; });
}
async function upLoadFile(file) {
  if (!file) return; $('#upInfo').textContent = '⏳ Dosya hazırlanıyor…'; $('#upEval').disabled = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; let ctx;
    try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
    const ab = await file.arrayBuffer();
    const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
    // tek kanala indir, 16 kHz'e getir, WAV yap
    const n = audio.length, ch = audio.numberOfChannels; const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    const d16 = downsample(mono, audio.sampleRate, 16000); try { ctx.close(); } catch { /* yoksay */ }
    const i16 = f32ToI16(d16); let speak = 0;
    for (let i = 0; i + 320 <= d16.length; i += 320) { let s = 0; for (let j = 0; j < 320; j++) s += d16[i + j] * d16[i + j]; if (Math.sqrt(s / 320) > 0.012) speak += 0.02; }
    const chunks = []; for (let i = 0; i < i16.length; i += 32000) chunks.push(i16.subarray(i, i + 32000));
    const w = buildWav(chunks, 16000);
    upSetAudio(w.blob, 'audio/wav', d16.length / 16000, speak, `📂 ${file.name} · ${fmtTime(d16.length / 16000)}`);
  } catch (e) {
    // çözülemezse dosyayı olduğu gibi gönder (≤ 14 MB)
    if (file.size <= 14 * 1024 * 1024) { const dur = await mediaDuration(file); upSetAudio(file, guessMime(file), dur, dur * 0.7, `📂 ${file.name} (özgün biçimde gönderilecek)`); }
    else { $('#upInfo').textContent = ''; toast('Bu dosya okunamadı veya çok büyük. WAV/MP3 (≤ 14 MB) dene.', 7000); }
  }
}
async function upEvaluate() {
  if (!getKey()) { toast('Önce Ayarlar bölümüne API anahtarını gir.'); showView('settings'); return; }
  if (!up.blob) return;
  const L = $('#upLang').value; const topic = $('#upTopic').value.trim();
  LS.set('upProfile', { upFirst: $('#upFirst').value, upLast: $('#upLast').value, upLang: L, upLevel: $('#upLevel').value, upTopic: topic });
  const dur = Math.max(1, parseInt($('#upDur').value, 10) || up.durSec); const target = (upDurPick.get() || 0) * 60;
  const cfg = { firstName: $('#upFirst').value.trim() || 'Misafir', lastName: $('#upLast').value.trim(), lang: L, level: $('#upLevel').value, topic: topic || 'Serbest konuşma (kayıt)', topicEn: topic || 'Free speaking (recorded)', topicNative: '', themeFromList: false, grammar: [], teacherGender: 'female', voiceName: '', minutes: target / 60, mode: 'medium', trHelp: 'none', micMode: 'auto', source: 'upload' };
  const meta = { elapsedSec: dur, targetSec: target, studentSpeakSec: Math.min(dur, up.speakSec || dur), words: 0 };
  meta.ratio = target > 0 ? Math.min(1, dur / target) : 1;
  const pref = LS.get('recPref', 'ask');
  const rec = { v: 3, id: 'ses_' + Date.now(), date: Date.now(), cfg, transcript: [], meta, report: null, error: null, status: 'evaluating', audio: up.blob, keepAudio: pref === 'keep' ? true : pref === 'delete' ? false : null };
  try { await DB.put(rec); } catch (e) { toast('Geçmişe kaydedilemedi: ' + e.message, 6000); }
  runEvaluation(rec); renderPending(rec);
}

/* ============================== Uygulamayı yükle (PWA) ============================== */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btnInstall').hidden = false; });
window.addEventListener('appinstalled', () => { installEvt = null; $('#btnInstall').hidden = true; toast('Uygulama yüklendi 🎉'); });
$('#btnInstall').onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch { /* yoksay */ } installEvt = null; $('#btnInstall').hidden = true; };
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (isIOS && !isStandalone) $('#iosHint').hidden = false;


/* ============================== Başlat ============================== */
initUISettings(); initSettings(); initSetup(); renderJobBar(); resumePending();
if (!LS.get('apiKey')) { toast('Başlamak için Ayarlar’dan API anahtarını gir.', 5000); }
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
