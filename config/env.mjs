/**
 * Carrega credenciais Supabase a partir de config/local/ (gitignored).
 * Fallback: arquivos legados na raiz ou globalThis (útil em testes).
 */

/** @param {string} raw */
export function normalizeSupabaseUrl(raw) {
  let u = String(raw).trim();
  if (!u) return u;
  u = u.replace(/\/rest\/v1\/?$/i, "");
  u = u.replace(/\/+$/, "");
  return u;
}

/** @param {string[]} paths */
async function importFirst(paths) {
  for (const p of paths) {
    try {
      return await import(p);
    } catch {
      /* tenta próximo caminho */
    }
  }
  return null;
}

/** @typedef {{ url: string, anonKey: string }} SupabaseEnv */

/** @returns {Promise<SupabaseEnv | null>} */
export async function resolveSupabaseEnv() {
  const m = await importFirst(["./local/supabase-env.mjs", "../supabase-env.mjs"]);
  if (m) {
    const urlRaw = m.SUPABASE_URL ?? m.url;
    const anonKey = m.SUPABASE_ANON_KEY ?? m.anonKey;
    if (urlRaw && anonKey) {
      return { url: normalizeSupabaseUrl(String(urlRaw)), anonKey: String(anonKey).trim() };
    }
  }
  const urlRaw = globalThis.__SUPABASE_URL__;
  const anonKey = globalThis.__SUPABASE_ANON_KEY__;
  if (urlRaw && anonKey) {
    return { url: normalizeSupabaseUrl(String(urlRaw)), anonKey: String(anonKey).trim() };
  }
  return null;
}

/** @typedef {{ url: string, anonKey: string }} CatalogoEnv */

/** @returns {Promise<CatalogoEnv | null>} */
export async function resolveCatalogoEnv() {
  const m = await importFirst(["./local/catalogo-env.mjs", "../catalogo-env.mjs"]);
  if (m) {
    const urlRaw = m.CATALOGO_SUPABASE_URL ?? m.url;
    const anonKey = m.CATALOGO_ANON_KEY ?? m.anonKey;
    if (urlRaw && anonKey) {
      return { url: normalizeSupabaseUrl(String(urlRaw)), anonKey: String(anonKey).trim() };
    }
  }
  const urlRaw = globalThis.__CATALOGO_SUPABASE_URL__;
  const anonKey = globalThis.__CATALOGO_ANON_KEY__;
  if (urlRaw && anonKey) {
    return { url: normalizeSupabaseUrl(String(urlRaw)), anonKey: String(anonKey).trim() };
  }
  return null;
}
