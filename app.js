const STORAGE_KEY = "comandas-app-v1";

/** @typedef {{ id: string, label: string, qty: number, valor: number }} LineItem */
/** @typedef {{ id: string, name: string, open: boolean, createdAt: string, closedAt: string | null, items: LineItem[] }} Comanda */

/** @param {unknown} v */
function asNonNegNumber(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** @param {Comanda[]} list */
function normalizeComandas(list) {
  return list.map((c) => ({
    ...c,
    items: (c.items || []).map((i) => ({
      ...i,
      valor: asNonNegNumber(i.valor),
      qty: Math.max(0, Math.floor(asNonNegNumber(i.qty) || 0)) || 0,
    })).filter((i) => i.qty > 0 && i.label),
  }));
}

/** @returns {Comanda[]} */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return normalizeComandas(data);
  } catch {
    return [];
  }
}

/** @param {Comanda[]} comandas */
function saveState(comandas) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(comandas));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @type {Comanda[]} */
let comandas = loadState();
/** @type {string | null} */
let selectedOpenId = null;

const el = {
  listOpen: document.getElementById("list-open"),
  listHistory: document.getElementById("list-history"),
  emptyOpen: document.getElementById("empty-open"),
  emptyHistory: document.getElementById("empty-history"),
  detailPlaceholder: document.getElementById("detail-placeholder"),
  detailContent: document.getElementById("detail-content"),
  detailName: document.getElementById("detail-name"),
  itemsList: document.getElementById("items-list"),
  emptyItems: document.getElementById("empty-items"),
  formAddItem: document.getElementById("form-add-item"),
  itemName: document.getElementById("item-name"),
  itemValor: document.getElementById("item-valor"),
  itemQty: document.getElementById("item-qty"),
  detailTotal: document.getElementById("detail-total"),
  detailTotalValue: document.getElementById("detail-total-value"),
  btnClose: document.getElementById("btn-close"),
  btnNew: document.getElementById("btn-new"),
  modalNew: document.getElementById("modal-new"),
  formNew: document.getElementById("form-new"),
  newName: document.getElementById("new-name"),
  modalCancel: document.getElementById("modal-cancel"),
};

function openComandas() {
  return comandas.filter((c) => c.open);
}

function closedComandas() {
  return comandas.filter((c) => !c.open).sort((a, b) => {
    const ta = a.closedAt ? new Date(a.closedAt).getTime() : 0;
    const tb = b.closedAt ? new Date(b.closedAt).getTime() : 0;
    return tb - ta;
  });
}

const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** @param {number} n */
function formatMoney(n) {
  return moneyFmt.format(n);
}

/** @param {LineItem} line */
function lineSubtotal(line) {
  return line.qty * line.valor;
}

/** @param {LineItem[]} items */
function comandaTotal(items) {
  return items.reduce((s, i) => s + lineSubtotal(i), 0);
}

function formatShortDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function itemCountSummary(items) {
  const n = items.reduce((s, i) => s + i.qty, 0);
  const kinds = items.length;
  if (kinds === 0) return "Sem itens";
  return `${kinds} tipo(s) · ${n} un. · ${formatMoney(comandaTotal(items))}`;
}

function render() {
  const open = openComandas();
  const closed = closedComandas();

  el.emptyOpen.hidden = open.length > 0;
  el.emptyHistory.hidden = closed.length > 0;

  el.listOpen.innerHTML = "";
  for (const c of open) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn" + (c.id === selectedOpenId ? " selected" : "");
    btn.innerHTML = `<span class="name">${escapeHtml(c.name)}</span><span class="meta">${itemCountSummary(c.items)} · ${formatShortDate(c.createdAt)}</span>`;
    btn.addEventListener("click", () => {
      selectedOpenId = c.id;
      render();
    });
    el.listOpen.appendChild(btn);
  }

  el.listHistory.innerHTML = "";
  for (const c of closed) {
    const li = document.createElement("li");
    li.className = "history-card";
    li.innerHTML = `<div class="btn history-static"><strong>${escapeHtml(c.name)}</strong><span class="item-summary">${itemCountSummary(c.items)} · fechada ${c.closedAt ? formatShortDate(c.closedAt) : "—"}</span></div>`;
    el.listHistory.appendChild(li);
  }

  const selected = open.find((c) => c.id === selectedOpenId);
  if (!selected) {
    selectedOpenId = open[0]?.id ?? null;
  }
  const sel = open.find((c) => c.id === selectedOpenId);

  if (!sel) {
    el.detailPlaceholder.hidden = false;
    el.detailContent.hidden = true;
    return;
  }

  el.detailPlaceholder.hidden = true;
  el.detailContent.hidden = false;
  el.detailName.textContent = sel.name;

  el.emptyItems.hidden = sel.items.length > 0;
  el.detailTotal.hidden = sel.items.length === 0;
  el.detailTotalValue.textContent = formatMoney(comandaTotal(sel.items));

  el.itemsList.innerHTML = "";
  for (const line of sel.items) {
    const row = document.createElement("li");
    row.className = "item-row";
    const sub = lineSubtotal(line);
    row.innerHTML = `
      <div class="item-main">
        <span class="label">${escapeHtml(line.label)}</span>
        <span class="item-pricing">${formatMoney(line.valor)} / un. · ${formatMoney(sub)}</span>
      </div>
      <div class="qty-controls">
        <button type="button" class="btn icon" data-act="dec" data-id="${line.id}" aria-label="Diminuir">−</button>
        <span class="qty">${line.qty}</span>
        <button type="button" class="btn icon" data-act="inc" data-id="${line.id}" aria-label="Aumentar">+</button>
      </div>
    `;
    el.itemsList.appendChild(row);
  }

  el.itemsList.querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const act = b.getAttribute("data-act");
      if (!id || !act || !sel) return;
      const line = sel.items.find((i) => i.id === id);
      if (!line) return;
      if (act === "inc") line.qty += 1;
      if (act === "dec") {
        line.qty -= 1;
        if (line.qty <= 0) sel.items = sel.items.filter((i) => i.id !== id);
      }
      persist();
      render();
    });
  });
}

function persist() {
  saveState(comandas);
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

el.btnNew.addEventListener("click", () => {
  el.newName.value = "";
  el.modalNew.showModal();
  queueMicrotask(() => el.newName.focus());
});

el.modalCancel.addEventListener("click", () => el.modalNew.close());

el.formNew.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el.newName.value.trim();
  if (!name) return;
  const c = {
    id: uid(),
    name,
    open: true,
    createdAt: new Date().toISOString(),
    closedAt: null,
    items: [],
  };
  comandas.push(c);
  selectedOpenId = c.id;
  persist();
  el.modalNew.close();
  render();
});

el.formAddItem.addEventListener("submit", (e) => {
  e.preventDefault();
  const sel = openComandas().find((c) => c.id === selectedOpenId);
  if (!sel) return;
  const label = el.itemName.value.trim();
  const qty = Math.max(1, parseInt(String(el.itemQty.value), 10) || 1);
  const valorRaw = el.itemValor.value;
  const valor = asNonNegNumber(valorRaw);
  if (!label) return;
  if (valorRaw === "" || !Number.isFinite(parseFloat(String(valorRaw)))) return;

  const norm = label.toLowerCase();
  const existing = sel.items.find((i) => i.label.toLowerCase() === norm);
  if (existing) {
    const totalQty = existing.qty + qty;
    existing.valor = (existing.qty * existing.valor + qty * valor) / totalQty;
    existing.qty = totalQty;
  } else {
    sel.items.push({ id: uid(), label, qty, valor });
  }

  el.itemName.value = "";
  el.itemValor.value = "";
  el.itemQty.value = "1";
  persist();
  render();
  el.itemName.focus();
});

el.btnClose.addEventListener("click", () => {
  const sel = openComandas().find((c) => c.id === selectedOpenId);
  if (!sel) return;
  if (!window.confirm(`Fechar a comanda “${sel.name}”? Ela vai para o histórico.`)) return;
  sel.open = false;
  sel.closedAt = new Date().toISOString();
  selectedOpenId = openComandas()[0]?.id ?? null;
  persist();
  render();
});

render();
