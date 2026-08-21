const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "data", "slavyanka.db");
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager','technologist','otk','supplier'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  protection_class TEXT,
  climate_zone TEXT,
  material TEXT,
  tn_ved TEXT,
  okpd2 TEXT,
  tu TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT,
  price REAL
);

CREATE TABLE IF NOT EXISTS product_materials (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  consumption REAL,
  PRIMARY KEY (product_id, material_id)
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid'
);

CREATE TABLE IF NOT EXISTS product_certificates (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  certificate_id INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, certificate_id)
);

CREATE TABLE IF NOT EXISTS contractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  inn TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL,
  contractor_id INTEGER NOT NULL REFERENCES contractors(id),
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS deal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  task TEXT,
  result TEXT,
  defect_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  inspector TEXT,
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  due_date TEXT,
  assignee TEXT
);
`);

const count = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
if (count === 0) {
  seed();
}

function seed() {
  const ins = db.prepare(
    "INSERT INTO products (name, code, protection_class, climate_zone, material, tn_ved, okpd2, tu, description) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  const products = [
    [
      "Костюм огнестойкий сварщика «Страж-1»",
      "SV-01",
      "Класс 1 (защита от тепла и огня)",
      "I–III",
      "Термостойкая ткань Т-2",
      "6203.22.8000",
      "14.12.30.150",
      "ТУ 8572-001-22345678-2021",
      "Огнестойкий костюм для сварки и горячих работ",
    ],
    [
      "Костюм антистатический «Электрон-2»",
      "EL-02",
      "Антистатика (защита от стат. электричества)",
      "I–IV",
      "Смесовая ткань с антистатической нитью",
      "6203.43.9000",
      "14.12.30.160",
      "ТУ 8572-004-22345678-2022",
      "Для работы с взрывопожароопасными средами",
    ],
    [
      "Комплект защиты от нефти «Нефтяник»",
      "NP-03",
      "Защита от нефти и нефтепродуктов",
      "I–II",
      "ПВХ-ткань с маслостойкой пропиткой",
      "6210.40.0000",
      "14.12.30.170",
      "ТУ 8572-007-22345678-2022",
      "Куртка и полукомбинезон для нефтяной отрасли",
    ],
    [
      "Костюм энцефалитный «Тайга»",
      "TG-04",
      "Защита от клещей и механических повреждений",
      "I–IV",
      "Плотная хлопковая ткань «Грета»",
      "6203.49.9000",
      "14.12.30.140",
      "ТУ 8572-010-22345678-2023",
      "Для лесных, полевых и геологоразведочных работ",
    ],
    [
      "Костюм «Универсал» сигнальный (сигнальный класс 2)",
      "UN-05",
      "Сигнальная защита, видимость",
      "I–IV",
      "Смесовая ткань с флюоресцентными полосами",
      "6203.42.9000",
      "14.12.30.190",
      "ТУ 8572-012-22345678-2023",
      "Для дорожных и монтажных работ",
    ],
  ];
  for (const p of products) ins.run(...p);

  const matIns = db.prepare("INSERT INTO materials (name, unit, price) VALUES (?,?,?)");
  const materials = [
    ["Термостойкая ткань Т-2", "м", 780],
    ["Смесовая ткань с антистатической нитью", "м", 420],
    ["ПВХ-ткань маслостойкая", "м", 560],
    ["Хлопковая ткань «Грета»", "м", 350],
    ["Фурнитура (молнии, кнопки)", "компл.", 120],
  ];
  for (const m of materials) matIns.run(...m);

  const pmIns = db.prepare(
    "INSERT INTO product_materials (product_id, material_id, consumption) VALUES (?,?,?)"
  );
  // потребности по изделиям: продукт 1 → ткань Т-2 (2.6 м), фурнитура; и т.д.
  pmIns.run(1, 1, 2.6);
  pmIns.run(1, 5, 1);
  pmIns.run(2, 2, 2.4);
  pmIns.run(2, 5, 1);
  pmIns.run(3, 3, 2.8);
  pmIns.run(3, 5, 1);
  pmIns.run(4, 4, 3.1);
  pmIns.run(4, 5, 1);
  pmIns.run(5, 2, 2.2);
  pmIns.run(5, 5, 1);

  const certIns = db.prepare(
    "INSERT INTO certificates (number, name, issue_date, expiry_date, status) VALUES (?,?,?,?,?)"
  );
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const addDays = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return fmt(d);
  };
  const certs = [
    ["ЕАЭС RU С-RU.ПБ08.В.01234/23", "Сертификат соответствия (огнестойкая)", addDays(-300), addDays(65), "valid"],
    ["ЕАЭС RU С-RU.ПБ08.В.09876/22", "Сертификат на антистатический костюм", addDays(-520), addDays(20), "expiring"],
    ["РССА RU.АЮ01.Н.00112", "Декларация соответствия ТР ТС 019/2011", addDays(-400), addDays(240), "valid"],
    ["ЕАЭС RU С-RU.АЮ17.В.00555/21", "Сертификат на энцефалитный костюм", addDays(-700), addDays(-45), "expired"],
  ];
  for (const c of certs) certIns.run(...c);

  const pcIns = db.prepare(
    "INSERT INTO product_certificates (product_id, certificate_id) VALUES (?,?)"
  );
  pcIns.run(1, 1);
  pcIns.run(1, 3);
  pcIns.run(2, 2);
  pcIns.run(3, 3);
  pcIns.run(4, 4);

  const conIns = db.prepare(
    "INSERT INTO contractors (name, inn, contact_person, phone, email) VALUES (?,?,?,?,?)"
  );
  const contractors = [
    ["ООО «НефтеСервис»", "7725123456", "Иванов П.С.", "+7 (901) 234-56-78", "zakupki@nefteservis.ru"],
    ["АО «ЭнергоСтрой»", "7743123456", "Петрова Е.А.", "+7 (902) 345-67-89", "tender@energostroy.ru"],
    ["ООО «ЛесПром»", "7604123456", "Сидоров В.Н.", "+7 (903) 456-78-90", "info@lesprom.ru"],
    ["ГБУ «Дорсервис»", "7715123456", "Кузнецов А.А.", "+7 (904) 567-89-01", "zakupki@dorservis.ru"],
  ];
  for (const c of contractors) conIns.run(...c);

  const dealIns = db.prepare(
    "INSERT INTO deals (number, contractor_id, status, created_at, comment) VALUES (?,?,?,?,?)"
  );
  const deals = [
    ["Д-2026/001", 1, "in_progress", addDays(-12), "Поставка огнестойких костюмов, 120 шт."],
    ["Д-2026/002", 2, "new", addDays(-3), "Костюмы антистатические для подстанций"],
    ["Д-2026/003", 3, "done", addDays(-30), "Энцефалитные костюмы, сезонная партия"],
    ["Д-2026/004", 4, "new", addDays(-1), "Сигнальные костюмы для дорожных работ"],
  ];
  for (const d of deals) dealIns.run(...d);

  const diIns = db.prepare(
    "INSERT INTO deal_items (deal_id, product_id, qty, price) VALUES (?,?,?,?)"
  );
  diIns.run(1, 1, 120, 8900);
  diIns.run(1, 3, 40, 7600);
  diIns.run(2, 2, 90, 9400);
  diIns.run(3, 4, 150, 6800);
  diIns.run(4, 5, 60, 7200);

  const qIns = db.prepare(
    "INSERT INTO quality_checks (deal_id, product_id, task, result, defect_count, status, inspector, checked_at) VALUES (?,?,?,?,?,?,?,?)"
  );
  qIns.run(1, 1, "Проверка партии №1: огнестойкие костюмы", "passed", 2, "passed", "Морозова О.В.", addDays(-8));
  qIns.run(3, 4, "Входной контроль энцефалитных костюмов", "passed", 0, "passed", "Морозова О.В.", addDays(-25));
  qIns.run(2, 2, "Проверка пробной партии антистат. костюмов", null, 0, "pending", null, null);

  const taskIns = db.prepare(
    "INSERT INTO tasks (role, title, related_type, related_id, status, due_date, assignee) VALUES (?,?,?,?,?,?,?)"
  );
  taskIns.run("manager", "Согласовать КП по сделке Д-2026/002", "deal", 2, "open", addDays(2), null);
  taskIns.run("technologist", "Обновить карточку «Нефтяник»: доп. размерный ряд", "product", 3, "open", addDays(5), null);
  taskIns.run("otk", "Проверить партию антистатических костюмов", "deal", 2, "open", addDays(3), null);
  taskIns.run("supplier", "Закупка ткани Т-2 под сделку Д-2026/001", "deal", 1, "open", addDays(4), null);
  taskIns.run("supplier", "Продлить сертификат № ЕАЭС RU С-RU.ПБ08.В.09876/22", "certificate", 2, "open", addDays(10), null);

  const userIns = db.prepare("INSERT INTO users (name, role) VALUES (?,?)");
  const users = [
    ["Громов А.И.", "manager"],
    ["Соколова Н.М.", "technologist"],
    ["Морозова О.В.", "otk"],
    ["Лесной Д.П.", "supplier"],
  ];
  for (const u of users) userIns.run(...u);

  console.log("База данных создана, демо-данные загружены.");
}

module.exports = db;