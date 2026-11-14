create table if not exists public.group_prize_distributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  round_number integer not null check (round_number > 0),
  total_prize_cents bigint not null check (total_prize_cents >= 0),
  calculation jsonb not null,
  confirmed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(group_id, round_number)
);
alter table public.group_prize_distributions enable row level security;
drop policy if exists group_prize_distributions_admin_select on public.group_prize_distributions;
create policy group_prize_distributions_admin_select on public.group_prize_distributions
for select to authenticated using (public.is_admin());

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
  v_group public.groups%rowtype;
  v_registration_id uuid;
  v_paid_quotas integer;
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if p_round_number is null or p_round_number < 1
     or p_lotofacil_contest is null or p_lotofacil_contest < 1
     or p_lotomania_contest is null or p_lotomania_contest < 1
     or p_total_paid_cents is null or p_total_paid_cents <= 0 then
    raise exception 'Informe rodada, concursos e valor total válidos.';
  end if;

  select * into v_group from public.groups
  where code = upper(btrim(p_group_code)) for update;
  if not found then raise exception 'Grupo não encontrado.'; end if;
  if v_group.current_round <> p_round_number or v_group.status <> 'ready' then
    raise exception 'O grupo precisa estar completo e na rodada atual.';
  end if;

  select coalesce(sum(quota_count), 0)::integer into v_paid_quotas
  from public.quotas where group_id = v_group.id and status = 'paid';
  if v_paid_quotas <> v_group.capacity_quotas then
    raise exception 'Todas as cotas precisam estar pagas antes de registrar as apostas.';
  end if;
  if not exists (
    select 1 from public.game_sets
    where group_id = v_group.id and round_number = p_round_number and version_type = 'definitive'
  ) then
    raise exception 'Gere os jogos definitivos antes de registrar as apostas.';
  end if;

  insert into public.bet_registrations (
    group_id, round_number, lotofacil_contest, lotomania_contest,
    total_paid_cents, status, confirmed_by, confirmed_at
  ) values (
    v_group.id, p_round_number, p_lotofacil_contest, p_lotomania_contest,
    p_total_paid_cents, 'registered', v_admin_id, now()
  ) returning id into v_registration_id;

  update public.groups set status = 'active', updated_at = now() where id = v_group.id;
  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id, 'bet_registration_confirmed', 'bet_registration', v_registration_id,
    jsonb_build_object(
      'group_code', v_group.code,
      'round_number', p_round_number,
      'lotofacil_contest', p_lotofacil_contest,
      'lotomania_contest', p_lotomania_contest,
      'total_paid_cents', p_total_paid_cents
    )
  );
  return v_registration_id;
end;
$$;

create or replace function public.admin_calculate_group_prize(
  p_group_code text,
  p_round_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group public.groups%rowtype;
  v_registration public.bet_registrations%rowtype;
  v_lotofacil public.contests%rowtype;
  v_lotomania public.contests%rowtype;
  v_game_set_id uuid;
  v_game record;
  v_drawn_numbers integer[];
  v_prize_tiers jsonb;
  v_hits integer;
  v_prize_cents bigint;
  v_lotofacil_prize_cents bigint := 0;
  v_lotomania_prize_cents bigint := 0;
  v_total_prize_cents bigint := 0;
  v_paid_quota_count integer := 0;
  v_game_count integer;
  v_lotofacil_count integer;
  v_lotomania_count integer;
  v_winning_games jsonb := '[]'::jsonb;
  v_shares jsonb;
  v_remaining_cents bigint;
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if p_group_code is null or p_round_number is null or p_round_number < 1 then
    raise exception 'Grupo e rodada válidos são obrigatórios.';
  end if;

  select * into v_group from public.groups where code = upper(btrim(p_group_code));
  if not found then raise exception 'Grupo não encontrado.'; end if;

  select * into v_registration from public.bet_registrations
  where group_id = v_group.id and round_number = p_round_number and status = 'registered';
  if not found then raise exception 'A rodada ainda não tem registro oficial das apostas.'; end if;

  select id into v_game_set_id from public.game_sets
  where group_id = v_group.id and round_number = p_round_number and version_type = 'definitive'
  order by version_number desc limit 1;
  if not found then raise exception 'Jogos definitivos não encontrados para esta rodada.'; end if;

  select * into v_lotofacil from public.contests
  where modality = 'LOTOFACIL' and contest_number = v_registration.lotofacil_contest;
  if not found or jsonb_typeof(v_lotofacil.prize_tiers) is distinct from 'array'
     or jsonb_array_length(v_lotofacil.prize_tiers) = 0 then
    raise exception 'Resultado e rateio oficial da Lotofácil não estão sincronizados.';
  end if;
  select * into v_lotomania from public.contests
  where modality = 'LOTOMANIA' and contest_number = v_registration.lotomania_contest;
  if not found or jsonb_typeof(v_lotomania.prize_tiers) is distinct from 'array'
     or jsonb_array_length(v_lotomania.prize_tiers) = 0 then
    raise exception 'Resultado e rateio oficial da Lotomania não estão sincronizados.';
  end if;

  select count(*)::integer,
         count(*) filter (where modality = 'LOTOFACIL')::integer,
         count(*) filter (where modality = 'LOTOMANIA')::integer
  into v_game_count, v_lotofacil_count, v_lotomania_count
  from public.games where game_set_id = v_game_set_id;
  if v_game_count <> 30 or v_lotofacil_count <> 15 or v_lotomania_count <> 15 then
    raise exception 'O conjunto da rodada não contém os 30 jogos esperados.';
  end if;

  select coalesce(sum(quota_count), 0)::integer into v_paid_quota_count
  from public.quotas where group_id = v_group.id and status = 'paid';
  if v_paid_quota_count <> v_group.capacity_quotas then
    raise exception 'Todas as cotas do grupo precisam estar pagas para calcular o rateio.';
  end if;

  for v_game in
    select game_code, modality, numbers from public.games
    where game_set_id = v_game_set_id order by modality, game_code
  loop
    if v_game.modality = 'LOTOFACIL' then
      v_drawn_numbers := v_lotofacil.drawn_numbers;
      v_prize_tiers := v_lotofacil.prize_tiers;
    else
      v_drawn_numbers := v_lotomania.drawn_numbers;
      v_prize_tiers := v_lotomania.prize_tiers;
    end if;

    select count(*)::integer into v_hits
    from unnest(v_game.numbers) as selected(number)
    where selected.number = any(v_drawn_numbers);

    select (tier->>'prize_cents')::bigint into v_prize_cents
    from jsonb_array_elements(v_prize_tiers) as tiers(tier)
    where (tier->>'hits')::integer = v_hits
    limit 1;
    v_prize_cents := coalesce(v_prize_cents, 0);

    if v_game.modality = 'LOTOFACIL' then
      v_lotofacil_prize_cents := v_lotofacil_prize_cents + v_prize_cents;
    else
      v_lotomania_prize_cents := v_lotomania_prize_cents + v_prize_cents;
    end if;
    if v_prize_cents > 0 then
      v_winning_games := v_winning_games || jsonb_build_array(jsonb_build_object(
        'game_code', v_game.game_code,
        'modality', v_game.modality,
        'hits', v_hits,
        'prize_cents', v_prize_cents
      ));
    end if;
  end loop;

  v_total_prize_cents := v_lotofacil_prize_cents + v_lotomania_prize_cents;
  select v_total_prize_cents - coalesce(sum(
    floor(v_total_prize_cents::numeric * member_quotas.quota_count / v_paid_quota_count)::bigint
  ), 0) into v_remaining_cents
  from (
    select participant_id, sum(quota_count)::bigint as quota_count
    from public.quotas where group_id = v_group.id and status = 'paid'
    group by participant_id
  ) member_quotas;

  with member_quotas as (
    select participant_id, sum(quota_count)::bigint as quota_count
    from public.quotas where group_id = v_group.id and status = 'paid'
    group by participant_id
  ), raw_shares as (
    select participant_id, quota_count,
           floor(v_total_prize_cents::numeric * quota_count / v_paid_quota_count)::bigint as base_cents,
           mod(v_total_prize_cents::numeric * quota_count, v_paid_quota_count::numeric) as remainder
    from member_quotas
  ), ranked_shares as (
    select participant_id, quota_count, base_cents,
           row_number() over (order by remainder desc, participant_id) as share_rank
    from raw_shares
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'participant_id', ranked_shares.participant_id,
    'full_name', profiles.full_name,
    'quota_count', ranked_shares.quota_count,
    'amount_cents', ranked_shares.base_cents + case when ranked_shares.share_rank <= v_remaining_cents then 1 else 0 end
  ) order by ranked_shares.participant_id), '[]'::jsonb)
  into v_shares
  from ranked_shares
  join public.profiles on profiles.id = ranked_shares.participant_id;

  return jsonb_build_object(
    'group_code', v_group.code,
    'round_number', p_round_number,
    'lotofacil_contest', v_registration.lotofacil_contest,
    'lotomania_contest', v_registration.lotomania_contest,
    'lotofacil_prize_cents', v_lotofacil_prize_cents,
    'lotomania_prize_cents', v_lotomania_prize_cents,
    'total_prize_cents', v_total_prize_cents,
    'paid_quota_count', v_paid_quota_count,
    'winning_games', v_winning_games,
    'shares', v_shares
  );
end;
$$;

create or replace function public.admin_distribute_group_prize(
  p_group_code text,
  p_round_number integer,
  p_expected_calculation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_group public.groups%rowtype;
  v_calculation jsonb;
  v_distribution_id uuid;
  v_share jsonb;
  v_participant_id uuid;
  v_amount_cents bigint;
  v_total_prize_cents bigint;
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  select * into v_group from public.groups
  where code = upper(btrim(p_group_code)) for update;
  if not found then raise exception 'Grupo não encontrado.'; end if;
  if exists (
    select 1 from public.group_prize_distributions
    where group_id = v_group.id and round_number = p_round_number
  ) then
    raise exception 'O rateio desta rodada já foi confirmado.';
  end if;

  v_calculation := public.admin_calculate_group_prize(p_group_code, p_round_number);
  if v_calculation is distinct from p_expected_calculation then
    raise exception 'Os resultados ou as cotas mudaram desde a prévia. Calcule novamente antes de confirmar.';
  end if;
  v_total_prize_cents := (v_calculation->>'total_prize_cents')::bigint;

  insert into public.group_prize_distributions (
    group_id, round_number, total_prize_cents, calculation, confirmed_by
  ) values (
    v_group.id, p_round_number, v_total_prize_cents, v_calculation, v_admin_id
  ) returning id into v_distribution_id;

  for v_share in
    select value from jsonb_array_elements(v_calculation->'shares') as entries(value)
    order by (value->>'participant_id')::uuid
  loop
    v_participant_id := (v_share->>'participant_id')::uuid;
    v_amount_cents := (v_share->>'amount_cents')::bigint;
    if v_amount_cents > 0 then
      perform 1 from public.wallet_accounts
      where participant_id = v_participant_id for update;
      if not found then raise exception 'Carteira de participante não encontrada.'; end if;

      update public.wallet_accounts
      set balance_cents = balance_cents + v_amount_cents, updated_at = now()
      where participant_id = v_participant_id;

      insert into public.wallet_transactions (
        participant_id, group_id, transaction_type, amount_cents, description,
        idempotency_key, created_by
      ) values (
        v_participant_id, v_group.id, 'prize_credit', v_amount_cents,
        format('Rateio de prêmio %s · rodada %s', v_group.code, p_round_number),
        format('group-prize:%s:%s:%s', v_group.id, p_round_number, v_participant_id),
        v_admin_id
      );
    end if;
  end loop;

  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id, 'group_prize_distributed', 'group_prize_distribution', v_distribution_id,
    jsonb_build_object(
      'group_code', v_group.code,
      'round_number', p_round_number,
      'total_prize_cents', v_total_prize_cents,
      'shares', v_calculation->'shares'
    )
  );

  return v_calculation || jsonb_build_object('distribution_id', v_distribution_id);
end;
$$;

revoke all on function public.admin_calculate_group_prize(text, integer) from public, anon;
revoke all on function public.admin_distribute_group_prize(text, integer, jsonb) from public, anon;
grant execute on function public.admin_calculate_group_prize(text, integer) to authenticated;
grant execute on function public.admin_distribute_group_prize(text, integer, jsonb) to authenticated;