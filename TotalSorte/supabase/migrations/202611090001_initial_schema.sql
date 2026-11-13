-- TotalSorte | Estrutura inicial Supabase/PostgreSQL
-- Execute no SQL Editor do projeto Supabase, após revisar este arquivo.
-- Valores monetários usam centavos (inteiros) para evitar erros de arredondamento.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  display_name text,
  phone text,
  pix_key text,
  role text not null default 'participant' check (role in ('participant','admin')),
  status text not null default 'active' check (status in ('active','blocked','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  modality text not null default 'MIX' check (modality in ('MIX','LOTOFACIL','LOTOMANIA')),
  capacity_quotas integer not null default 10 check (capacity_quotas between 1 and 10),
  status text not null default 'open' check (status in ('open','awaiting_payment','ready','active','paused','closed','cancelled')),
  current_round integer not null default 1 check (current_round > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotas (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  multiplier integer not null check (multiplier between 1 and 5),
  quota_count integer generated always as (multiplier) stored,
  unit_amount_cents integer not null default 1050 check (unit_amount_cents >= 0),
  total_amount_cents integer generated always as (multiplier * unit_amount_cents) stored,
  status text not null default 'pending' check (status in ('pending','reserved','paid','rejected','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quotas_group_idx on public.quotas(group_id);
create index if not exists quotas_participant_idx on public.quotas(participant_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  quota_id uuid not null references public.quotas(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','under_review','confirmed','rejected','expired')),
  payment_reference text,
  admin_note text,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payments_status_idx on public.payments(status, created_at);

create table if not exists public.contests (
  id uuid primary key default gen_random_uuid(),
  modality text not null check (modality in ('LOTOFACIL','LOTOMANIA')),
  contest_number integer not null,
  draw_date date,
  drawn_numbers integer[] not null,
  source text not null default 'CAIXA',
  fetched_at timestamptz not null default now(),
  unique(modality, contest_number)
);

create table if not exists public.game_sets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  round_number integer not null check (round_number > 0),
  version_number integer not null check (version_number > 0),
  version_type text not null check (version_type in ('preview','definitive')),
  source text,
  contest_refs jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(group_id, round_number, version_number)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  game_set_id uuid not null references public.game_sets(id) on delete restrict,
  game_code text not null,
  modality text not null check (modality in ('LOTOFACIL','LOTOMANIA')),
  numbers integer[] not null,
  created_at timestamptz not null default now(),
  unique(game_set_id, game_code)
);

create table if not exists public.bet_registrations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  round_number integer not null check (round_number > 0),
  lotofacil_contest integer,
  lotomania_contest integer,
  total_paid_cents integer not null check (total_paid_cents >= 0),
  status text not null default 'awaiting_registration' check (status in ('awaiting_registration','registered')),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(group_id, round_number)
);

create table if not exists public.wallet_accounts (
  participant_id uuid primary key references public.profiles(id) on delete restrict,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  reserved_cents bigint not null default 0 check (reserved_cents >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles(id) on delete restrict,
  group_id uuid references public.groups(id),
  withdrawal_id uuid,
  transaction_type text not null check (transaction_type in ('prize_credit','withdrawal_reserve','withdrawal_paid','withdrawal_release','adjustment')),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null,
  idempotency_key text unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists wallet_transactions_participant_idx on public.wallet_transactions(participant_id, created_at desc);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  pix_key_snapshot text not null,
  status text not null default 'requested' check (status in ('requested','processing','paid','failed')),
  admin_note text,
  processed_by uuid references public.profiles(id),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'); $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, display_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Novo participante'),
    new.raw_user_meta_data->>'display_name',
    coalesce(new.phone, new.raw_user_meta_data->>'phone')
  ) on conflict (id) do nothing;
  insert into public.wallet_accounts(participant_id) values (new.id) on conflict (participant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_totalsorte on auth.users;
create trigger on_auth_user_created_totalsorte
after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.quotas enable row level security;
alter table public.payments enable row level security;
alter table public.contests enable row level security;
alter table public.game_sets enable row level security;
alter table public.games enable row level security;
alter table public.bet_registrations enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.admin_logs enable row level security;

-- Perfis: participante lê apenas o próprio perfil; admin tem acesso administrativo.
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Grupos e concursos podem ser consultados por usuários autenticados; alterações só pelo admin.
drop policy if exists groups_read_authenticated on public.groups;
create policy groups_read_authenticated on public.groups for select to authenticated using (true);
drop policy if exists groups_admin_all on public.groups;
create policy groups_admin_all on public.groups for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists contests_read_authenticated on public.contests;
create policy contests_read_authenticated on public.contests for select to authenticated using (true);
drop policy if exists contests_admin_all on public.contests;
create policy contests_admin_all on public.contests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Cotas e pagamentos: participante consulta os próprios registros; escrita administrativa protegida.
drop policy if exists quotas_read_owner_or_admin on public.quotas;
create policy quotas_read_owner_or_admin on public.quotas for select to authenticated using (participant_id = auth.uid() or public.is_admin());
drop policy if exists quotas_admin_all on public.quotas;
create policy quotas_admin_all on public.quotas for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists payments_read_owner_or_admin on public.payments;
create policy payments_read_owner_or_admin on public.payments for select to authenticated using (participant_id = auth.uid() or public.is_admin());
drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_all on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Jogos: somente participantes vinculados ao grupo ou admins podem consultar.
drop policy if exists game_sets_read_member_or_admin on public.game_sets;
create policy game_sets_read_member_or_admin on public.game_sets for select to authenticated using (
  public.is_admin() or exists (select 1 from public.quotas q where q.group_id = game_sets.group_id and q.participant_id = auth.uid() and q.status = 'paid')
);
drop policy if exists game_sets_admin_all on public.game_sets;
create policy game_sets_admin_all on public.game_sets for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists games_read_member_or_admin on public.games;
create policy games_read_member_or_admin on public.games for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.game_sets gs join public.quotas q on q.group_id = gs.group_id
    where gs.id = games.game_set_id and q.participant_id = auth.uid() and q.status = 'paid'
  )
);
drop policy if exists games_admin_all on public.games;
create policy games_admin_all on public.games for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Registro CAIXA: somente admin pode consultar e alterar por enquanto.
drop policy if exists bet_registrations_admin_all on public.bet_registrations;
create policy bet_registrations_admin_all on public.bet_registrations for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Carteira e extrato: leitura própria; sem UPDATE/INSERT direto pelo cliente.
drop policy if exists wallet_accounts_read_owner_or_admin on public.wallet_accounts;
create policy wallet_accounts_read_owner_or_admin on public.wallet_accounts for select to authenticated using (participant_id = auth.uid() or public.is_admin());
drop policy if exists wallet_accounts_admin_all on public.wallet_accounts;
create policy wallet_accounts_admin_all on public.wallet_accounts for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists wallet_transactions_read_owner_or_admin on public.wallet_transactions;
create policy wallet_transactions_read_owner_or_admin on public.wallet_transactions for select to authenticated using (participant_id = auth.uid() or public.is_admin());
drop policy if exists wallet_transactions_admin_all on public.wallet_transactions;
create policy wallet_transactions_admin_all on public.wallet_transactions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Saques: participante solicita e consulta os próprios; processamento só pelo admin.
drop policy if exists withdrawals_read_owner_or_admin on public.withdrawals;
create policy withdrawals_read_owner_or_admin on public.withdrawals for select to authenticated using (participant_id = auth.uid() or public.is_admin());
drop policy if exists withdrawals_insert_self on public.withdrawals;
create policy withdrawals_insert_self on public.withdrawals for insert to authenticated with check (participant_id = auth.uid());
drop policy if exists withdrawals_admin_update on public.withdrawals;
create policy withdrawals_admin_update on public.withdrawals for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Auditoria: somente administradores.
drop policy if exists admin_logs_admin_all on public.admin_logs;
create policy admin_logs_admin_all on public.admin_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- IMPORTANTE: este schema é a fundação. Operações críticas (confirmar PIX, fechar grupo,
-- distribuir prêmio e reservar/confirmar saque) serão implementadas como RPC/Edge Functions
-- transacionais antes de qualquer uso com dinheiro real.
