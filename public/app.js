const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtPrice = (n) => new Intl.NumberFormat("ru-RU").format(n ?? 0) + " ₽";
const ROLE_NAMES = { manager: "Менеджер по продажам", technologist: "Технолог", otk: "ОТК", supplier: "Снабженец" };

let state = { role: localStorage.getItem("role") || "manager", view: "dashboard" };

const roleEl = $("#role");
roleEl.value = state.role;
roleEl.addEventListener("change", () => {
  state.role = roleEl.value;
  localStorage.setItem("role", state.role);
  render();
});

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3000);
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", "X-Role": state.role };
  if (opts.body && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

function applyNav() {
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === state.view));
  const title = $$("#nav a").find((a) => a.dataset.view === state.view)?.textContent || "Дашборд";
  $("#pageTitle").textContent = title;
  $("#roleBadge").textContent = ROLE_NAMES[state.role];
}

function card(title, inner) {
  return `<div class="card"><div class="section-title"><span>${title}</span></div>${inner}</div>`;
}

// ================================ VIEWS ================================
const views = {};

views.dashboard = async () => {
  const [products, certs, deals, tasks, quality] = await Promise.all([
    api("/api/products"),
    api("/api/certificates"),
    api("/api/deals"),
    api("/api/tasks"),
    api("/api/quality"),
  ]);
  const expiring = certs.filter((c) => c.status !== "valid");
  const myTasks = tasks.filter((t) => t.role === state.role && t.status === "open");
  const activeDeals = deals.filter((d) => d.status === "new" || d.status === "in_progress");

  return `
    <div class="stat-grid">
      <div class="stat"><div class="stat__value">${products.length}</div><div class="stat__label">Изделий в номенклатуре</div></div>
      <div class="stat"><div class="stat__value">${activeDeals.length}</div><div class="stat__label">Активных сделок</div></div>
      <div class="stat"><div class="stat__value">${tasks.filter((t) => t.status === "open").length}</div><div class="stat__label">Открытых задач</div></div>
      <div class="stat ${expiring.some((c) => c.status === "expired") ? "stat--danger" : "stat--warn"}"><div class="stat__value">${expiring.length}</div><div class="stat__label">Сертификаты: истекают/истекли</div></div>
      <div class="stat stat--ok"><div class="stat__value">${quality.filter((q) => q.status === "passed").length}</div><div class="stat__label">Партий прошло ОТК</div></div>
    </div>

    ${card(
      `Сертификаты под контролем (30 дней)`,
      `<table><tr><th>№</th><th>Название</th><th>Истекает</th><th>Осталось</th><th>Статус</th></tr>
       ${certs
         .filter((c) => c.status !== "valid")
         .map(
           (c) => `<tr><td>${esc(c.number)}</td><td>${esc(c.name)}</td><td>${esc(c.expiry_date)}</td>
           <td>${c.days_left < 0 ? `просрочен ${-c.days_left} дн.` : `${c.days_left} дн.`}</td>
           <td><span class="tag tag--${c.status}">${c.status === "expired" ? "истёк" : "истекает"}</span></td></tr>`
         )
         .join("")}
       </table>`
    )}

    ${card(
      `Мои открытые задачи (${myTasks.length})`,
      myTasks.length
        ? `<table><tr><th>Задача</th><th>Связано</th><th>Срок</th><th>Статус</th></tr>
           ${myTasks
             .map(
               (t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.related_type || "—")} #${esc(t.related_id || "")}</td>
               <td>${esc(t.due_date || "—")}</td><td><span class="tag tag--${t.status}">${t.status === "open" ? "открыта" : "закрыта"}</span></td></tr>`
             )
             .join("")}
         </table>`
        : `<div class="empty">Открытых задач нет</div>`
    )}
  `;
};

views.products = async () => {
  const [products, materials, mp, certs] = await Promise.all([
    api("/api/products"),
    api("/api/materials"),
    api("/api/minpromtorg"),
    api("/api/certificates"),
  ]);
  state._products = products;
  state._certs = certs;
  const matOpts = materials.map((m) => `<option value="${esc(m.name)}">`).join("");
  const mpByProduct = {};
  mp.forEach((m) => {
    (mpByProduct[m.product_id] = mpByProduct[m.product_id] || []).push(m);
  });
  const mpCell = (pid) => {
    const recs = mpByProduct[pid] || [];
    if (!recs.length) return `<span class="tag tag--new">нет записи</span>`;
    const active = recs.find((r) => r.status === "active");
    const pending = recs.find((r) => r.status === "pending");
    if (active) return `<span class="tag tag--valid">в реестре (${recs.length})</span>`;
    if (pending) return `<span class="tag tag--pending">на рассмотрении</span>`;
    return `<span class="tag tag--expired">исключена</span>`;
  };
  return `
    <div class="card">
      <div class="section-title"><span>Добавить изделие</span></div>
      <div class="form-grid">
        <div class="field"><label>Тип изделия</label><select id="pType" onchange="productFormChanged()">
          <option value="">— выберите —</option>
          <option>Костюм</option>
          <option>Костюм зимний</option>
          <option>Костюм летний</option>
          <option>Комбинезон</option>
          <option>Полукомбинезон</option>
          <option>Куртка утеплённая</option>
          <option>Брюки</option>
          <option>Жилет</option>
        </select></div>
        <div class="field"><label>Защитные свойства (автозаполнение)</label><select id="pPreset" onchange="productFormChanged()">
          <option value="">— выберите —</option>
          <option value="fire">Защита от тепла и огня (сварщик)</option>
          <option value="antistat">Антистатика</option>
          <option value="oil">Защита от нефти и нефтепродуктов</option>
          <option value="tick">Защита от клещей (энцефалитный)</option>
          <option value="signal">Сигнальная защита (видимость)</option>
        </select></div>
        <div class="field"><label>Название (формируется из типа и свойств)</label><input id="pName" required></div>
        <div class="field"><label>Артикул (код)</label><input id="pCode"></div>
        <div class="field"><label>Класс защиты</label><input id="pClass"></div>
        <div class="field"><label>Климатический пояс (по ГОСТ)</label><select id="pZone">
          <option value="">—</option>
        </select></div>
        <div class="field"><label>Материал</label><input id="pMaterial" list="matList"><datalist id="matList">${matOpts}</datalist></div>
        <div class="field"><label>ТН ВЭД</label><input id="pTnved"></div>
        <div class="field"><label>ОКПД2</label><input id="pOkpd2"></div>
        <div class="field"><label>ТУ</label><input id="pTu"></div>
      </div>
      <div class="field" style="margin-top:12px"><label>Описание</label><textarea id="pDesc" rows="2"></textarea></div>
      <div id="pGostHint" class="empty" style="display:none"></div>
      <div id="pCertHint" class="empty" style="display:none"></div>
      <div class="form-actions"><button class="btn btn--primary" onclick="addProduct()">Сохранить</button></div>
    </div>

    ${card(
      `Номенклатура (${products.length})`,
      `<table><tr><th>Артикул</th><th>Название</th><th>Класс защиты</th><th>Пояс</th><th>Материал</th><th>ТН ВЭД</th><th>ОКПД2</th><th>Серт.</th><th>Реестр МПТ</th><th></th></tr>
       ${products
         .map(
           (p) => `<tr>
             <td><b>${esc(p.code)}</b></td><td>${esc(p.name)}</td><td>${esc(p.protection_class)}</td>
             <td>${esc(p.climate_zone)}</td><td>${esc(p.material)}</td><td>${esc(p.tn_ved)}</td>
             <td>${esc(p.okpd2)}</td><td>${p.cert_count}</td><td>${mpCell(p.id)}</td>
             <td><button class="btn btn--ghost btn--sm" onclick="openProduct(${p.id})">карточка</button></td>
           </tr>`
         )
         .join("")}
       </table>`
    )}
  `;
};

const PRODUCT_PRESETS = {
  fire: { code: "SV", cls: "Класс 1 (защита от тепла и огня)", tnved: "6203.22.8000", okpd2: "14.12.30.150", material: "Термостойкая ткань Т-2", certs: ["огнестойк"], namePart: "для защиты от искр и брызг расплавленного металла (сварщик)", gost: "ГОСТ 12.4.250-2013, ТР ТС 019/2011" },
  antistat: { code: "EL", cls: "Антистатика (защита от стат. электричества)", tnved: "6203.43.9000", okpd2: "14.12.30.160", material: "Смесовая ткань с антистатической нитью", certs: ["антистат"], namePart: "антистатический", gost: "ГОСТ 12.4.124-83, ТР ТС 019/2011" },
  oil: { code: "NP", cls: "Защита от нефти и нефтепродуктов", tnved: "6210.40.0000", okpd2: "14.12.30.170", material: "ПВХ-ткань маслостойкая", certs: ["019/2011", "нефт"], namePart: "для защиты от нефти и нефтепродуктов", gost: "ТР ТС 019/2011 (маркировка Нф)" },
  tick: { code: "TG", cls: "Защита от клещей и механических повреждений", tnved: "6203.49.9000", okpd2: "14.12.30.140", material: "Хлопковая ткань «Грета»", certs: ["энцефалит"], namePart: "энцефалитный (защита от клещей)", gost: "ТР ТС 019/2011" },
  signal: { code: "UN", cls: "Сигнальная защита, видимость", tnved: "6203.42.9000", okpd2: "14.12.30.190", material: "Смесовая ткань с флюоресцентными полосами", certs: [], namePart: "сигнальный повышенной видимости", gost: "ГОСТ 12.4.281-2014, ТР ТС 019/2011" },
};

const CLIMATE_ZONES = {
  I: "до -25 °C",
  II: "до -35 °C",
  III: "до -45 °C",
  IV: "до -55 °C",
  Особый: "до -65 °C",
};

const updateZoneOptions = (type) => {
  const sel = $("#pZone");
  const winter = /зимн|утепл/i.test(type);
  const summer = /летн/i.test(type);
  let keys = Object.keys(CLIMATE_ZONES);
  if (summer) keys = ["I", "II"];
  const prev = sel.value;
  sel.innerHTML =
    `<option value="">—</option>` +
    keys.map((k) => `<option value="${k}">Пояс ${k} (${CLIMATE_ZONES[k]})</option>`).join("");
  if (winter && keys.includes("IV")) sel.value = "IV";
  else if (summer && keys.includes("I")) sel.value = "I";
  else if (keys.includes(prev)) sel.value = prev;
};

const matchingCerts = (presetKey) => {
  const pr = PRODUCT_PRESETS[presetKey];
  if (!pr || !pr.certs.length) return [];
  return (state._certs || [])
    .filter((c) => c.days_left > 0)
    .filter((c) => pr.certs.some((k) => `${c.name} ${c.number}`.toLowerCase().includes(k)));
};

window.productFormChanged = () => {
  const key = $("#pPreset").value;
  const type = $("#pType").value;
  updateZoneOptions(type);
  const gostHint = $("#pGostHint");
  if (!key || !type) {
    gostHint.style.display = "none";
    if (!key) $("#pCertHint").style.display = "none";
    return;
  }
  const pr = PRODUCT_PRESETS[key];
  $("#pName").value = `${type} ${pr.namePart}`;
  $("#pClass").value = pr.cls;
  $("#pTnved").value = pr.tnved;
  $("#pOkpd2").value = pr.okpd2;
  $("#pMaterial").value = pr.material;
  const n = (state._products?.length || 0) + 1;
  $("#pCode").value = `${pr.code}-0${n}`;
  $("#pTu").value = `ТУ 8572-0${String(n).padStart(2, "0")}-22345678-2026`;
  gostHint.style.display = "";
  gostHint.innerHTML = `<b>Нормативная база:</b> ${esc(pr.gost)} · климатические пояса — ГОСТ 12.4.303-2016`;
  const hint = $("#pCertHint");
  hint.style.display = "";
  const mc = matchingCerts(key);
  hint.innerHTML = mc.length
    ? `✓ Сертификаты подтянутся автоматически: ${mc.map((c) => `<b>${esc(c.number)}</b> — ${esc(c.name)} (до ${esc(c.expiry_date)})`).join("; ")}`
    : "Действующих сертификатов под этот тип в реестре нет — привяжите позже в разделе «Сертификаты».";
};

window.openProduct = async (id) => {
  const p = await api(`/api/products/${id}`);
  const certs = p.certificates.length
    ? p.certificates.map((c) => `<li>${esc(c.number)} — до ${esc(c.expiry_date)}</li>`).join("")
    : "<li>нет</li>";
  const mats = p.materials.length
    ? p.materials.map((m) => `<li>${esc(m.name)} — ${m.consumption} ${esc(m.unit)}/шт</li>`).join("")
    : "<li>не заданы</li>";
  const mpTag = (s) =>
    s === "active"
      ? `<span class="tag tag--valid">в реестре</span>`
      : s === "pending"
        ? `<span class="tag tag--pending">на рассмотрении</span>`
        : `<span class="tag tag--expired">исключена</span>`;
  const mpCtrl = (m) => {
    if (m.days_left == null) return `<span class="tag tag--new">не задан</span>`;
    if (m.days_left < 0) return `<span class="tag tag--expired">истёк ${-m.days_left} дн.</span>`;
    if (m.days_left <= 240) return `<span class="tag tag--pending">контроль: ${m.days_left} дн.</span>`;
    return `<span class="tag tag--valid">${m.days_left} дн.</span>`;
  };
  const mp = p.minpromtorg.length
    ? `<table><tr><th>№ записи</th><th>Включена</th><th>Действует до</th><th>Контроль</th><th>Статус</th></tr>
       ${p.minpromtorg
         .map(
           (m) => `<tr><td>${esc(m.registry_number)}</td><td>${esc(m.included_date)}</td>
           <td>${esc(m.expiry_date || "—")}</td><td>${mpCtrl(m)}</td><td>${mpTag(m.status)}</td></tr>`
         )
         .join("")}
       </table>`
    : "<div class='empty'>Реестровых записей нет</div>";
  $("#content").innerHTML = `
    <div class="card">
      <div class="section-title"><span>Карточка: ${esc(p.name)}</span>
        <button class="btn btn--ghost btn--sm" onclick="render()">← назад</button></div>
      <table>
        <tr><th>Артикул</th><td>${esc(p.code)}</td><th>ТУ</th><td>${esc(p.tu)}</td></tr>
        <tr><th>Класс защиты</th><td>${esc(p.protection_class)}</td><th>Климат. пояс</th><td>${esc(p.climate_zone)}</td></tr>
        <tr><th>Материал</th><td>${esc(p.material)}</td><th>ТН ВЭД / ОКПД2</th><td>${esc(p.tn_ved)} / ${esc(p.okpd2)}</td></tr>
        <tr><th>Описание</th><td colspan="3">${esc(p.description)}</td></tr>
      </table>
      <div style="margin-top:12px"><b>Сертификаты:</b><ul>${certs}</ul></div>
      <div style="margin-top:12px"><b>Нормы расхода материалов:</b><ul>${mats}</ul></div>
      <div style="margin-top:12px"><b>Реестровые записи Минпромторга:</b>${mp}</div>
    </div>`;
};

window.addProduct = async () => {
  const body = {
    name: $("#pName").value,
    code: $("#pCode").value,
    protection_class: $("#pClass").value,
    climate_zone: $("#pZone").value,
    material: $("#pMaterial").value,
    tn_ved: $("#pTnved").value,
    okpd2: $("#pOkpd2").value,
    tu: $("#pTu").value,
    description: $("#pDesc").value,
    preset: $("#pPreset").value || null,
  };
  try {
    const r = await api("/api/products", { method: "POST", body });
    toast(
      r.linked?.length
        ? `Изделие добавлено. Сертификаты подтянуты: ${r.linked.join(", ")}`
        : "Изделие добавлено"
    );
    render();
  } catch (e) {
    toast("Ошибка: " + e.message);
  }
};

views.certificates = async () => {
  const [certs, products] = await Promise.all([api("/api/certificates"), api("/api/products")]);
  const opts = products.map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("");
  return `
    <div class="card">
      <div class="section-title"><span>Добавить сертификат</span></div>
      <div class="form-grid">
        <div class="field"><label>Номер</label><input id="cNumber"></div>
        <div class="field"><label>Название</label><input id="cName"></div>
        <div class="field"><label>Дата выдачи</label><input id="cIssue" type="date"></div>
        <div class="field"><label>Действует до</label><input id="cExpiry" type="date"></div>
        <div class="field"><label>Изделия (ctrl для нескольких)</label><select id="cProducts" multiple size="3">${opts}</select></div>
      </div>
      <div class="form-actions"><button class="btn btn--primary" onclick="addCertificate()">Сохранить</button></div>
    </div>

    ${card(
      `Реестр сертификатов`,
      `<table><tr><th>№</th><th>Название</th><th>Выдан</th><th>Истекает</th><th>Осталось</th><th>Статус</th></tr>
       ${certs
         .map(
           (c) => `<tr><td><b>${esc(c.number)}</b></td><td>${esc(c.name)}</td><td>${esc(c.issue_date)}</td>
           <td>${esc(c.expiry_date)}</td>
           <td>${c.days_left < 0 ? `<span class="tag tag--expired">просрочен ${-c.days_left} дн.</span>` : c.days_left <= 30 ? `${c.days_left} дн.` : `${c.days_left} дн.`}</td>
           <td><span class="tag tag--${c.status}">${c.status === "expired" ? "истёк" : c.status === "expiring" ? "истекает" : "действует"}</span></td></tr>`
         )
         .join("")}
       </table>`
    )}
  `;
};

window.addCertificate = async () => {
  const product_ids = $$("#cProducts option:checked").map((o) => Number(o.value));
  try {
    await api("/api/certificates", {
      method: "POST",
      body: {
        number: $("#cNumber").value,
        name: $("#cName").value,
        issue_date: $("#cIssue").value,
        expiry_date: $("#cExpiry").value,
        product_ids,
      },
    });
    toast("Сертификат добавлен");
    render();
  } catch (e) {
    toast("Ошибка: " + e.message);
  }
};

views.minpromtorg = async () => {
  const [records, products] = await Promise.all([api("/api/minpromtorg"), api("/api/products")]);
  const opts = products.map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("");
  const statusTag = (s) =>
    s === "active"
      ? `<span class="tag tag--valid">в реестре</span>`
      : s === "pending"
        ? `<span class="tag tag--pending">на рассмотрении</span>`
        : `<span class="tag tag--expired">исключена</span>`;
  const MP_WARN_DAYS = 240; // контроль за 8 месяцев
  const ctrlTag = (m) => {
    if (m.days_left == null) return `<span class="tag tag--new">не задан</span>`;
    if (m.days_left < 0) return `<span class="tag tag--expired">истёк ${-m.days_left} дн.</span>`;
    if (m.days_left <= MP_WARN_DAYS) return `<span class="tag tag--pending">контроль: ${m.days_left} дн.</span>`;
    return `<span class="tag tag--valid">${m.days_left} дн.</span>`;
  };
  return `
    <div class="card">
      <div class="section-title"><span>Добавить реестровую запись Минпромторга</span></div>
      <div class="form-grid">
        <div class="field"><label>Изделие</label><select id="mpProduct">${opts}</select></div>
        <div class="field"><label>Номер записи</label><input id="mpNumber" placeholder="№ 2026/012345"></div>
        <div class="field"><label>Дата включения</label><input id="mpDate" type="date"></div>
        <div class="field"><label>Действует до</label><input id="mpExpiry" type="date"></div>
        <div class="field"><label>Статус</label>
          <select id="mpStatus">
            <option value="active">В реестре</option>
            <option value="pending">На рассмотрении</option>
            <option value="excluded">Исключена</option>
          </select>
        </div>
        <div class="field"><label>Примечание</label><input id="mpNote" placeholder="Выписка из реестра, заключение и т.д."></div>
      </div>
      <div class="form-actions"><button class="btn btn--primary" onclick="addMinpromtorg()">Сохранить</button></div>
    </div>

    ${card(
      `Реестр российской промышленной продукции (Минпромторг РФ)`,
      `<table><tr><th>№ записи</th><th>Изделие</th><th>Дата включения</th><th>Действует до</th><th>Контроль срока</th><th>Статус</th><th>Примечание</th><th></th></tr>
       ${records
         .map(
           (m) => `<tr><td><b>${esc(m.registry_number)}</b></td><td>${esc(m.product_code)} · ${esc(m.product_name)}</td>
           <td>${esc(m.included_date)}</td><td>${esc(m.expiry_date || "—")}</td><td>${ctrlTag(m)}</td><td>${statusTag(m.status)}</td><td>${esc(m.note || "")}</td>
           <td><button class="btn btn--ghost" onclick="delMinpromtorg(${m.id})">Удалить</button></td></tr>`
         )
         .join("")}
       </table>`
    )}
  `;
};

window.addMinpromtorg = async () => {
  try {
    await api("/api/minpromtorg", {
      method: "POST",
      body: {
        product_id: Number($("#mpProduct").value),
        registry_number: $("#mpNumber").value,
        included_date: $("#mpDate").value,
        expiry_date: $("#mpExpiry").value || null,
        status: $("#mpStatus").value,
        note: $("#mpNote").value,
      },
    });
    toast("Запись добавлена");
    render();
  } catch (e) {
    toast("Ошибка: " + e.message);
  }
};

window.delMinpromtorg = async (id) => {
  try {
    await api(`/api/minpromtorg/${id}`, { method: "DELETE" });
    toast("Запись удалена");
    render();
  } catch (e) {
    toast("Ошибка: " + e.message);
  }
};

views.deals = async () => {
  const [deals, products, contractors] = await Promise.all([
    api("/api/deals"),
    api("/api/products"),
    api("/api/contractors"),
  ]);
  const prodOpts = products.map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("");
  const conOpts = contractors.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  return `
    <div class="card">
      <div class="section-title"><span>Новая сделка</span></div>
      <div class="form-grid">
        <div class="field"><label>Контрагент</label><select id="dContractor">${conOpts}</select></div>
        <div class="field"><label>Изделие</label><select id="dProduct">${prodOpts}</select></div>
        <div class="field"><label>Количество</label><input id="dQty" type="number" value="1" min="1"></div>
        <div class="field"><label>Цена за шт, ₽</label><input id="dPrice" type="number" value="1000" min="0"></div>
        <div class="field"><label>Комментарий</label><input id="dComment" placeholder="Поставка 120 шт, спецодежда"></div>
      </div>
      <div class="form-actions"><button class="btn btn--primary" onclick="addDeal()">Создать сделку</button></div>
    </div>

    ${card(
      `Сделки`,
      `<table><tr><th>№</th><th>Контрагент</th><th>Позиций</th><th>Сумма</th><th>Дата</th><th>Статус</th><th></th></tr>
       ${deals
         .map(
           (d) => `<tr>
             <td><b>${esc(d.number)}</b></td><td>${esc(d.contractor_name)}</td><td>${d.items_count}</td>
             <td>${fmtPrice(d.total)}</td><td>${esc(d.created_at)}</td>
             <td><span class="tag tag--${d.status}">${d.status === "new" ? "новая" : d.status === "in_progress" ? "в работе" : d.status === "done" ? "закрыта" : d.status}</span></td>
             <td><button class="btn btn--ghost btn--sm" onclick="openDeal(${d.id})">открыть</button></td>
           </tr>`
         )
         .join("")}
       </table>`
    )}
  `;
};

window.addDeal = async () => {
  try {
    await api("/api/deals", {
      method: "POST",
      body: {
        contractor_id: Number($("#dContractor").value),
        comment: $("#dComment").value,
        items: [
          {
            product_id: Number($("#dProduct").value),
            qty: Number($("#dQty").value),
            price: Number($("#dPrice").value),
          },
        ],
      },
    });
    toast("Сделка создана, уведомление отправлено");
    render();
  } catch (e) {
    toast("Ошибка: " + e.message);
  }
};

window.openDeal = async (id) => {
  const d = await api(`/api/deals/${id}`);
  const products = await api("/api/products");
  const prodOpts = products.map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("");
  $("#content").innerHTML = `
    <div class="deal-detail">
      <div class="card">
        <div class="section-title"><span>Сделка ${esc(d.number)} · ${esc(d.contractor.name)}</span>
          <button class="btn btn--ghost btn--sm" onclick="render()">← список</button></div>
        <table>
          <tr><th>Позиции</th><th>Сумма</th><th>Дата</th><th>Статус</th></tr>
          <tr><td>${d.items.length} шт./наимен.</td><td><b>${fmtPrice(d.total)}</b></td><td>${esc(d.created_at)}</td>
          <td>
            <select onchange="setDealStatus(${d.id}, this.value)">
              <option value="new" ${d.status === "new" ? "selected" : ""}>Новая</option>
              <option value="in_progress" ${d.status === "in_progress" ? "selected" : ""}>В работе</option>
              <option value="done" ${d.status === "done" ? "selected" : ""}>Закрыта</option>
              <option value="cancelled" ${d.status === "cancelled" ? "selected" : ""}>Отменена</option>
            </select>
          </td></tr>
        </table>
        <h3 style="margin:14px 0 8px;font-size:15px">Позиции сделки</h3>
        <table><tr><th>Изделие</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr>
          ${d.items.map((i) => `<tr><td>${esc(i.product_name)} (${esc(i.product_code)})</td><td>${i.qty}</td><td>${fmtPrice(i.price)}</td><td>${fmtPrice(i.qty * i.price)}</td></tr>`).join("")}
        </table>
        <div class="form-grid" style="margin-top:14px">
          <div class="field"><label>Добавить позицию</label><select id="addItemProd">${prodOpts}</select></div>
          <div class="field"><label>Кол-во</label><input id="addItemQty" type="number" value="1" min="1"></div>
          <div class="field"><label>Цена, ₽</label><input id="addItemPrice" type="number" value="1000"></div>
        </div>
        <div class="form-actions"><button class="btn btn--ghost" onclick="addDealItem(${d.id})">Добавить позицию</button></div>
      </div>

      <div>
        <div class="card">
          <div class="section-title"><span>Документы из шаблонов</span></div>
          <div class="form-actions" style="flex-wrap:wrap">
            <button class="btn btn--primary btn--sm" onclick="genDoc(${d.id},'kp')">КП</button>
            <button class="btn btn--primary btn--sm" onclick="genDoc(${d.id},'contract')">Договор</button>
            <button class="btn btn--primary btn--sm" onclick="genDoc(${d.id},'act')">Акт</button>
          </div>
          ${d.documents.length
            ? `<table style="margin-top:10px"><tr><th>Тип</th><th>Файл</th><th>Дата</th></tr>
               ${d.documents.map((doc) => `<tr><td>${esc(doc.type.toUpperCase())}</td><td><a href="/api/documents/${esc(doc.filename)}" target="_blank">${esc(doc.filename)}</a></td><td>${esc(doc.created_at)}</td></tr>`).join("")}
             </table>`
            : `<div class="empty">Документы ещё не формировались</div>`}
        </div>
        <div class="card">
          <div class="section-title"><span>ОТК по этой сделке</span></div>
          <div class="form-actions" style="flex-wrap:wrap">
            <button class="btn btn--ghost btn--sm" onclick="createQuality(${d.id})">Создать проверку партии</button>
          </div>
        </div>
      </div>
    </div>`;
};

window.setDealStatus = async (id, status) => {
  await api(`/api/deals/${id}`, { method: "PATCH", body: { status } });
  toast("Статус обновлён");
  openDeal(id);
};

window.addDealItem = async (id) => {
  await api(`/api/deals/${id}/items`, {
    method: "POST",
    body: {
      product_id: Number($("#addItemProd").value),
      qty: Number($("#addItemQty").value),
      price: Number($("#addItemPrice").value),
    },
  });
  toast("Позиция добавлена");
  openDeal(id);
};

window.genDoc = async (id, type) => {
  const r = await api(`/api/deals/${id}/documents`, { method: "POST", body: { type } });
  toast(`Документ сформирован: ${r.filename}`);
  openDeal(id);
};

window.createQuality = async (dealId) => {
  const d = await api(`/api/deals/${dealId}`);
  await api("/api/quality", {
    method: "POST",
    body: { deal_id: dealId, product_id: d.items[0]?.product_id || 1, task: `Проверка партии по ${d.number}` },
  });
  toast("Проверка создана");
  openDeal(dealId);
};

views.quality = async () => {
  const qs = await api("/api/quality");
  return card(
    `Контроль качества (ОТК)`,
    `<table><tr><th>Сделка</th><th>Изделие</th><th>Задача</th><th>Брак</th><th>Статус</th><th>Дата</th><th></th></tr>
     ${qs
       .map(
         (q) => `<tr><td>${esc(q.deal_number)}</td><td>${esc(q.product_name)}</td><td>${esc(q.task)}</td>
         <td>${q.defect_count || 0}</td>
         <td><span class="tag tag--${q.status}">${q.status === "passed" ? "прошла" : q.status === "failed" ? "брак" : "ожидает"}</span></td>
         <td>${esc(q.checked_at || "—")}</td>
         <td>${q.status === "pending" ? `<button class="btn btn--ghost btn--sm" onclick="openQuality(${q.id})">принять</button>` : ""}</td></tr>`
       )
       .join("")}
     </table>`
  );
};

window.openQuality = (id) => {
  const val = prompt("Результат проверки:\npassed — партия принята\nfailed — выявлен брак");
  if (!val) return;
  const defects = Number(prompt("Количество бракованных изделий:", "0") || 0);
  api(`/api/quality/${id}`, { method: "PATCH", body: { status: val, result: val, defect_count: defects } }).then(() => {
    toast("Результат ОТК сохранён");
    render();
  });
};

views.materials = async () => {
  const mats = await api("/api/materials");
  return `
    <div class="card">
      <div class="section-title"><span>Добавить материал</span></div>
      <div class="form-grid">
        <div class="field"><label>Название</label><input id="mName"></div>
        <div class="field"><label>Ед. изм.</label><input id="mUnit" value="м"></div>
        <div class="field"><label>Цена, ₽</label><input id="mPrice" type="number" value="0"></div>
      </div>
      <div class="form-actions"><button class="btn btn--primary" onclick="addMaterial()">Сохранить</button></div>
    </div>
    ${card(
      `Материалы`,
      `<table><tr><th>Название</th><th>Ед.</th><th>Цена</th></tr>
       ${mats.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.unit)}</td><td>${fmtPrice(m.price)}</td></tr>`).join("")}
       </table>`
    )}`;
};

window.addMaterial = async () => {
  await api("/api/materials", {
    method: "POST",
    body: { name: $("#mName").value, unit: $("#mUnit").value, price: Number($("#mPrice").value) },
  });
  toast("Материал добавлен");
  render();
};

views.tasks = async () => {
  const [tasks, products, deals, certs] = await Promise.all([
    api("/api/tasks"),
    api("/api/products"),
    api("/api/deals"),
    api("/api/certificates"),
  ]);
  state._taskRefs = { product: products, deal: deals, certificate: certs };
  return `
    <div class="card">
      <div class="section-title"><span>Новая задача</span></div>
      <div class="form-grid">
        <div class="field"><label>Роль</label><select id="tRole">
          <option value="manager">Менеджер по продажам</option>
          <option value="technologist">Технолог</option>
          <option value="otk">ОТК</option>
          <option value="supplier">Снабженец</option>
        </select></div>
        <div class="field"><label>Название</label><input id="tTitle"></div>
        <div class="field"><label>Связано с</label><select id="tType" onchange="taskTypeChanged()">
          <option value="">—</option><option value="product">изделие</option><option value="deal">сделка</option><option value="certificate">сертификат</option>
        </select></div>
        <div class="field"><label>Объект</label><select id="tRef" disabled><option value="">сначала выберите тип</option></select></div>
        <div class="field"><label>Срок</label><input id="tDue" type="date"></div>
      </div>
      <div class="form-actions"><button class="btn btn--primary" onclick="addTask()">Создать задачу</button></div>
    </div>
    ${card(
      `Задачи`,
      `<table><tr><th>Роль</th><th>Задача</th><th>Связь</th><th>Срок</th><th>Статус</th><th></th></tr>
       ${tasks
         .map((t) => {
           const ref = state._taskRefs[t.related_type]?.find((x) => x.id === t.related_id);
           let link = `${esc(t.related_type || "—")} ${t.related_id ? "#" + t.related_id : ""}`;
           if (ref) {
             const label =
               t.related_type === "product"
                 ? ref.name
                 : t.related_type === "deal"
                   ? ref.number
                   : `${ref.number} · ${ref.name}`;
             if (t.related_type === "product") link = `<a href="javascript:void(0)" onclick="openProduct(${t.related_id})">${esc(label)}</a>`;
             else if (t.related_type === "deal") link = `<a href="javascript:void(0)" onclick="openDeal(${t.related_id})">${esc(label)}</a>`;
             else link = esc(label);
           }
           return `<tr><td><span class="tag tag--new">${esc(ROLE_NAMES[t.role] || t.role)}</span></td>
           <td>${esc(t.title)}</td><td>${link}</td>
           <td>${esc(t.due_date || "—")}</td>
           <td><span class="tag tag--${t.status}">${t.status === "open" ? "открыта" : "закрыта"}</span></td>
           <td>${t.status === "open" ? `<button class="btn btn--ghost btn--sm" onclick="closeTask(${t.id})">закрыть</button>` : ""}</td></tr>`;
         })
         .join("")}
       </table>`
    )}`;
};

window.taskTypeChanged = () => {
  const type = $("#tType").value;
  const sel = $("#tRef");
  if (!type) {
    sel.innerHTML = `<option value="">сначала выберите тип</option>`;
    sel.disabled = true;
    return;
  }
  const items = state._taskRefs[type] || [];
  sel.disabled = false;
  sel.innerHTML =
    `<option value="">— выберите —</option>` +
    items
      .map((x) => {
        const label =
          type === "product"
            ? `${x.code} · ${x.name}`
            : type === "certificate"
              ? `${x.number} · ${x.name}`
              : x.number || x.id;
        return `<option value="${x.id}">${esc(String(label))}</option>`;
      })
      .join("");
  sel.onchange = () => {
    const opt = sel.options[sel.selectedIndex];
    if (!opt.value) return;
    if (!$("#tTitle").value.trim()) $("#tTitle").value = `По ${TYPE_WORDS[type]}: ${opt.textContent}`;
    if (!$("#tDue").value) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      $("#tDue").value = d.toISOString().slice(0, 10);
    }
  };
};

const TYPE_WORDS = { product: "изделию", deal: "сделке", certificate: "сертификату" };

window.addTask = async () => {
  await api("/api/tasks", {
    method: "POST",
    body: {
      role: $("#tRole").value,
      title: $("#tTitle").value,
      related_type: $("#tType").value || null,
      related_id: $("#tRef").value ? Number($("#tRef").value) : null,
      due_date: $("#tDue").value || null,
    },
  });
  toast("Задача создана");
  render();
};

window.closeTask = async (id) => {
  await api(`/api/tasks/${id}`, { method: "PATCH", body: { status: "closed" } });
  toast("Задача закрыта");
  render();
};

views.contractors = async () => {
  const cons = await api("/api/contractors");
  return `
    <div class="card">
      <div class="section-title"><span>Добавить контрагента</span></div>
      <div class="form-grid">
        <div class="field"><label>Название</label><input id="kName"></div>
        <div class="field"><label>ИНН</label><input id="kInn"></div>
        <div class="field"><label>Контакт</label><input id="kContact"></div>
        <div class="field"><label>Телефон</label><input id="kPhone"></div>
        <div class="field"><label>E-mail</label><input id="kEmail"></div>
      </div>
      <div class="form-actions"><button class="btn btn--primary" onclick="addContractor()">Сохранить</button></div>
    </div>
    ${card(
      `Контрагенты`,
      `<table><tr><th>Название</th><th>ИНН</th><th>Контакт</th><th>Телефон</th><th>E-mail</th></tr>
       ${cons.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.inn)}</td><td>${esc(c.contact_person)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td></tr>`).join("")}
       </table>`
    )}`;
};

window.addContractor = async () => {
  await api("/api/contractors", {
    method: "POST",
    body: {
      name: $("#kName").value,
      inn: $("#kInn").value,
      contact_person: $("#kContact").value,
      phone: $("#kPhone").value,
      email: $("#kEmail").value,
    },
  });
  toast("Контрагент добавлен");
  render();
};

views.importexport = () => `
  <div class="card">
    <div class="section-title"><span>Импорт из файла (CSV / XLSX / JSON)</span></div>
    <div class="form-grid">
      <div class="field"><label>Сущность</label><select id="impEntity">
        <option value="products">Номенклатура</option>
        <option value="certificates">Сертификаты</option>
        <option value="contractors">Контрагенты</option>
        <option value="materials">Материалы</option>
      </select></div>
      <div class="field"><label>Файл</label><input id="impFile" type="file" accept=".csv,.xlsx,.json"></div>
    </div>
    <div class="form-actions"><button class="btn btn--primary" onclick="doImport()">Импортировать</button></div>
    <p style="margin-top:10px;font-size:13px;color:var(--muted)">Первая строка файла — заголовки колонок.</p>
  </div>
  <div class="card">
    <div class="section-title"><span>Экспорт</span></div>
    <div class="form-grid">
      <div class="field"><label>Сущность</label><select id="exEntity">
        <option value="products">Номенклатура</option>
        <option value="certificates">Сертификаты</option>
        <option value="contractors">Контрагенты</option>
        <option value="materials">Материалы</option>
      </select></div>
      <div class="field"><label>Формат</label><select id="exFormat">
        <option value="csv">CSV</option><option value="xlsx">XLSX</option><option value="json">JSON</option>
      </select></div>
    </div>
    <div class="form-actions"><button class="btn btn--primary" onclick="doExport()">Скачать</button></div>
  </div>`;

window.doImport = async () => {
  const file = $("#impFile").files[0];
  if (!file) return toast("Выберите файл");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/import/${$("#impEntity").value}`, { method: "POST", body: fd });
  const j = await res.json();
  if (!res.ok) toast("Ошибка: " + j.error);
  else {
    toast(`Импортировано: ${j.imported} записей`);
    render();
  }
};

window.doExport = () => {
  const entity = $("#exEntity").value;
  const format = $("#exFormat").value;
  window.location.href = `/api/export/${entity}?format=${format}`;
};

views.reports = async () => {
  const [sales, quality, certCounts] = await Promise.all([
    api("/api/reports/sales"),
    api("/api/reports/quality"),
    api("/api/reports/certificates"),
  ]);
  return `
    ${card(
      `Продажи по изделиям`,
      `<table><tr><th>Изделие</th><th>Кол-во</th><th>Выручка</th></tr>
       ${sales.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.qty} шт</td><td><b>${fmtPrice(s.revenue)}</b></td></tr>`).join("")}
       </table>`
    )}
    ${card(
      `Контроль качества (ОТК)`,
      `<table><tr><th>Статус</th><th>Партий</th><th>Бракованных изделий</th></tr>
       ${quality.map((q) => `<tr><td>${esc(q.status)}</td><td>${q.cnt}</td><td>${q.defects}</td></tr>`).join("")}
       </table>`
    )}
    ${card(
      `Сертификаты`,
      `<div class="stat-grid">
        <div class="stat stat--ok"><div class="stat__value">${certCounts.valid}</div><div class="stat__label">Действуют</div></div>
        <div class="stat stat--warn"><div class="stat__value">${certCounts.expiring}</div><div class="stat__label">Истекают (30 дн.)</div></div>
        <div class="stat stat--danger"><div class="stat__value">${certCounts.expired}</div><div class="stat__label">Истекли</div></div>
      </div>`
    )}`;
};

// ================================ ROUTER ================================
function render() {
  applyNav();
  const view = views[state.view];
  const target = $("#content");
  target.innerHTML = `<div class="empty">Загрузка…</div>`;
  view().then((html) => (target.innerHTML = html)).catch((e) => (target.innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`));
}

window.addEventListener("hashchange", () => {
  state.view = (location.hash.replace("#/", "") || "dashboard").split("?")[0];
  render();
});

state.view = (location.hash.replace("#/", "") || state.view).split("?")[0];
render();