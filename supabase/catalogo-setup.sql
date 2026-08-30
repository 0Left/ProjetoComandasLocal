-- Projeto B (catálogo) — execute no SQL Editor do Supabase do catálogo.
-- Banco separado do projeto das comandas.

create table if not exists public.catalogo_itens (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  preco numeric(10,2) not null check (preco >= 0),
  categoria text,
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists catalogo_itens_ativo_ordem on public.catalogo_itens (ativo, ordem);

alter table public.catalogo_itens enable row level security;

drop policy if exists "catalogo_publico_select" on public.catalogo_itens;
create policy "catalogo_publico_select"
  on public.catalogo_itens
  for select
  to anon, authenticated
  using (ativo = true);

-- Dados de exemplo (ignore conflitos se já existirem)
insert into public.catalogo_itens (nome, descricao, preco, categoria, ordem) values
  ('Cerveja', 'Long neck', 8.00, 'Bebidas', 1),
  ('Refrigerante', 'Lata 350ml', 5.00, 'Bebidas', 2),
  ('Porção de fritas', 'Individual', 18.00, 'Porções', 3),
  ('Hambúrguer', 'Simples', 22.00, 'Lanches', 4)
on conflict do nothing;
