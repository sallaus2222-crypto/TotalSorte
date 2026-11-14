import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const gameRules = [
  {
    code: "LOTOFACIL",
    prefix: "LF",
    picks: 15,
    min: 1,
    max: 25,
    ranges: [[1, 8], [9, 17], [18, 25]]
  },
  {
    code: "LOTOMANIA",
    prefix: "LM",
    picks: 50,
    min: 0,
    max: 99,
    ranges: [[0, 24], [25, 49], [50, 74], [75, 99]]
  }
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function validateDraws(rows: any[], rule: typeof gameRules[number]) {
  if (rows.length !== 15) throw new Error(`Sincronize 15 concursos de ${rule.code}.`);
  for (const row of rows) {
    const numbers = row.drawn_numbers;
    if (!Array.isArray(numbers) || numbers.length !== rule.picks ||
        numbers.some((number: number) => !Number.isInteger(number) || number < rule.min || number > rule.max) ||
        new Set(numbers).size !== rule.picks) {
      throw new Error(`Dados inválidos no concurso ${row.contest_number} de ${rule.code}.`);
    }
  }
}

function buildWeights(draws: any[], rule: typeof gameRules[number]) {
  const frequency = Array(rule.max - rule.min + 1).fill(0);
  draws.forEach((draw, index) => {
    const recency = (draws.length - index) / draws.length;
    draw.drawn_numbers.forEach((number: number) => {
      frequency[number - rule.min] += recency;
    });
  });
  const maximum = Math.max(1, ...frequency);
  return frequency.map(count => 0.8 + (count / maximum) * 1.2);
}

function pickWeighted(pool: number[], weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let point = Math.random() * total;
  for (let index = 0; index < pool.length; index += 1) {
    point -= weights[index];
    if (point <= 0) return pool[index];
  }
  return pool[pool.length - 1];
}

function generateGame(rule: typeof gameRules[number], weights: number[], exposure: number[], seen: Set<string>) {
  const pool = Array.from({ length: rule.max - rule.min + 1 }, (_, index) => index + rule.min);
  let bestNumbers: number[] | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const remaining = pool.slice();
    const selected: number[] = [];
    while (selected.length < rule.picks) {
      const localWeights = remaining.map(number =>
        weights[number - rule.min] / (1 + exposure[number - rule.min] * 0.45)
      );
      const chosen = pickWeighted(remaining, localWeights);
      selected.push(chosen);
      remaining.splice(remaining.indexOf(chosen), 1);
    }
    selected.sort((left, right) => left - right);
    const key = selected.join(",");
    if (seen.has(key)) continue;

    const oddCount = selected.filter(number => number % 2 !== 0).length;
    const parityPenalty = Math.abs(oddCount - rule.picks / 2);
    const targetPerRange = rule.picks / rule.ranges.length;
    const rangePenalty = rule.ranges.reduce((total, [min, max]) =>
      total + Math.abs(selected.filter(number => number >= min && number <= max).length - targetPerRange), 0);
    const exposurePenalty = selected.reduce((total, number) => total + exposure[number - rule.min], 0);
    const frequencyScore = selected.reduce((total, number) => total + weights[number - rule.min], 0);
    const score = frequencyScore - parityPenalty * 0.45 - rangePenalty * 0.2 - exposurePenalty * 0.7;
    if (score > bestScore) {
      bestScore = score;
      bestNumbers = selected;
    }
  }

  if (!bestNumbers) throw new Error(`Não foi possível gerar uma combinação única para ${rule.code}.`);
  seen.add(bestNumbers.join(","));
  bestNumbers.forEach(number => { exposure[number - rule.min] += 1; });
  return bestNumbers;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: "Sessão ou configuração do Supabase ausente." }, 401);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } }
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "Autenticação necessária." }, 401);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "admin" || profile.status !== "active") {
    return jsonResponse({ error: "Ação restrita ao administrador ativo." }, 403);
  }

  try {
    const body = await request.json();
    const createGroup = body?.createGroup === true;
    const groupCode = (createGroup ? body?.code : body?.groupCode);
    const normalizedCode = typeof groupCode === "string" ? groupCode.trim().toUpperCase() : "";
    if (!/^[A-Z0-9-]{3,20}$/.test(normalizedCode)) {
      throw new Error("Selecione um grupo válido.");
    }
    let group: { code: string; current_round: number; status: string } | null;
    let groupTitle: string | null = null;
    let capacityQuotas: number | null = null;
    if (createGroup) {
      groupTitle = typeof body?.title === "string" ? body.title.trim() : "";
      capacityQuotas = Number(body?.capacityQuotas);
      if (groupTitle.length < 3 || groupTitle.length > 100 ||
          !Number.isInteger(capacityQuotas) || capacityQuotas < 1 || capacityQuotas > 10) {
        throw new Error("Informe nome e capacidade válidos (1 a 10 cotas).");
      }
      group = { code: normalizedCode, current_round: 1, status: "open" };
    } else {
      const { data, error } = await supabase
        .from("groups")
        .select("code, current_round, status")
        .eq("code", normalizedCode)
        .maybeSingle();
      if (error) throw error;
      group = data;
    }
    if (!group || !["open", "awaiting_payment", "ready"].includes(group.status)) {
      throw new Error("O grupo selecionado não está aceitando participantes.");
    }

    const drawsByModality = await Promise.all(gameRules.map(async rule => {
      const { data, error } = await supabase
        .from("contests")
        .select("contest_number, drawn_numbers")
        .eq("modality", rule.code)
        .order("contest_number", { ascending: false })
        .limit(15);
      if (error) throw error;
      const rows = data || [];
      validateDraws(rows, rule);
      return [rule.code, rows] as const;
    }));
    const draws = Object.fromEntries(drawsByModality);

    const games = [];
    for (const rule of gameRules) {
      const history = draws[rule.code];
      const weights = buildWeights(history, rule);
      const exposure = Array(rule.max - rule.min + 1).fill(0);
      const seen = new Set<string>();
      for (let index = 1; index <= 15; index += 1) {
        games.push({
          game_code: `${rule.prefix}-${String(index).padStart(2, "0")}`,
          modality: rule.code,
          numbers: generateGame(rule, weights, exposure, seen)
        });
      }
    }

    const contestRefs = {
      lotofacil: draws.LOTOFACIL.map((draw: any) => draw.contest_number),
      lotomania: draws.LOTOMANIA.map((draw: any) => draw.contest_number)
    };
    const rpcParams: Record<string, unknown> = {
      p_group_code: normalizedCode,
      p_round_number: group.current_round,
      p_games: games,
      p_contest_refs: contestRefs
    };
    if (createGroup) {
      rpcParams.p_group_title = groupTitle;
      rpcParams.p_capacity_quotas = capacityQuotas;
    }
    const { data: gameSetId, error: saveError } = await supabase.rpc("admin_create_game_set", rpcParams);
    if (saveError) throw saveError;

    return jsonResponse({
      gameSetId,
      groupCode: normalizedCode,
      round: group.current_round,
      gameCount: games.length,
      message: createGroup
        ? `Grupo ${normalizedCode} criado com 30 jogos publicados. A geração não prevê resultados nem aumenta as chances matemáticas de prêmio.`
        : `30 jogos gerados e salvos para ${normalizedCode}. A geração não prevê resultados nem aumenta as chances matemáticas de prêmio.`
    });
  } catch (error) {
    console.error("Falha ao gerar jogos do grupo.", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Falha ao gerar jogos." }, 422);
  }
});