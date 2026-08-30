import { fetchCatalogoItens, resolveCatalogoEnv } from "./catalogo-api.mjs";

const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** @param {number} n */
function formatMoney(n) {
  return moneyFmt.format(n);
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/** @param {import("./catalogo-api.mjs").CatalogoItem[]} items */
function groupByCategory(items) {
  /** @type {Map<string, import("./catalogo-api.mjs").CatalogoItem[]>} */
  const map = new Map();
  for (const item of items) {
    const cat = item.categoria || "Outros";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)?.push(item);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
}

/** @param {import("./catalogo-api.mjs").CatalogoItem[]} items */
function renderCatalog(items) {
  const root = document.getElementById("cardapio-content");
  const status = document.getElementById("cardapio-status");
  if (!root || !status) return;

  if (items.length === 0) {
    status.textContent = "Nenhum item ativo no catálogo.";
    root.hidden = true;
    return;
  }

  status.hidden = true;
  root.hidden = false;
  root.innerHTML = "";

  for (const [categoria, list] of groupByCategory(items)) {
    const section = document.createElement("section");
    section.className = "cardapio-section panel";
    section.innerHTML = `<h2 class="cardapio-categoria">${escapeHtml(categoria)}</h2>`;
    const ul = document.createElement("ul");
    ul.className = "cardapio-list";

    for (const item of list) {
      const li = document.createElement("li");
      li.className = "cardapio-item";
      li.innerHTML = `
        <div class="cardapio-item-main">
          <span class="cardapio-item-nome">${escapeHtml(item.nome)}</span>
          ${item.descricao ? `<span class="cardapio-item-desc">${escapeHtml(item.descricao)}</span>` : ""}
        </div>
        <span class="cardapio-item-preco">${formatMoney(item.preco)}</span>`;
      ul.appendChild(li);
    }

    section.appendChild(ul);
    root.appendChild(section);
  }
}

async function main() {
  const status = document.getElementById("cardapio-status");
  const env = await resolveCatalogoEnv();
  if (!env) {
    if (status) {
      status.textContent =
        "Configure config/local/catalogo-env.mjs (rode setup-local.bat e preencha as chaves).";
    }
    return;
  }

  try {
    const items = await fetchCatalogoItens(env);
    renderCatalog(items);
  } catch (e) {
    if (status) {
      status.textContent = e instanceof Error ? e.message : "Erro ao carregar catálogo.";
    }
  }
}

void main();
