/** Cliente REST do catálogo (Projeto B — leitura pública). */

export { normalizeSupabaseUrl, resolveCatalogoEnv } from "./config/env.mjs";

/** @typedef {{ id: string, nome: string, descricao: string | null, preco: number, categoria: string | null, ordem: number }} CatalogoItem */

/**
 * @param {import("./config/env.mjs").CatalogoEnv} env
 * @returns {Promise<CatalogoItem[]>}
 */
export async function fetchCatalogoItens(env) {
  const qs = new URLSearchParams({
    select: "id,nome,descricao,preco,categoria,ordem",
    ativo: "eq.true",
    order: "ordem.asc",
  });
  const res = await fetch(`${env.url}/rest/v1/catalogo_itens?${qs}`, {
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${env.anonKey}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Catálogo indisponível (${res.status})`);
  }
  /** @type {Array<{ id: string, nome: string, descricao?: string | null, preco: number | string, categoria?: string | null, ordem?: number }>} */
  const rows = await res.json();
  return rows.map((r) => ({
    id: String(r.id),
    nome: String(r.nome ?? "").trim(),
    descricao: r.descricao != null && String(r.descricao).trim() ? String(r.descricao).trim() : null,
    preco: typeof r.preco === "number" ? r.preco : parseFloat(String(r.preco ?? "0")) || 0,
    categoria: r.categoria != null && String(r.categoria).trim() ? String(r.categoria).trim() : null,
    ordem: typeof r.ordem === "number" ? r.ordem : parseInt(String(r.ordem ?? "0"), 10) || 0,
  }));
}
