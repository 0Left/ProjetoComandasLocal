/**
 * Comandas — SPA com Supabase (Realtime + Auth).
 *
 * Configuração (sem alterar index.html), use uma das opções:
 * 1) Arquivo opcional na raiz do site: `supabase-env.mjs` exportando:
 *    export const SUPABASE_URL = "https://....supabase.co";
 *    (só a raiz do projeto — NÃO inclua /rest/v1/ no final)
 *    export const SUPABASE_ANON_KEY = "eyJ...";
 * 2) Antes de carregar este script, defina no console ou em outro script injetado:
 *    globalThis.__SUPABASE_URL__ = "...";
 *    globalThis.__SUPABASE_ANON_KEY__ = "...";
 *
 * Visibilidade global (várias contas, mesma operação):
 * - O app não filtra por usuário: todas as comandas vêm do SELECT sem .eq(user_id).
 * - No Supabase, ajuste RLS para qualquer `authenticated` poder ler/escrever todas
 *   as linhas (senão cada conta só vê o que a política permitir).
 *
 * Migração sugerida — quem fechou a comanda (email no momento do fechamento):
 *   ALTER TABLE comandas ADD COLUMN IF NOT EXISTS fechada_por_email TEXT;
 *
 * RLS exemplo (substitua/remova políticas antigas que restrinjam por user_id):
 *   ALTER TABLE comandas ENABLE ROW LEVEL SECURITY;
 *   ALTER TABLE itens ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY comandas_select ON comandas FOR SELECT TO authenticated USING (true);
 *   CREATE POLICY comandas_ins ON comandas FOR INSERT TO authenticated WITH CHECK (true);
 *   CREATE POLICY comandas_upd ON comandas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
 *   CREATE POLICY comandas_del ON comandas FOR DELETE TO authenticated USING (true);
 *   CREATE POLICY itens_select ON itens FOR SELECT TO authenticated USING (true);
 *   CREATE POLICY itens_ins ON itens FOR INSERT TO authenticated WITH CHECK (true);
 *   CREATE POLICY itens_upd ON itens FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
 *   CREATE POLICY itens_del ON itens FOR DELETE TO authenticated USING (true);
 *
 * Realtime: inclua as tabelas na publicação (SQL ou painel Supabase), por exemplo:
 *   alter publication supabase_realtime add table comandas;
 *   alter publication supabase_realtime add table itens;
 * Sem isso, o websocket não recebe postgres_changes — a UI só atualiza após ações locais.
 * O app também faz polling leve e refetch ao focar a aba como redundância.
 */

(function () {
  "use strict";

  /** @typedef {{ id: string, label: string, qty: number, valor: number }} LineItem */
  /** @typedef {{ id: string, name: string, open: boolean, createdAt: string, closedAt: string | null, closedByEmail: string | null, items: LineItem[], total: number }} Comanda */

  /** @param {unknown} v */
  function asNonNegNumber(v) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  /** @param {unknown} v */
  function asMoneyNumber(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = parseFloat(String(v ?? "0"));
    return Number.isFinite(n) ? n : 0;
  }

  /** @param {Comanda[]} list */
  function normalizeComandas(list) {
    return list.map((c) => ({
      ...c,
      closedByEmail:
        c.closedByEmail != null && String(c.closedByEmail).trim()
          ? String(c.closedByEmail).trim()
          : null,
      total: asMoneyNumber(c.total),
      items: (c.items || []).map((i) => ({
        ...i,
        id: String(i.id),
        valor: asNonNegNumber(i.valor),
        qty: Math.max(0, Math.floor(asNonNegNumber(i.qty) || 0)) || 0,
      })).filter((i) => i.qty > 0 && i.label),
    }));
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
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
  function sumItemsTotal(items) {
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
      return String(iso);
    }
  }

  /** Data e hora de fechamento: dd/mm/aaaa — HH:mm */
  function formatClosedDateTime(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const date = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const time = d.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${date} — ${time}`;
    } catch {
      return String(iso);
    }
  }

  function itemCountSummary(items) {
    const n = items.reduce((s, i) => s + i.qty, 0);
    const kinds = items.length;
    if (kinds === 0) return "Sem itens";
    return `${kinds} tipo(s) · ${n} un. · ${formatMoney(sumItemsTotal(items))}`;
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  /** @param {string} raw */
  function normalizeSupabaseUrl(raw) {
    let u = String(raw).trim();
    if (!u) return u;
    u = u.replace(/\/rest\/v1\/?$/i, "");
    u = u.replace(/\/+$/, "");
    return u;
  }

  class EnvResolver {
    static async resolve() {
      try {
        const m = await import("./supabase-env.mjs");
        const urlRaw = m.SUPABASE_URL ?? m.url;
        const anonKey = m.SUPABASE_ANON_KEY ?? m.anonKey;
        if (urlRaw && anonKey) {
          return { url: normalizeSupabaseUrl(String(urlRaw)), anonKey: String(anonKey).trim() };
        }
      } catch {
        /* arquivo opcional ausente ou inválido */
      }
      const urlRaw = globalThis.__SUPABASE_URL__;
      const anonKey = globalThis.__SUPABASE_ANON_KEY__;
      if (urlRaw && anonKey) {
        return { url: normalizeSupabaseUrl(String(urlRaw)), anonKey: String(anonKey).trim() };
      }
      return null;
    }
  }

  class ToastHost {
    /** @param {HTMLElement} root */
    constructor(root) {
      this.root = root;
    }

    /** @param {string} message @param {"error"|"info"} kind */
    show(message, kind = "info") {
      const el = document.createElement("div");
      el.className = `app-toast app-toast--${kind}`;
      el.textContent = message;
      this.root.appendChild(el);
      requestAnimationFrame(() => el.classList.add("app-toast--visible"));
      const t = window.setTimeout(() => {
        el.classList.remove("app-toast--visible");
        window.setTimeout(() => el.remove(), 300);
      }, 4500);
      el.addEventListener("click", () => {
        window.clearTimeout(t);
        el.remove();
      });
    }
  }

  class NetworkError extends Error {
    /** @param {string} message @param {unknown} [cause] */
    constructor(message, cause) {
      super(message);
      this.name = "NetworkError";
      if (cause !== undefined) this.cause = cause;
    }
  }

  /** @param {{ message?: string }} | null | undefined err */
  function errMessage(err) {
    if (!err) return "Erro desconhecido.";
    if (typeof err === "object" && err && "message" in err && typeof err.message === "string") {
      return err.message;
    }
    return String(err);
  }

  class ComandasRepository {
    /** @param {import("@supabase/supabase-js").SupabaseClient} supabase @param {(m: string) => void} toast */
    constructor(supabase, toast) {
      this.supabase = supabase;
      this.toast = toast;
      /** @type {import("@supabase/supabase-js").RealtimeChannel | null} */
      this.channel = null;
      /** @type {(() => void) | null} */
      this.unsubscribeRefresh = null;
      /** @type {{ onData: (rows: Comanda[]) => void, onError: (e: unknown) => void } | null} */
      this.realtimeCb = null;
      /** @type {ReturnType<typeof setTimeout> | null} */
      this.realtimeReconnectTimer = null;
      /** @type {number} */
      this.realtimeRetryCount = 0;
    }

    /** Encerra websocket Realtime e timers; mantém realtimeCb para reconectar. */
    detachRealtimeChannel() {
      if (this.realtimeReconnectTimer) {
        window.clearTimeout(this.realtimeReconnectTimer);
        this.realtimeReconnectTimer = null;
      }
      if (this.channel) {
        void this.supabase.removeChannel(this.channel);
        this.channel = null;
      }
      if (this.unsubscribeRefresh) {
        this.unsubscribeRefresh();
        this.unsubscribeRefresh = null;
      }
    }

    dispose() {
      this.realtimeCb = null;
      this.detachRealtimeChannel();
      this.realtimeRetryCount = 0;
    }

    /** @param {() => void | Promise<void>} fn */
    async safe(fn) {
      try {
        await fn();
      } catch (e) {
        const msg = errMessage(/** @type {*} */ (e));
        if (msg.toLowerCase().includes("fetch") || msg.includes("Network")) {
          this.toast("Sem conexão ou servidor indisponível. Tente de novo.", "error");
          throw new NetworkError(msg, e);
        }
        this.toast(msg, "error");
        throw e;
      }
    }

    /**
     * @param {(rows: Comanda[]) => void} onData
     * @param {(e: unknown) => void} onError
     */
    subscribeRealtime(onData, onError) {
      this.realtimeCb = { onData, onError };
      if (this.channel) return;
      this.setupRealtimeChannel();
    }

    setupRealtimeChannel() {
      const cbs = this.realtimeCb;
      if (!cbs || this.channel) return;

      let timer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
      const schedule = () => {
        if (!this.realtimeCb) return;
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(async () => {
          timer = null;
          try {
            const rows = await this.fetchAllComandas();
            this.realtimeCb?.onData(rows);
          } catch (e) {
            this.realtimeCb?.onError(e);
          }
        }, 80);
      };
      this.unsubscribeRefresh = () => {
        if (timer) window.clearTimeout(timer);
      };

      const topic = `comandas:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      this.channel = this.supabase
        .channel(topic)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "comandas" },
          () => schedule(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "itens" },
          () => schedule(),
        )
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            this.realtimeRetryCount = 0;
            schedule();
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            if (!this.realtimeCb) return;
            const detail = err ? ` — ${errMessage(err)}` : "";
            this.toast(`Realtime: ${status}${detail}`, "error");
            this.detachRealtimeChannel();
            this.realtimeRetryCount += 1;
            if (!this.realtimeCb || this.realtimeRetryCount > 12) return;
            const delay = Math.min(8000, 400 + this.realtimeRetryCount * 600);
            this.realtimeReconnectTimer = window.setTimeout(() => {
              this.realtimeReconnectTimer = null;
              if (!this.realtimeCb) return;
              this.setupRealtimeChannel();
            }, delay);
          }
        });
    }

    /** @returns {Promise<Comanda[]>} */
    async fetchAllComandas() {
      const { data, error } = await this.supabase
        .from("comandas")
        .select(
          `
          id,
          nome,
          status,
          criada_em,
          fechada_em,
          fechada_por_email,
          total,
          itens (
            id,
            nome,
            valor_unitario,
            quantidade,
            criado_em
          )
        `,
        )
        .order("criada_em", { ascending: false });

      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      /** @type {Comanda[]} */
      const out = rows.map((row) => this.mapRow(/** @type {*} */ (row)));
      return normalizeComandas(out);
    }

    /** @param {*} row */
    mapRow(row) {
      const itemsRaw = Array.isArray(row.itens) ? row.itens : [];
      const items = [...itemsRaw].sort((a, b) => {
        const ta = new Date(a.criado_em).getTime();
        const tb = new Date(b.criado_em).getTime();
        if (ta !== tb) return ta - tb;
        return (a.id ?? 0) - (b.id ?? 0);
      });
      return {
        id: String(row.id),
        name: String(row.nome ?? ""),
        open: String(row.status ?? "aberta") === "aberta",
        createdAt: row.criada_em,
        closedAt: row.fechada_em,
        closedByEmail: row.fechada_por_email != null && String(row.fechada_por_email).trim()
          ? String(row.fechada_por_email).trim()
          : null,
        total: asMoneyNumber(row.total),
        items: items.map((it) => ({
          id: String(it.id),
          label: String(it.nome ?? ""),
          qty: Math.max(0, Math.floor(Number(it.quantidade) || 0)),
          valor: asNonNegNumber(it.valor_unitario),
        })),
      };
    }

    /** @param {string} nome @param {string} userId */
    async createComanda(nome, userId) {
      const id = uid();
      const row = {
        id,
        nome,
        status: "aberta",
        user_id: userId,
      };
      const { data, error } = await this.supabase.from("comandas").insert(row).select("*").single();
      if (error) throw error;
      return this.mapRow(data);
    }

    /**
     * @param {string} comandaId
     * @param {{ email: string | null }} closer
     */
    async closeComanda(comandaId, closer) {
      const email = closer.email && String(closer.email).trim() ? String(closer.email).trim() : null;
      const { error } = await this.supabase
        .from("comandas")
        .update({
          status: "fechada",
          fechada_em: new Date().toISOString(),
          fechada_por_email: email,
        })
        .eq("id", comandaId)
        .eq("status", "aberta");
      if (error) throw error;
    }

    /**
     * Inclui item. Concorrência: INSERT distinto por linha; nomes iguais viram linhas separadas
     * (evita sobrescrever atualização simultânea de outro usuário na mesma linha).
     * @param {string} comandaId
     * @param {{ nome: string, valor_unitario: number, quantidade: number }} payload
     */
    async insertItem(comandaId, payload) {
      const { error } = await this.supabase.from("itens").insert({
        comanda_id: comandaId,
        nome: payload.nome,
        valor_unitario: payload.valor_unitario,
        quantidade: payload.quantidade,
      });
      if (error) throw error;
    }

    /**
     * Atualiza quantidade com re-leitura otimista: se o UPDATE não afetar linhas
     * (ex.: outro usuário apagou), relança erro para a UI refetch.
     * @param {number} itemDbId
     * @param {number} newQty
     */
    async updateItemQuantity(itemDbId, newQty) {
      const { data, error } = await this.supabase
        .from("itens")
        .update({ quantidade: newQty })
        .eq("id", itemDbId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const e = new Error("Item já foi removido ou alterado por outro usuário. Atualizando lista…");
        /** @type {*} */ (e).code = "CONFLICT_REFRESH";
        throw e;
      }
    }

    /** @param {number} itemDbId */
    async deleteItem(itemDbId) {
      const { error } = await this.supabase.from("itens").delete().eq("id", itemDbId);
      if (error) throw error;
    }
  }

  class AuthGate {
    /** @param {import("@supabase/supabase-js").SupabaseClient} supabase @param {ToastHost} toasts */
    constructor(supabase, toasts) {
      this.supabase = supabase;
      this.toasts = toasts;
      this.overlay = document.createElement("div");
      this.overlay.className = "app-auth-overlay";
      this.overlay.innerHTML = `
        <div class="app-auth-card" role="dialog" aria-modal="true" aria-labelledby="app-auth-title">
          <h2 id="app-auth-title">Entrar</h2>
          <p class="app-auth-hint">Use o mesmo projeto Supabase com email/senha habilitado.</p>
          <form class="app-auth-form" id="app-auth-form">
            <label>Email<input type="email" name="email" autocomplete="username" required /></label>
            <label>Senha<input type="password" name="password" autocomplete="current-password" required /></label>
            <div class="app-auth-actions">
              <button type="button" class="btn" id="app-auth-toggle">Criar conta</button>
              <button type="submit" class="btn primary" id="app-auth-submit">Entrar</button>
            </div>
          </form>
          <p class="app-auth-error" id="app-auth-error" hidden></p>
        </div>`;
      this.form = /** @type {HTMLFormElement} */ (this.overlay.querySelector("#app-auth-form"));
      this.errEl = /** @type {HTMLParagraphElement} */ (this.overlay.querySelector("#app-auth-error"));
      this.toggleBtn = /** @type {HTMLButtonElement} */ (this.overlay.querySelector("#app-auth-toggle"));
      this.submitBtn = /** @type {HTMLButtonElement} */ (this.overlay.querySelector("#app-auth-submit"));
      /** @type {"signin"|"signup"} */
      this.mode = "signin";
      this.toggleBtn.addEventListener("click", () => {
        this.mode = this.mode === "signin" ? "signup" : "signin";
        this.submitBtn.textContent = this.mode === "signin" ? "Entrar" : "Registrar";
        this.toggleBtn.textContent = this.mode === "signin" ? "Criar conta" : "Já tenho conta";
        this.clearError();
      });
      this.form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        void this.onSubmit();
      });
    }

    mount() {
      document.body.appendChild(this.overlay);
    }

    show() {
      this.overlay.hidden = false;
    }

    hide() {
      this.overlay.hidden = true;
      this.clearError();
    }

    clearError() {
      this.errEl.hidden = true;
      this.errEl.textContent = "";
    }

    setError(msg) {
      this.errEl.textContent = msg;
      this.errEl.hidden = false;
    }

    setBusy(b) {
      this.form.querySelectorAll("input,button").forEach((n) => {
        /** @type {HTMLInputElement | HTMLButtonElement} */ (n).disabled = b;
      });
    }

    async onSubmit() {
      const fd = new FormData(this.form);
      const email = String(fd.get("email") ?? "").trim();
      const password = String(fd.get("password") ?? "");
      if (!email || !password) return;
      this.clearError();
      this.setBusy(true);
      try {
        if (this.mode === "signin") {
          const { error } = await this.supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else {
          const { error } = await this.supabase.auth.signUp({ email, password });
          if (error) throw error;
          this.toasts.show("Conta criada. Verifique o email se a confirmação estiver ativa no Supabase.", "info");
        }
      } catch (e) {
        this.setError(errMessage(e));
      } finally {
        this.setBusy(false);
      }
    }
  }

  class LoadingShell {
    constructor() {
      this.bar = document.createElement("div");
      this.bar.className = "app-loading-bar";
      this.bar.setAttribute("role", "status");
      this.bar.setAttribute("aria-live", "polite");
      this.bar.textContent = "Carregando…";
      this.bar.hidden = true;
      document.body.appendChild(this.bar);
    }

    /** @param {boolean} on @param {string} [label] */
    set(on, label) {
      this.bar.hidden = !on;
      if (label) this.bar.textContent = label;
      document.body.classList.toggle("app-is-loading", on);
    }
  }

  function injectStyles() {
    if (document.getElementById("app-injected-styles")) return;
    const s = document.createElement("style");
    s.id = "app-injected-styles";
    s.textContent = `
      .app-auth-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:grid;place-items:center;z-index:1000;padding:1rem;}
      .app-auth-overlay[hidden]{display:none!important;}
      .app-auth-card{width:min(400px,100%);background:var(--surface,#1a222c);border:1px solid var(--border,#2d3a47);border-radius:10px;padding:1.25rem;color:var(--text,#e8eef4);}
      .app-auth-card h2{margin:0 0 .5rem;font-size:1.15rem;}
      .app-auth-hint{margin:0 0 1rem;font-size:.85rem;color:var(--muted,#8b9bab);}
      .app-auth-form{display:flex;flex-direction:column;gap:.65rem;}
      .app-auth-form label{display:flex;flex-direction:column;gap:.25rem;font-size:.85rem;color:var(--muted,#8b9bab);}
      .app-auth-form input{font:inherit;padding:.45rem .6rem;border-radius:8px;border:1px solid var(--border,#2d3a47);background:var(--bg,#0f1419);color:var(--text,#e8eef4);}
      .app-auth-actions{display:flex;justify-content:space-between;gap:.5rem;margin-top:.35rem;flex-wrap:wrap;}
      .app-auth-error{margin:.75rem 0 0;color:#f07070;font-size:.875rem;}
      .app-loading-bar{position:fixed;top:0;left:0;right:0;z-index:900;padding:.55rem 1rem;text-align:center;font-size:.85rem;background:rgba(61,156,240,.95);color:#0a0e12;}
      .app-loading-bar[hidden]{display:none!important;}
      body.app-is-loading .btn,body.app-is-loading input,body.app-is-loading button{pointer-events:none;opacity:.72;}
      .app-toast-host{position:fixed;bottom:1rem;right:1rem;z-index:950;display:flex;flex-direction:column;gap:.4rem;max-width:min(420px,calc(100vw - 2rem));pointer-events:none;}
      .app-toast{pointer-events:auto;background:var(--surface,#1a222c);border:1px solid var(--border,#2d3a47);color:var(--text,#e8eef4);padding:.65rem .85rem;border-radius:8px;font-size:.875rem;opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s;}
      .app-toast--visible{opacity:1;transform:translateY(0);}
      .app-toast--error{border-color:rgba(232,93,93,.55);}
      .app-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-left:auto;}
      .app-toolbar .btn{font-size:.8rem;padding:.35rem .55rem;}
      .app-user-email{font-size:.75rem;color:var(--muted,#8b9bab);max-width:12rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    `;
    document.head.appendChild(s);
  }

  class ComandasApp {
    constructor() {
      injectStyles();
      this.toastHostEl = document.createElement("div");
      this.toastHostEl.className = "app-toast-host";
      document.body.appendChild(this.toastHostEl);
      this.toasts = new ToastHost(this.toastHostEl);

      /** @type {import("@supabase/supabase-js").SupabaseClient | null} */
      this.supabase = null;
      /** @type {ComandasRepository | null} */
      this.repo = null;
      /** @type {AuthGate | null} */
      this.authGate = null;
      this.loading = new LoadingShell();

      /** @type {Comanda[]} */
      this.comandas = [];
      /** @type {string | null} */
      this.selectedComandaId = null;
      /** @type {boolean} */
      this.bootstrapped = false;
      /** @type {string | null} */
      this.userId = null;
      /** @type {string | null} */
      this.userEmail = null;
      /** @type {ReturnType<typeof setInterval> | null} */
      this.syncPollTimer = null;
      /** @type {(() => void) | null} */
      this._syncOnVis = null;

      this.el = {
        listOpen: document.getElementById("list-open"),
        listHistory: document.getElementById("list-history"),
        emptyOpen: document.getElementById("empty-open"),
        emptyHistory: document.getElementById("empty-history"),
        detailPlaceholder: document.getElementById("detail-placeholder"),
        detailContent: document.getElementById("detail-content"),
        detailClosedBanner: document.getElementById("detail-closed-banner"),
        detailClosedMeta: document.getElementById("detail-closed-meta"),
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

      this.toolbar = document.createElement("div");
      this.toolbar.className = "app-toolbar";
      this.toolbar.innerHTML = `
        <span class="app-user-email" id="app-user-email" hidden></span>
        <button type="button" class="btn" id="app-btn-signout" hidden>Sair</button>`;
      const header = document.querySelector(".app-header");
      if (header) {
        header.style.display = "flex";
        header.style.flexWrap = "wrap";
        header.style.alignItems = "center";
        header.style.gap = "0.75rem";
        header.appendChild(this.toolbar);
      }

      this.elUserEmail = /** @type {HTMLSpanElement} */ (this.toolbar.querySelector("#app-user-email"));
      this.elBtnSignout = /** @type {HTMLButtonElement} */ (this.toolbar.querySelector("#app-btn-signout"));
      this.elBtnSignout.addEventListener("click", () => void this.signOut());

      this.bindDom();
    }

    async signOut() {
      if (!this.supabase) return;
      this.loading.set(true, "Saindo…");
      try {
        const { error } = await this.supabase.auth.signOut();
        if (error) throw error;
      } catch (e) {
        this.toasts.show(errMessage(e), "error");
      } finally {
        this.loading.set(false);
      }
    }

    bindDom() {
      this.el.btnNew.addEventListener("click", () => {
        this.el.newName.value = "";
        this.el.modalNew.showModal();
        queueMicrotask(() => this.el.newName.focus());
      });
      this.el.modalCancel.addEventListener("click", () => this.el.modalNew.close());
      this.el.formNew.addEventListener("submit", (e) => {
        e.preventDefault();
        void this.onCreateComanda();
      });
      this.el.formAddItem.addEventListener("submit", (e) => {
        e.preventDefault();
        void this.onAddItem();
      });
      this.el.btnClose.addEventListener("click", () => void this.onCloseComanda());
    }

    async bootstrap() {
      const env = await EnvResolver.resolve();
      if (!env) {
        this.toasts.show(
          "Defina Supabase: crie supabase-env.mjs ou globalThis.__SUPABASE_URL__ / __SUPABASE_ANON_KEY__.",
          "error",
        );
        return;
      }

      this.loading.set(true, "Conectando…");
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        this.supabase = createClient(env.url, env.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage,
          },
          global: {
            fetch: (...args) =>
              fetch(...args).catch((e) => {
                throw new NetworkError("Falha de rede ao falar com o Supabase.", e);
              }),
          },
        });
      } catch (e) {
        this.loading.set(false);
        this.toasts.show(errMessage(e), "error");
        return;
      }

      this.repo = new ComandasRepository(this.supabase, (m) => this.toasts.show(m, "error"));
      this.authGate = new AuthGate(this.supabase, this.toasts);
      this.authGate.mount();

      this.supabase.auth.onAuthStateChange((_event, session) => {
        void this.onSession(session);
      });

      const { data } = await this.supabase.auth.getSession();
      await this.onSession(data.session);
      this.loading.set(false);
      this.bootstrapped = true;
    }

    /** @param {import("@supabase/supabase-js").Session | null} session */
    async onSession(session) {
      this.userId = session?.user?.id ?? null;
      this.userEmail = session?.user?.email ?? null;
      const authed = !!session?.user;

      if (this.elUserEmail && session?.user?.email) {
        this.elUserEmail.textContent = session.user.email;
        this.elUserEmail.hidden = false;
        this.elBtnSignout.hidden = false;
      } else {
        this.elUserEmail.hidden = true;
        this.elBtnSignout.hidden = true;
      }

      if (!authed) {
        this.stopBackgroundSync();
        this.repo?.dispose();
        this.comandas = [];
        this.selectedComandaId = null;
        this.userEmail = null;
        this.authGate?.show();
        this.render();
        return;
      }

      this.authGate?.hide();

      if (!this.repo) return;
      this.loading.set(true, "Sincronizando comandas…");
      try {
        await this.refreshFromServer();
        this.repo.subscribeRealtime(
          (rows) => {
            this.comandas = normalizeComandas(rows);
            this.ensureSelection();
            this.render();
          },
          (e) => this.toasts.show(errMessage(e), "error"),
        );
        this.startBackgroundSync();
      } catch (e) {
        this.toasts.show(errMessage(e), "error");
      } finally {
        this.loading.set(false);
      }
      this.render();
    }

    async refreshFromServer() {
      if (!this.repo) return;
      const rows = await this.repo.fetchAllComandas();
      this.comandas = normalizeComandas(rows);
      this.ensureSelection();
    }

    /** Atualização silenciosa (poll / foco) para manter todas as abas alinhadas. */
    async softPullRemote() {
      if (!this.repo) return;
      try {
        await this.refreshFromServer();
        this.render();
      } catch {
        /* evita spam de toast em intervalo; falhas de rede aparecem nas ações explícitas */
      }
    }

    startBackgroundSync() {
      this.stopBackgroundSync();
      this._syncOnVis = () => {
        if (document.visibilityState !== "visible") return;
        void this.softPullRemote();
      };
      document.addEventListener("visibilitychange", this._syncOnVis);
      window.addEventListener("focus", this._syncOnVis);
      this.syncPollTimer = window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void this.softPullRemote();
      }, 3500);
    }

    stopBackgroundSync() {
      if (this.syncPollTimer != null) {
        window.clearInterval(this.syncPollTimer);
        this.syncPollTimer = null;
      }
      if (this._syncOnVis) {
        document.removeEventListener("visibilitychange", this._syncOnVis);
        window.removeEventListener("focus", this._syncOnVis);
        this._syncOnVis = null;
      }
    }

    ensureSelection() {
      const open = this.openComandas();
      if (!this.comandas.some((c) => c.id === this.selectedComandaId)) {
        this.selectedComandaId = open[0]?.id ?? this.comandas[0]?.id ?? null;
      }
    }

    openComandas() {
      return this.comandas.filter((c) => c.open);
    }

    closedComandas() {
      return this.comandas.filter((c) => !c.open).sort((a, b) => {
        const ta = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const tb = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return tb - ta;
      });
    }

    render() {
      const open = this.openComandas();
      const closed = this.closedComandas();

      this.ensureSelection();

      this.el.emptyOpen.hidden = open.length > 0;
      this.el.emptyHistory.hidden = closed.length > 0;

      this.el.listOpen.innerHTML = "";
      for (const c of open) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn" + (c.id === this.selectedComandaId ? " selected" : "");
        btn.innerHTML = `<span class="name">${escapeHtml(c.name)}</span><span class="meta">${itemCountSummary(c.items)} · ${formatShortDate(c.createdAt)}</span>`;
        btn.addEventListener("click", () => {
          this.selectedComandaId = c.id;
          this.render();
        });
        this.el.listOpen.appendChild(btn);
      }

      this.el.listHistory.innerHTML = "";
      for (const c of closed) {
        const li = document.createElement("li");
        li.className = "history-card";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn history-entry" + (c.id === this.selectedComandaId ? " selected" : "");
        btn.innerHTML = `<strong>${escapeHtml(c.name)}</strong><span class="item-summary">${itemCountSummary(c.items)} · fechada ${c.closedAt ? formatShortDate(c.closedAt) : "—"}${c.closedByEmail ? ` · por ${escapeHtml(c.closedByEmail)}` : ""}</span>`;
        btn.addEventListener("click", () => {
          this.selectedComandaId = c.id;
          this.render();
        });
        li.appendChild(btn);
        this.el.listHistory.appendChild(li);
      }

      const sel = this.comandas.find((c) => c.id === this.selectedComandaId);

      if (!sel) {
        this.el.detailPlaceholder.hidden = false;
        this.el.detailContent.hidden = true;
        this.el.detailContent.classList.remove("detail-content--closed");
        return;
      }

      const isOpen = sel.open;

      this.el.detailPlaceholder.hidden = true;
      this.el.detailContent.hidden = false;
      this.el.detailContent.classList.toggle("detail-content--closed", !isOpen);
      this.el.detailName.textContent = sel.name;

      this.el.detailClosedBanner.hidden = isOpen;
      this.el.detailClosedMeta.textContent = isOpen
        ? ""
        : `Fechada em ${formatClosedDateTime(sel.closedAt)}${sel.closedByEmail ? ` · por ${sel.closedByEmail}` : ""}`;

      this.el.formAddItem.hidden = !isOpen;
      this.el.formAddItem.setAttribute("aria-hidden", isOpen ? "false" : "true");
      this.el.btnClose.hidden = !isOpen;

      this.el.emptyItems.hidden = sel.items.length > 0;
      if (sel.items.length === 0) {
        this.el.emptyItems.textContent = isOpen
          ? "Nenhum item ainda. Inclua acima."
          : "Nenhum item registrado nesta comanda.";
      }
      this.el.detailTotal.hidden = sel.items.length === 0;
      const displayTotal = sel.items.length ? asMoneyNumber(sel.total) : 0;
      this.el.detailTotalValue.textContent = formatMoney(displayTotal);

      this.el.itemsList.innerHTML = "";
      for (const line of sel.items) {
        const row = document.createElement("li");
        const sub = lineSubtotal(line);
        if (isOpen) {
          row.className = "item-row";
          row.innerHTML = `
      <div class="item-main">
        <span class="label">${escapeHtml(line.label)}</span>
        <span class="item-pricing">${formatMoney(line.valor)} / un. · ${formatMoney(sub)}</span>
      </div>
      <div class="qty-controls">
        <button type="button" class="btn icon" data-act="dec" data-id="${escapeHtml(line.id)}" aria-label="Diminuir">−</button>
        <span class="qty">${line.qty}</span>
        <button type="button" class="btn icon" data-act="inc" data-id="${escapeHtml(line.id)}" aria-label="Aumentar">+</button>
      </div>
    `;
        } else {
          row.className = "item-row item-row-readonly";
          row.innerHTML = `
      <div class="item-main">
        <span class="label">${escapeHtml(line.label)}</span>
        <span class="item-pricing">${formatMoney(line.valor)} / un. · ${formatMoney(sub)}</span>
      </div>
      <span class="qty-readonly">${line.qty} un.</span>
    `;
        }
        this.el.itemsList.appendChild(row);
      }

      if (isOpen) {
        this.el.itemsList.querySelectorAll("button[data-act]").forEach((b) => {
          b.addEventListener("click", () => {
            const id = b.getAttribute("data-id");
            const act = b.getAttribute("data-act");
            if (!id || !act) return;
            void this.onQtyDelta(sel.id, id, act);
          });
        });
      }
    }

    async onCreateComanda() {
      if (!this.repo || !this.userId) return;
      const name = this.el.newName.value.trim();
      if (!name) return;
      this.loading.set(true, "Criando comanda…");
      try {
        await this.repo.safe(async () => {
          await this.repo.createComanda(name, this.userId);
          await this.refreshFromServer();
        });
        this.el.modalNew.close();
        this.render();
      } catch (e) {
        if (/** @type {*} */ (e)?.code === "CONFLICT_REFRESH" || errMessage(e).includes("Atualizando lista")) {
          await this.safeRefreshAfterConflict();
        }
      } finally {
        this.loading.set(false);
      }
    }

    async onAddItem() {
      if (!this.repo) return;
      const sel = this.openComandas().find((c) => c.id === this.selectedComandaId);
      if (!sel) return;
      const label = this.el.itemName.value.trim();
      const qty = Math.max(1, parseInt(String(this.el.itemQty.value), 10) || 1);
      const valorRaw = this.el.itemValor.value;
      const valor = asNonNegNumber(valorRaw);
      if (!label) return;
      if (valorRaw === "" || !Number.isFinite(parseFloat(String(valorRaw)))) return;

      this.loading.set(true, "Incluindo item…");
      try {
        await this.repo.safe(async () => {
          await this.repo.insertItem(sel.id, {
            nome: label,
            valor_unitario: valor,
            quantidade: qty,
          });
          await this.refreshFromServer();
        });
        this.el.itemName.value = "";
        this.el.itemValor.value = "";
        this.el.itemQty.value = "1";
        this.el.itemName.focus();
        this.render();
      } catch (e) {
        if (e instanceof NetworkError) await this.safeRefreshAfterConflict();
      } finally {
        this.loading.set(false);
      }
    }

    /**
     * @param {string} comandaId
     * @param {string} lineId
     * @param {"inc"|"dec"} act
     */
    async onQtyDelta(comandaId, lineId, act) {
      if (!this.repo) return;
      const sel = this.comandas.find((c) => c.id === comandaId);
      if (!sel || !sel.open) return;
      const line = sel.items.find((i) => i.id === lineId);
      if (!line) return;

      const dbId = parseInt(lineId, 10);
      if (!Number.isFinite(dbId)) return;

      let newQty = line.qty;
      if (act === "inc") newQty += 1;
      if (act === "dec") newQty -= 1;

      this.loading.set(true, "Atualizando item…");
      try {
        await this.repo.safe(async () => {
          if (newQty <= 0) {
            await this.repo.deleteItem(dbId);
          } else {
            await this.repo.updateItemQuantity(dbId, newQty);
          }
          await this.refreshFromServer();
        });
        this.render();
      } catch (e) {
        const code = /** @type {*} */ (e)?.code;
        if (code === "CONFLICT_REFRESH" || errMessage(e).includes("outro usuário")) {
          this.toasts.show("Lista atualizada após edição de outro usuário.", "info");
          await this.safeRefreshAfterConflict();
        } else if (e instanceof NetworkError) {
          await this.safeRefreshAfterConflict();
        }
      } finally {
        this.loading.set(false);
      }
    }

    async onCloseComanda() {
      if (!this.repo) return;
      const sel = this.openComandas().find((c) => c.id === this.selectedComandaId);
      if (!sel) return;
      if (!window.confirm(`Fechar a comanda “${sel.name}”? Ela vai para o histórico.`)) return;

      this.loading.set(true, "Fechando comanda…");
      try {
        await this.repo.safe(async () => {
          await this.repo.closeComanda(sel.id, { email: this.userEmail });
          await this.refreshFromServer();
          const nextOpen = this.openComandas()[0];
          this.selectedComandaId = nextOpen?.id ?? sel.id;
        });
        this.render();
      } catch (e) {
        const msg = errMessage(e);
        if (msg.includes("rows") || msg.includes("0 rows")) {
          this.toasts.show("Esta comanda já foi fechada por outro usuário.", "info");
          await this.safeRefreshAfterConflict();
        }
      } finally {
        this.loading.set(false);
      }
    }

    async safeRefreshAfterConflict() {
      if (!this.repo) return;
      try {
        await this.refreshFromServer();
        this.render();
      } catch (e) {
        this.toasts.show(errMessage(e), "error");
      }
    }
  }

  const app = new ComandasApp();
  void app.bootstrap();
})();
