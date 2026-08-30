# Comandas

SPA estática para gestão de comandas com dois projetos Supabase:

| Projeto | Pasta de config | Uso |
|---------|-----------------|-----|
| **A** | `config/local/supabase-env.mjs` | Comandas, login, gravação |
| **B** | `config/local/catalogo-env.mjs` | Cardápio público (somente leitura) |

## Configuração local

1. Clone o repositório.
2. Execute `setup-local.bat` (cria os arquivos em `config/local/` a partir dos exemplos).
3. Edite `config/local/supabase-env.mjs` e `config/local/catalogo-env.mjs` com URL e **anon key** de cada projeto Supabase.
4. Rode `servidor.bat` e abra `http://localhost:8080/`.

Os arquivos em `config/local/` **não sobem para o Git** — só os `.example` em `config/examples/`.

## Rotas

- `/` — Comandas (requer login Supabase)
- `/cardapio.html` — Catálogo público

## SQL do catálogo

Script de referência para o Projeto B: `supabase/catalogo-setup.sql`.
