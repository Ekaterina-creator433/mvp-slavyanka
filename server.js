require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage() });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowLocal() {
  return new Date().toLocaleString("ru-RU");
}

// ---- Уведомления (консоль + Telegram, если настроен) ----
async function notify(text) {
  console.log(`[NOTIFY] ${nowLocal()}: ${text}`);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== "your_bot_token_here") {
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      });
    } catch (e) {
      console.error("Telegram error:", e.message);
    }
  }
}

function expiryStatus(daysLeft) {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring";
  return "valid";
}

function daysUntil(dateISO) {
  const diff = new Date(dateISO).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

// =============================== НОМЕНКЛАТУРА ===============================
app.get("/api/products", (req, res) => {
  const rows = db
    .prepare(
      "SELECT p.*, (SELECT COUNT(*) FROM product_certificates pc JOIN certificates c ON c.id=pc.certificate_id WHERE pc.product_id=p.id) AS cert_count FROM products p ORDER BY p.id"
    )
    .all();
  res.json(rows);
});

app.get("/api/products/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  p.certificates = db
    .prepare(
      "SELECT c.* FROM certificates c JOIN product_certificates pc ON pc.certificate_id=c.id WHERE pc.product_id=?"
    )
    .all(p.id);
  p.materials = db
    .prepare(
      "SELECT m.*, pm.consumption FROM materials m JOIN product_materials pm ON pm.material_id=m.id WHERE pm.product_id=?"
    )
    .all(p.id);
  res.json(p);
});

app.post("/api/products", (req, res) => {
  const r = req.body;
  const p = db
    .prepare(
      "INSERT INTO products (name, code, protection_class, climate_zone, material, tn_ved, okpd2, tu, description) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(
      r.name,
      r.code,
      r.protection_class || null,
      r.climate_zone || null,
      r.material || null,
      r.tn_ved || null,
      r.okpd2 || null,
      r.tu || null,
      r.description || null
    );
  res.json({ ok: true, id: p.lastInsertRowid });
});

app.put("/api/products/:id", (req, res) => {
  const r = req.body;
  db.prepare(
    "UPDATE products SET name=?, code=?, protection_class=?, climate_zone=?, material=?, tn_ved=?, okpd2=?, tu=?, description=? WHERE id=?"
  ).run(
    r.name,
    r.code,
    r.protection_class,
    r.climate_zone,
    r.material,
    r.tn_ved,
    r.okpd2,
    r.tu,
    r.description,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/products/:id", (req, res) => {
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---- Материалы ----
app.get("/api/materials", (req, res) => res.json(db.prepare("SELECT * FROM materials ORDER BY id").all()));
app.post("/api/materials", (req, res) => {
  const r = req.body;
  const m = db.prepare("INSERT INTO materials (name, unit, price) VALUES (?,?,?)").run(r.name, r.unit || null, r.price || 0);
  res.json({ ok: true, id: m.lastInsertRowid });
});

// =============================== СЕРТИФИКАТЫ ===============================
app.get("/api/certificates", (req, res) => {
  const rows = db.prepare("SELECT * FROM certificates ORDER BY expiry_date").all();
  rows.forEach((c) => {
    c.days_left = daysUntil(c.expiry_date);
    c.status = expiryStatus(c.days_left);
  });
  res.json(rows);
});

app.post("/api/certificates", (req, res) => {
  const r = req.body;
  const c = db
    .prepare("INSERT INTO certificates (number, name, issue_date, expiry_date, status) VALUES (?,?,?,?,?)")
    .run(r.number, r.name, r.issue_date, r.expiry_date, "valid");
  if (Array.isArray(r.product_ids)) {
    const ins = db.prepare("INSERT INTO product_certificates (product_id, certificate_id) VALUES (?,?)");
    for (const pid of r.product_ids) ins.run(pid, c.lastInsertRowid);
  }
  notify(`Добавлен сертификат ${r.number} (${r.name}), действует до ${r.expiry_date}`);
  res.json({ ok: true, id: c.lastInsertRowid });
});

app.patch("/api/certificates/:id/status", (req, res) => {
  db.prepare("UPDATE certificates SET status=? WHERE id=?").run(req.body.status || "valid", req.params.id);
  res.json({ ok: true });
});

app.get("/api/certificates/expiring", (req, res) => {
  const rows = db.prepare("SELECT * FROM certificates").all();
  const soon = rows.filter((c) => daysUntil(c.expiry_date) <= 30);
  soon.forEach((c) => (c.days_left = daysUntil(c.expiry_date)));
  res.json(soon);
});

// =============================== РЕЕСТР МИНПРОМТОРГА ===============================
app.get("/api/minpromtorg", (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.*, p.name AS product_name, p.code AS product_code
       FROM minpromtorg_records m
       JOIN products p ON p.id = m.product_id
       ORDER BY m.included_date DESC`
    )
    .all();
  res.json(rows);
});

app.post("/api/minpromtorg", (req, res) => {
  const r = req.body;
  if (!r.product_id || !r.registry_number || !r.included_date) {
    return res.status(400).json({ ok: false, error: "Заполните изделие, номер записи и дату включения" });
  }
  try {
    const rec = db
      .prepare("INSERT INTO minpromtorg_records (product_id, registry_number, included_date, status, note) VALUES (?,?,?,?,?)")
      .run(r.product_id, r.registry_number, r.included_date, r.status || "active", r.note || null);
    notify(`Добавлена реестровая запись Минпромторга ${r.registry_number}`);
    res.json({ ok: true, id: rec.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete("/api/minpromtorg/:id", (req, res) => {
  db.prepare("DELETE FROM minpromtorg_records WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// =============================== КОНТРАГЕНТЫ ===============================
app.get("/api/contractors", (req, res) => res.json(db.prepare("SELECT * FROM contractors ORDER BY id").all()));
app.post("/api/contractors", (req, res) => {
  const r = req.body;
  const c = db
    .prepare("INSERT INTO contractors (name, inn, contact_person, phone, email) VALUES (?,?,?,?,?)")
    .run(r.name, r.inn || null, r.contact_person || null, r.phone || null, r.email || null);
  res.json({ ok: true, id: c.lastInsertRowid });
});

// =============================== СДЕЛКИ ===============================
app.get("/api/deals", (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, c.name AS contractor_name,
        (SELECT COUNT(*) FROM deal_items di WHERE di.deal_id=d.id) AS items_count,
        (SELECT COALESCE(SUM(di.qty*di.price),0) FROM deal_items di WHERE di.deal_id=d.id) AS total
       FROM deals d JOIN contractors c ON c.id=d.contractor_id ORDER BY d.id DESC`
    )
    .all();
  res.json(rows);
});

app.get("/api/deals/:id", (req, res) => {
  const d = db.prepare("SELECT * FROM deals WHERE id=?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  d.contractor = db.prepare("SELECT * FROM contractors WHERE id=?").get(d.contractor_id);
  d.items = db
    .prepare(
      `SELECT di.*, p.name AS product_name, p.code AS product_code
       FROM deal_items di JOIN products p ON p.id=di.product_id WHERE di.deal_id=?`
    )
    .all(d.id);
  d.total = d.items.reduce((s, i) => s + i.qty * i.price, 0);
  d.documents = db.prepare("SELECT * FROM documents WHERE deal_id=? ORDER BY created_at DESC").all(d.id);
  res.json(d);
});

app.post("/api/deals", (req, res) => {
  const r = req.body;
  const number = r.number || `Д-${new Date().getFullYear()}/${String(Date.now()).slice(-4)}`;
  const d = db
    .prepare("INSERT INTO deals (number, contractor_id, status, created_at, comment) VALUES (?,?,?,?,?)")
    .run(number, r.contractor_id, r.status || "new", todayISO(), r.comment || null);
  if (Array.isArray(r.items)) {
    const ins = db.prepare("INSERT INTO deal_items (deal_id, product_id, qty, price) VALUES (?,?,?,?)");
    for (const it of r.items) ins.run(d.lastInsertRowid, it.product_id, it.qty || 1, it.price || 0);
  }
  const con = db.prepare("SELECT name FROM contractors WHERE id=?").get(r.contractor_id);
  notify(`Новая сделка ${number}: ${con ? con.name : ""} (${r.comment || ""})`);
  res.json({ ok: true, id: d.lastInsertRowid, number });
});

app.post("/api/deals/:id/items", (req, res) => {
  const r = req.body;
  db.prepare("INSERT INTO deal_items (deal_id, product_id, qty, price) VALUES (?,?,?,?)").run(
    req.params.id,
    r.product_id,
    r.qty || 1,
    r.price || 0
  );
  res.json({ ok: true });
});

app.patch("/api/deals/:id", (req, res) => {
  db.prepare("UPDATE deals SET status=?, comment=? WHERE id=?").run(
    req.body.status || "new",
    req.body.comment ?? db.prepare("SELECT comment FROM deals WHERE id=?").get(req.params.id).comment,
    req.params.id
  );
  res.json({ ok: true });
});

// ---- Документы из шаблонов (КП / договор / акт) ----
const TEMPLATES = {
  kp: (d, items) =>
    `КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ ${d.number}\nДата: ${d.created_at}\nЗаказчик: ${d.contractor.name} (ИНН ${d.contractor.inn || "—"})\n\nПозиции:\n${items
      .map((i, n) => `${n + 1}. ${i.product_name} (${i.product_code}) — ${i.qty} шт × ${i.price} ₽ = ${i.qty * i.price} ₽`)
      .join("\n")}\n\nИтого: ${d.total} ₽\nУсловия: 50% предоплата, срок поставки 30 дней.`,
  contract: (d, items) =>
    `ДОГОВОР ПОСТАВКИ № ${d.number}\nДата: ${d.created_at}\nПоставщик: ООО «Славянка Текстиль»\nПокупатель: ${d.contractor.name} (ИНН ${d.contractor.inn || "—"})\n\nПредмет договора:\n${items
      .map((i, n) => `${n + 1}. ${i.product_name} — ${i.qty} шт, цена ${i.price} ₽/шт, сумма ${i.qty * i.price} ₽`)
      .join("\n")}\n\nСумма договора: ${d.total} ₽.\nКачество товара подтверждается сертификатами соответствия.`,
  act: (d, items) =>
    `АКТ ПРИЁМКИ ТОВАРА № ${d.number}\nДата: ${todayISO()}\nПо договору ${d.number} от ${d.created_at}\nПоставщик: ООО «Славянка Текстиль»\nПокупатель: ${d.contractor.name}\n\nТовар передан и принят:\n${items
      .map((i) => `- ${i.product_name} — ${i.qty} шт`)
      .join("\n")}\nПретензий к качеству нет. ОТК: ________`,
};

app.post("/api/deals/:id/documents", (req, res) => {
  const d = db.prepare("SELECT * FROM deals WHERE id=?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  d.contractor = db.prepare("SELECT * FROM contractors WHERE id=?").get(d.contractor_id);
  d.items = db
    .prepare(
      `SELECT di.*, p.name AS product_name, p.code AS product_code FROM deal_items di JOIN products p ON p.id=di.product_id WHERE di.deal_id=?`
    )
    .all(d.id);
  d.total = d.items.reduce((s, i) => s + i.qty * i.price, 0);
  const type = req.body.type || "kp";
  const fn = TEMPLATES[type];
  if (!fn) return res.status(400).json({ error: "unknown document type" });
  const dir = path.join(__dirname, "data", "documents");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${type.toUpperCase()}_${d.number.replace(/[^\w-]/g, "_")}.txt`;
  fs.writeFileSync(path.join(dir, filename), fn(d, d.items));
  db.prepare("INSERT INTO documents (deal_id, type, filename, created_at) VALUES (?,?,?,?)").run(
    d.id,
    type,
    filename,
    todayISO()
  );
  notify(`Сформирован документ ${type.toUpperCase()} по сделке ${d.number}`);
  res.json({ ok: true, filename, path: `/api/documents/${filename}` });
});

app.get("/api/documents/:filename", (req, res) => {
  const file = path.join(__dirname, "data", "documents", req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
  res.type("text/plain").send(fs.readFileSync(file, "utf8"));
});

// =============================== ОТК (качество) ===============================
app.get("/api/quality", (req, res) => {
  const rows = db
    .prepare(
      `SELECT q.*, d.number AS deal_number, p.name AS product_name
       FROM quality_checks q JOIN deals d ON d.id=q.deal_id JOIN products p ON p.id=q.product_id ORDER BY q.id DESC`
    )
    .all();
  res.json(rows);
});

app.post("/api/quality", (req, res) => {
  const r = req.body;
  const q = db
    .prepare(
      "INSERT INTO quality_checks (deal_id, product_id, task, status, inspector) VALUES (?,?,?,?,?)"
    )
    .run(r.deal_id, r.product_id, r.task || "Проверка партии", "pending", r.inspector || null);
  res.json({ ok: true, id: q.lastInsertRowid });
});

app.patch("/api/quality/:id", (req, res) => {
  const r = req.body;
  db.prepare(
    "UPDATE quality_checks SET status=?, result=?, defect_count=?, checked_at=? WHERE id=?"
  ).run(r.status || "pending", r.result || null, r.defect_count || 0, todayISO(), req.params.id);
  const q = db.prepare("SELECT deal_id FROM quality_checks WHERE id=?").get(req.params.id);
  if (r.status === "passed") {
    notify(`ОТК: партия по сделке #${q.deal_id} прошла контроль (${r.result || "ok"})`);
  }
  res.json({ ok: true });
});

// =============================== ЗАДАЧИ ===============================
app.get("/api/tasks", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM tasks WHERE (:role IS NULL OR role=:role) ORDER BY (status='open') DESC, id DESC")
    .all({ role: req.query.role || null });
  res.json(rows);
});

app.post("/api/tasks", (req, res) => {
  const r = req.body;
  const t = db
    .prepare("INSERT INTO tasks (role, title, related_type, related_id, status, due_date, assignee) VALUES (?,?,?,?,?,?,?)")
    .run(r.role, r.title, r.related_type || null, r.related_id || null, r.status || "open", r.due_date || null, r.assignee || null);
  notify(`Задача для ${r.role}: ${r.title}`);
  res.json({ ok: true, id: t.lastInsertRowid });
});

app.patch("/api/tasks/:id", (req, res) => {
  db.prepare("UPDATE tasks SET status=?, assignee=? WHERE id=?").run(
    req.body.status || "open",
    req.body.assignee || null,
    req.params.id
  );
  res.json({ ok: true });
});

// =============================== ИМПОРТ / ЭКСПОРТ ===============================
const ENTITY_MAP = {
  products: { table: "products", cols: ["name", "code", "protection_class", "climate_zone", "material", "tn_ved", "okpd2", "tu", "description"] },
  certificates: { table: "certificates", cols: ["number", "name", "issue_date", "expiry_date"] },
  contractors: { table: "contractors", cols: ["name", "inn", "contact_person", "phone", "email"] },
  materials: { table: "materials", cols: ["name", "unit", "price"] },
};

app.post("/api/import/:entity", upload.single("file"), (req, res) => {
  const ent = ENTITY_MAP[req.params.entity];
  if (!ent) return res.status(400).json({ error: "unknown entity" });
  let rows = [];
  if (req.body && req.body.data) {
    rows = JSON.parse(req.body.data);
  } else if (req.file) {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  } else {
    return res.status(400).json({ error: "no file or data" });
  }
  const ins = db.prepare(
    `INSERT INTO ${ent.table} (${ent.cols.join(", ")}) VALUES (${ent.cols.map(() => "?").join(", ")})`
  );
  let imported = 0;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const vals = ent.cols.map((c) => (row[c] !== undefined ? row[c] : row[ent.cols[0]]));
      ins.run(...vals);
      imported++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: e.message, imported });
  }
  notify(`Импорт ${ent.table}: загружено ${imported} записей`);
  res.json({ ok: true, imported });
});

app.get("/api/export/:entity", (req, res) => {
  const ent = ENTITY_MAP[req.params.entity];
  if (!ent) return res.status(400).json({ error: "unknown entity" });
  const format = req.query.format || "json";
  const rows = db.prepare(`SELECT * FROM ${ent.table} ORDER BY id`).all();
  if (format === "json") {
    return res.json(rows);
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ent.table);
  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${ent.table}.csv"`);
    return res.send("\uFEFF" + csv);
  }
  if (format === "xlsx") {
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${ent.table}.xlsx"`);
    return res.send(buf);
  }
  res.status(400).json({ error: "format must be csv|xlsx|json" });
});

// =============================== ОТЧЁТЫ ===============================
app.get("/api/reports/sales", (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.name, p.code, SUM(di.qty) AS qty, SUM(di.qty*di.price) AS revenue
       FROM deal_items di JOIN products p ON p.id=di.product_id
       JOIN deals d ON d.id=di.deal_id
       WHERE d.status != 'cancelled'
       GROUP BY p.id ORDER BY revenue DESC`
    )
    .all();
  res.json(rows);
});

app.get("/api/reports/quality", (req, res) => {
  const rows = db
    .prepare(
      `SELECT q.status, COUNT(*) AS cnt, COALESCE(SUM(q.defect_count),0) AS defects
       FROM quality_checks q GROUP BY q.status`
    )
    .all();
  res.json(rows);
});

app.get("/api/reports/certificates", (req, res) => {
  const rows = db.prepare("SELECT * FROM certificates").all();
  const counts = { valid: 0, expiring: 0, expired: 0 };
  rows.forEach((c) => {
    const days = daysUntil(c.expiry_date);
    counts[expiryStatus(days)]++;
  });
  res.json(counts);
});

// предупреждения при старте
setTimeout(() => {
  const expiring = db.prepare("SELECT number, expiry_date FROM certificates").all().filter((c) => daysUntil(c.expiry_date) <= 30);
  if (expiring.length) {
    expiring.forEach((c) =>
      notify(`Сертификат ${c.number} истекает ${c.expiry_date} (осталось ${daysUntil(c.expiry_date)} дн.)`)
    );
  }
}, 500);

app.listen(PORT, () => {
  console.log(`MVP «Славянка Текстиль» запущен: http://localhost:${PORT}`);
});