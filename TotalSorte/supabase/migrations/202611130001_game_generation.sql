alter table public.contests
add column if not exists prize_tiers jsonb not null default '[]'::jsonb;

create or replace function public.admin_create_game_set(
  p_group_code text,
  p_round_number integer,
  p_games jsonb,
  p_contest_refs jsonb,
  p_group_title text default null,
  p_capacity_quotas integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_group public.groups%rowtype;
  v_game_set_id uuid;
  v_version_number integer;
  v_paid_quotas integer;
  v_expected_lotofacil jsonb;
  v_expected_lotomania jsonb;
  v_game jsonb;
  v_modality text;
  v_game_code text;
  v_numbers integer[];
  v_number_count integer;
  v_distinct_count integer;
  v_min integer;
  v_max integer;
  v_required_count integer;
  v_game_count integer;
  v_lotofacil_count integer;
  v_lotomania_count integer;
  v_unique_codes integer;
  v_group_code text;
  v_created_group boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Ação restrita ao administrador.';
  end if;
  if p_group_code is null or p_round_number is null
     or jsonb_typeof(p_games) is distinct from 'array'
     or jsonb_typeof(p_contest_refs) is distinct from 'object' then
    raise exception 'Dados de geração inválidos.';
  end if;

  v_group_code := upper(btrim(p_group_code));
  if p_group_title is not null or p_capacity_quotas is not null then
    if v_group_code !~ '^[A-Z0-9-]{3,20}$'
       or p_group_title is null or length(btrim(p_group_title)) not between 3 and 100
       or p_capacity_quotas is null or p_capacity_quotas not between 1 and 10
       or p_round_number <> 1 then
      raise exception 'Código, nome, capacidade e rodada inicial inválidos.';
    end if;
    if exists (select 1 from public.groups where code = v_group_code) then
      raise exception 'Já existe um grupo com este código.';
    end if;
    insert into public.groups (code, title, modality, capacity_quotas, status, current_round, created_by)
    values (v_group_code, btrim(p_group_title), 'MIX', p_capacity_quotas, 'open', 1, v_admin_id)
    returning * into v_group;
    v_created_group := true;
  else
    select * into v_group
    from public.groups
    where code = v_group_code
    for update;
    if not found then
      raise exception 'Grupo não encontrado.';
    end if;
  end if;
  if v_group.status not in ('open', 'awaiting_payment', 'ready')
     or p_round_number <> v_group.current_round then
    raise exception 'O grupo precisa aceitar participantes e estar na rodada atual.';
  end if;

  select coalesce(sum(quota_count), 0)::integer into v_paid_quotas
  from public.quotas
  where group_id = v_group.id and status = 'paid';
  if exists (
    select 1 from public.game_sets
    where group_id = v_group.id and round_number = p_round_number
      and version_type = 'definitive'
  ) then
    raise exception 'Já existem jogos definitivos para esta rodada.';
  end if;

  select jsonb_agg(contest_number order by contest_number desc)
  into v_expected_lotofacil
  from (
    select contest_number from public.contests
    where modality = 'LOTOFACIL'
    order by contest_number desc limit 15
  ) recent;
  select jsonb_agg(contest_number order by contest_number desc)
  into v_expected_lotomania
  from (
    select contest_number from public.contests
    where modality = 'LOTOMANIA'
    order by contest_number desc limit 15
  ) recent;

  if coalesce(jsonb_array_length(v_expected_lotofacil), 0) <> 15
     or coalesce(jsonb_array_length(v_expected_lotomania), 0) <> 15
     or p_contest_refs->'lotofacil' is distinct from v_expected_lotofacil
     or p_contest_refs->'lotomania' is distinct from v_expected_lotomania then
    raise exception 'Sincronize os últimos 15 concursos de cada modalidade antes de gerar.';
  end if;

  select
    count(*)::integer,
    count(*) filter (where value->>'modality' = 'LOTOFACIL')::integer,
    count(*) filter (where value->>'modality' = 'LOTOMANIA')::integer,
    count(distinct value->>'game_code')::integer
  into v_game_count, v_lotofacil_count, v_lotomania_count, v_unique_codes
  from jsonb_array_elements(p_games) as entries(value);
  if v_game_count <> 30 or v_lotofacil_count <> 15
     or v_lotomania_count <> 15 or v_unique_codes <> 30 then
    raise exception 'A geração precisa conter 15 jogos de cada modalidade com códigos únicos.';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from public.game_sets
  where group_id = v_group.id and round_number = p_round_number;

  insert into public.game_sets (
    group_id, round_number, version_number, version_type, source, contest_refs, created_by
  ) values (
    v_group.id, p_round_number, v_version_number, 'definitive',
    'CAIXA · últimos 15 concursos por modalidade', p_contest_refs, v_admin_id
  ) returning id into v_game_set_id;

  for v_game in select value from jsonb_array_elements(p_games) as entries(value)
  loop
    v_modality := v_game->>'modality';
    v_game_code := v_game->>'game_code';
    if v_modality = 'LOTOFACIL' then
      v_required_count := 15;
      v_min := 1;
      v_max := 25;
      if v_game_code !~ '^LF-[0-9]{2}$' then
        raise exception 'Código de jogo Lotofácil inválido.';
      end if;
    elsif v_modality = 'LOTOMANIA' then
      v_required_count := 50;
      v_min := 0;
      v_max := 99;
      if v_game_code !~ '^LM-[0-9]{2}$' then
        raise exception 'Código de jogo Lotomania inválido.';
      end if;
    else
      raise exception 'Modalidade de jogo inválida.';
    end if;

    if jsonb_typeof(v_game->'numbers') is distinct from 'array'
       or jsonb_array_length(v_game->'numbers') <> v_required_count then
      raise exception 'Quantidade de dezenas inválida no jogo %.', v_game_code;
    end if;

    select array_agg(number_text::integer order by ordinal), count(*)::integer
    into v_numbers, v_number_count
    from jsonb_array_elements_text(v_game->'numbers') with ordinality as entries(number_text, ordinal);
    select count(distinct number)::integer into v_distinct_count from unnest(v_numbers) as values(number);
    if v_number_count <> v_required_count or v_distinct_count <> v_required_count
       or exists (select 1 from unnest(v_numbers) as values(number) where number < v_min or number > v_max) then
      raise exception 'Dezenas inválidas no jogo %.', v_game_code;
    end if;

    insert into public.games (game_set_id, game_code, modality, numbers)
    values (v_game_set_id, v_game_code, v_modality, v_numbers);
  end loop;

  insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
  values (
    v_admin_id, 'game_set_generated', 'game_set', v_game_set_id,
    jsonb_build_object(
      'group_code', v_group.code,
      'round_number', p_round_number,
      'game_count', v_game_count,
      'contest_refs', p_contest_refs
    )
  );

  if v_created_group then
    insert into public.admin_logs (admin_id, action, entity_type, entity_id, details)
    values (
      v_admin_id, 'group_created_with_games', 'group', v_group.id,
      jsonb_build_object('code', v_group.code, 'title', v_group.title, 'capacity_quotas', v_group.capacity_quotas)
    );
  end if;

  return v_game_set_id;
end;
$$;

revoke all on function public.admin_create_game_set(text, integer, jsonb, jsonb, text, integer) from public, anon;
grant execute on function public.admin_create_game_set(text, integer, jsonb, jsonb, text, integer) to authenticated;

drop policy if exists game_sets_read_member_or_admin on public.game_sets;
create policy game_sets_read_member_or_admin on public.game_sets for select to authenticated using (
  public.is_admin()
  or (
    game_sets.version_type = 'definitive'
    and exists (
      select 1 from public.groups g
      where g.id = game_sets.group_id and g.status in ('open', 'awaiting_payment', 'ready')
    )
  )
  or exists (
    select 1 from public.quotas q
    where q.group_id = game_sets.group_id and q.participant_id = auth.uid() and q.status = 'paid'
  )
);

drop policy if exists games_read_member_or_admin on public.games;
create policy games_read_member_or_admin on public.games for select to authenticated using (
  public.is_admin()
  or exists (
    select 1
    from public.game_sets gs
    join public.groups g on g.id = gs.group_id
    where gs.id = games.game_set_id
      and (
        (gs.version_type = 'definitive' and g.status in ('open', 'awaiting_payment', 'ready'))
        or exists (
          select 1 from public.quotas q
          where q.group_id = gs.group_id and q.participant_id = auth.uid() and q.status = 'paid'
        )
      )
  )
);