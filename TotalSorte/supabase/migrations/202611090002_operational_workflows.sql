-- Operational workflows for the TotalSorte client.
-- Money-moving changes are atomic and only available through authenticated RPCs.

insert into public.groups (code, title, modality, capacity_quotas, status)
values ('MIX-031', 'Grupo MIX Estrela', 'MIX', 10, 'open')
on conflict (code) do nothing;

insert into public.profiles (id, full_name, display_name, phone)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', 'Novo participante'),
  u.raw_user_meta_data->>'display_name',
  coalesce(u.phone, u.raw_user_meta_data->>'phone')
from auth.users u
on conflict (id) do nothing;

insert into public.wallet_accounts (participant_id)
select p.id from public.profiles p
on conflict (participant_id) do nothing;

alter table public.withdrawals
add column if not exists request_key uuid not null default gen_random_uuid();
create unique index if not exists withdrawals_request_key_idx on public.withdrawals(request_key);

drop policy if exists profiles_admin_all on public.profiles;
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
for select to authenticated using (public.is_admin());

drop policy if exists payments_admin_all on public.payments;
drop policy if exists payments_admin_select on public.payments;
create policy payments_admin_select on public.payments
for select to authenticated using (public.is_admin());

drop policy if exists quotas_admin_all on public.quotas;
drop policy if exists quotas_admin_select on public.quotas;
create policy quotas_admin_select on public.quotas
for select to authenticated using (public.is_admin());

drop policy if exists wallet_accounts_admin_all on public.wallet_accounts;
drop policy if exists wallet_transactions_admin_all on public.wallet_transactions;
drop policy if exists withdrawals_insert_self on public.withdrawals;
drop policy if exists withdrawals_admin_update on public.withdrawals;
drop policy if exists withdrawals_admin_select on public.withdrawals;
create policy withdrawals_admin_select on public.withdrawals
for select to authenticated using (public.is_admin());

drop policy if exists admin_logs_admin_all on public.admin_logs;
drop policy if exists admin_logs_admin_select on public.admin_logs;
create policy admin_logs_admin_select on public.admin_logs
for select to authenticated using (public.is_admin());

drop policy if exists bet_registrations_admin_all on public.bet_registrations;
drop policy if exists bet_registrations_admin_select on public.bet_registrations;
create policy bet_registrations_admin_select on public.bet_registrations
for select to authenticated using (public.is_admin());

create or replace function public.get_group_occupancy(p_group_code text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_occupancy integer;
begin
  if auth.uid() is null then
    raise exception 'Autenticação necessária.';
  end if;

  select coalesce(sum(q.quota_count), 0)::integer into v_occupancy
  from public.quotas q
  join public.groups g on g.id = q.group_id
  where g.code = p_group_code
    and q.status in ('pending', 'reserved', 'paid');

  if not exists (select 1 from public.groups where code = p_group_code) then
    raise exception 'Grupo não encontrado.';
  end if;

  return v_occupancy;
end;
$$;

create or replace function public.admin_create_group(
  p_code text,
  p_title text,
  p_capacity_quotas integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_group_id uuid;
  v_code text := upper(btrim(p_code));
  v_title text := btrim(p_title);
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if v_code is null or v_code !~ '^[A-Z0-9-]{3,20}$'
     or v_title is null or length(v_title) not between 3 and 100
     or p_capacity_quotas is null or p_capacity_quotas not between 1 and 10 then
    raise exception 'Informe código, nome e capacidade válidos (1 a 10 cotas).';
  end if;

  insert into public.groups (code, title, modality, capacity_quotas, status, created_by)
  values (v_code, v_title, 'MIX', p_capacity_quotas, 'open', v_admin_id)
  returning id into v_group_id;

  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id, 'group_created', 'group', v_group_id,
    jsonb_build_object('code', v_code, 'title', v_title, 'capacity_quotas', p_capacity_quotas)
  );
  return v_group_id;
end;
$$;

create or replace function public.request_quota_payment(
  p_group_code text,
  p_multiplier integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_group public.groups%rowtype;
  v_occupied integer;
  v_quota_id uuid;
begin
  if v_user_id is null then
    raise exception 'Autenticação necessária.';
  end if;
  if p_multiplier is null or p_multiplier not between 1 and 5 then
    raise exception 'Quantidade de cotas inválida.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and status = 'active'
  ) then
    raise exception 'Conta não está ativa.';
  end if;

  select * into v_group
  from public.groups
  where code = p_group_code
  for update;

  if not found or v_group.status not in ('open', 'awaiting_payment') then
    raise exception 'Grupo não está aceitando cotas.';
  end if;

  if exists (
    select 1 from public.quotas
    where group_id = v_group.id and participant_id = v_user_id
      and status in ('pending', 'reserved')
  ) then
    raise exception 'Você já possui uma reserva pendente neste grupo.';
  end if;

  select coalesce(sum(quota_count), 0) into v_occupied
  from public.quotas
  where group_id = v_group.id
    and status in ('pending', 'reserved', 'paid');

  if v_occupied + p_multiplier > v_group.capacity_quotas then
    raise exception 'Não há cotas suficientes disponíveis.';
  end if;

  insert into public.quotas (group_id, participant_id, multiplier, status)
  values (v_group.id, v_user_id, p_multiplier, 'reserved')
  returning id into v_quota_id;

  insert into public.payments (quota_id, group_id, participant_id, amount_cents)
  values (v_quota_id, v_group.id, v_user_id, p_multiplier * 1050);

  update public.groups
  set status = 'awaiting_payment', updated_at = now()
  where id = v_group.id and status = 'open';

  return v_quota_id;
end;
$$;

create or replace function public.admin_review_payment(
  p_payment_id uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_quota public.quotas%rowtype;
  v_admin_id uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if p_decision is null or p_decision not in ('confirmed', 'rejected') then
    raise exception 'Decisão inválida.';
  end if;
  if p_decision = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'Informe o motivo da recusa.';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found or v_payment.status not in ('pending', 'under_review') then
    raise exception 'Pagamento não está pendente.';
  end if;

  select * into v_quota
  from public.quotas
  where id = v_payment.quota_id
  for update;
  perform 1 from public.groups where id = v_payment.group_id for update;
  if not found then
    raise exception 'Grupo do pagamento não existe.';
  end if;

  update public.payments
  set status = p_decision,
      admin_note = nullif(btrim(p_reason), ''),
      confirmed_by = case when p_decision = 'confirmed' then v_admin_id else null end,
      confirmed_at = case when p_decision = 'confirmed' then now() else null end
  where id = v_payment.id;

  update public.quotas
  set status = case when p_decision = 'confirmed' then 'paid' else 'released' end,
      updated_at = now()
  where id = v_quota.id;

  if p_decision = 'confirmed' and (
    select coalesce(sum(quota_count), 0) from public.quotas
    where group_id = v_payment.group_id and status = 'paid'
  ) >= (
    select capacity_quotas from public.groups where id = v_payment.group_id
  ) then
    update public.groups set status = 'ready', updated_at = now()
    where id = v_payment.group_id;
  end if;

  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id,
    'payment_' || p_decision,
    'payment',
    v_payment.id,
    jsonb_build_object('quota_id', v_quota.id, 'reason', nullif(btrim(p_reason), ''))
  );
end;
$$;

drop function if exists public.request_withdrawal(bigint, text);

create or replace function public.request_withdrawal(
  p_amount_cents bigint,
  p_pix_key text,
  p_request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_wallet public.wallet_accounts%rowtype;
  v_withdrawal_id uuid;
  v_existing public.withdrawals%rowtype;
begin
  if v_user_id is null then
    raise exception 'Autenticação necessária.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0
     or nullif(btrim(p_pix_key), '') is null or length(btrim(p_pix_key)) > 200
     or p_request_key is null then
    raise exception 'Valor, chave PIX e chave de solicitação são obrigatórios.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and status = 'active'
  ) then
    raise exception 'Conta não está ativa.';
  end if;

  select * into v_existing from public.withdrawals
  where request_key = p_request_key;
  if found then
    if v_existing.participant_id <> v_user_id
       or v_existing.amount_cents <> p_amount_cents
       or v_existing.pix_key_snapshot <> btrim(p_pix_key) then
      raise exception 'Chave de solicitação já utilizada com outros dados.';
    end if;
    return v_existing.id;
  end if;

  select * into v_wallet
  from public.wallet_accounts
  where participant_id = v_user_id
  for update;

  if not found then
    raise exception 'Carteira do participante não existe.';
  end if;

  select * into v_existing from public.withdrawals
  where request_key = p_request_key for update;
  if found then
    if v_existing.participant_id <> v_user_id
       or v_existing.amount_cents <> p_amount_cents
       or v_existing.pix_key_snapshot <> btrim(p_pix_key) then
      raise exception 'Chave de solicitação já utilizada com outros dados.';
    end if;
    return v_existing.id;
  end if;

  if p_amount_cents > v_wallet.balance_cents - v_wallet.reserved_cents then
    raise exception 'Saldo disponível insuficiente.';
  end if;

  insert into public.withdrawals (participant_id, amount_cents, pix_key_snapshot, request_key)
  values (v_user_id, p_amount_cents, btrim(p_pix_key), p_request_key)
  returning id into v_withdrawal_id;

  update public.wallet_accounts
  set reserved_cents = reserved_cents + p_amount_cents, updated_at = now()
  where participant_id = v_user_id;

  insert into public.wallet_transactions (
    participant_id, withdrawal_id, transaction_type, amount_cents, description, created_by
  ) values (
    v_user_id, v_withdrawal_id, 'withdrawal_reserve', p_amount_cents,
    'Valor reservado para solicitação de saque', v_user_id
  );

  return v_withdrawal_id;
end;
$$;

create or replace function public.admin_process_withdrawal(
  p_withdrawal_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_withdrawal public.withdrawals%rowtype;
  v_admin_id uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if p_decision is null or p_decision not in ('paid', 'failed') then
    raise exception 'Decisão inválida.';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'Informe a referência da transferência ou o motivo da falha.';
  end if;

  select * into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id;

  if not found or v_withdrawal.status not in ('requested', 'processing') then
    raise exception 'Solicitação não está pendente.';
  end if;

  perform 1 from public.wallet_accounts
  where participant_id = v_withdrawal.participant_id
  for update;
  if not found then
    raise exception 'Carteira do participante não existe.';
  end if;

  select * into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found or v_withdrawal.status not in ('requested', 'processing') then
    raise exception 'Solicitação não está pendente.';
  end if;

  if p_decision = 'paid' then
    update public.wallet_accounts
    set balance_cents = balance_cents - v_withdrawal.amount_cents,
        reserved_cents = reserved_cents - v_withdrawal.amount_cents,
        updated_at = now()
    where participant_id = v_withdrawal.participant_id;

    insert into public.wallet_transactions (
      participant_id, withdrawal_id, transaction_type, amount_cents, description, created_by
    ) values (
      v_withdrawal.participant_id, v_withdrawal.id, 'withdrawal_paid',
      v_withdrawal.amount_cents, 'Saque pago pelo administrador', v_admin_id
    );
  else
    update public.wallet_accounts
    set reserved_cents = reserved_cents - v_withdrawal.amount_cents, updated_at = now()
    where participant_id = v_withdrawal.participant_id;

    insert into public.wallet_transactions (
      participant_id, withdrawal_id, transaction_type, amount_cents, description, created_by
    ) values (
      v_withdrawal.participant_id, v_withdrawal.id, 'withdrawal_release',
      v_withdrawal.amount_cents, 'Reserva de saque liberada', v_admin_id
    );
  end if;

  update public.withdrawals
  set status = p_decision, admin_note = nullif(btrim(p_note), ''),
      processed_by = v_admin_id, processed_at = now()
  where id = v_withdrawal.id;

  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id, 'withdrawal_' || p_decision, 'withdrawal', v_withdrawal.id,
    jsonb_build_object('amount_cents', v_withdrawal.amount_cents, 'note', nullif(btrim(p_note), ''))
  );
end;
$$;

create or replace function public.admin_credit_prize(
  p_participant_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_idempotency_key text,
  p_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_transaction_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or nullif(btrim(p_description), '') is null
     or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Valor, descrição e chave de idempotência são obrigatórios.';
  end if;

  perform 1 from public.wallet_accounts
  where participant_id = p_participant_id
  for update;
  if not found then
    raise exception 'Carteira do participante não existe.';
  end if;

  insert into public.wallet_transactions (
    participant_id, group_id, transaction_type, amount_cents, description,
    idempotency_key, created_by
  ) values (
    p_participant_id, p_group_id, 'prize_credit', p_amount_cents,
    btrim(p_description), btrim(p_idempotency_key), v_admin_id
  ) on conflict (idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id into v_transaction_id
    from public.wallet_transactions
    where idempotency_key = btrim(p_idempotency_key)
      and participant_id = p_participant_id
      and group_id is not distinct from p_group_id
      and amount_cents = p_amount_cents
      and description = btrim(p_description);
    if not found then
      raise exception 'Chave de idempotência já utilizada com outros dados.';
    end if;
    return v_transaction_id;
  end if;

  update public.wallet_accounts
  set balance_cents = balance_cents + p_amount_cents, updated_at = now()
  where participant_id = p_participant_id;

  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id, 'prize_credited', 'wallet_transaction', v_transaction_id,
    jsonb_build_object('participant_id', p_participant_id, 'amount_cents', p_amount_cents)
  );

  return v_transaction_id;
end;
$$;

create or replace function public.admin_record_bet_registration(
  p_group_code text,
  p_round_number integer,
  p_lotofacil_contest integer,
  p_lotomania_contest integer,
  p_total_paid_cents bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_group_id uuid;
  v_registration_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if p_round_number is null or p_round_number <= 0
     or p_lotofacil_contest is null or p_lotofacil_contest <= 0
     or p_lotomania_contest is null or p_lotomania_contest <= 0
     or p_total_paid_cents is null or p_total_paid_cents <= 0 then
    raise exception 'Informe rodada, concursos e valor total válidos.';
  end if;

  select id into v_group_id from public.groups
  where code = p_group_code for update;
  if not found then
    raise exception 'Grupo não encontrado.';
  end if;

  if not exists (
    select 1 from public.game_sets
    where group_id = v_group_id and round_number = p_round_number
      and version_type = 'definitive'
  ) then
    raise exception 'A rodada ainda não tem jogos definitivos registrados.';
  end if;

  insert into public.bet_registrations (
    group_id, round_number, lotofacil_contest, lotomania_contest,
    total_paid_cents, status, confirmed_by, confirmed_at
  ) values (
    v_group_id, p_round_number, p_lotofacil_contest, p_lotomania_contest,
    p_total_paid_cents, 'registered', v_admin_id, now()
  ) returning id into v_registration_id;

  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id, 'bet_registration_confirmed', 'bet_registration', v_registration_id,
    jsonb_build_object(
      'group_code', p_group_code,
      'round_number', p_round_number,
      'lotofacil_contest', p_lotofacil_contest,
      'lotomania_contest', p_lotomania_contest,
      'total_paid_cents', p_total_paid_cents
    )
  );

  return v_registration_id;
end;
$$;

revoke all on function public.get_group_occupancy(text) from public, anon;
revoke all on function public.admin_create_group(text, text, integer) from public, anon;
revoke all on function public.request_quota_payment(text, integer) from public, anon;
revoke all on function public.admin_review_payment(uuid, text, text) from public, anon;
revoke all on function public.request_withdrawal(bigint, text, uuid) from public, anon;
revoke all on function public.admin_process_withdrawal(uuid, text, text) from public, anon;
revoke all on function public.admin_credit_prize(uuid, bigint, text, text, uuid) from public, anon;
revoke all on function public.admin_record_bet_registration(text, integer, integer, integer, bigint) from public, anon;

grant execute on function public.get_group_occupancy(text) to authenticated;
grant execute on function public.admin_create_group(text, text, integer) to authenticated;
grant execute on function public.request_quota_payment(text, integer) to authenticated;
grant execute on function public.admin_review_payment(uuid, text, text) to authenticated;
grant execute on function public.request_withdrawal(bigint, text, uuid) to authenticated;
grant execute on function public.admin_process_withdrawal(uuid, text, text) to authenticated;
grant execute on function public.admin_credit_prize(uuid, bigint, text, text, uuid) to authenticated;
grant execute on function public.admin_record_bet_registration(text, integer, integer, integer, bigint) to authenticated;
