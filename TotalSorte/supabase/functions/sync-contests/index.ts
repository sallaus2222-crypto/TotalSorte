import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const modalities = [
  { code: "LOTOFACIL", endpoint: "lotofacil", count: 15, min: 1, max: 25 },
  { code: "LOTOMANIA", endpoint: "lotomania", count: 20, min: 0, max: 99 }
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function secretsMatch(expected: string, provided: string | null) {
  if (!provided || expected.length !== provided.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return difference === 0;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const brazilianDate = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilianDate) return `${brazilianDate[3]}-${brazilianDate[2]}-${brazilianDate[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function normalizeDraw(payload: Record<string, unknown>, modality: typeof modalities[number]) {
  const contestNumber = Number(payload.numero ?? payload.concurso);
  const rawNumbers = payload.listaDezenas ?? payload.dezenasSorteadasOrdemSorteio ?? payload.dezenas;
  if (!Number.isInteger(contestNumber) || contestNumber < 1 || !Array.isArray(rawNumbers)) {
    throw new Error(`Resposta inválida para ${modality.code}.`);
  }

  const drawnNumbers = rawNumbers.map(value => Number(String(value).replace(/\D/g, "")));
  if (drawnNumbers.length !== modality.count ||
      drawnNumbers.some(number => !Number.isInteger(number) || number < modality.min || number > modality.max) ||
      new Set(drawnNumbers).size !== modality.count) {
    throw new Error(`Dezenas inválidas no concurso ${contestNumber} de ${modality.code}.`);
  }

  if (!Array.isArray(payload.listaRateioPremio) || payload.listaRateioPremio.length === 0) {
    throw new Error(`Rateio oficial ausente no concurso ${contestNumber} de ${modality.code}.`);
  }
  const prizeTiers = payload.listaRateioPremio.map((tier: Record<string, unknown>) => {
    const description = String(tier.descricaoFaixa ?? "");
    const hitsMatch = description.match(/(\d+)\s*acertos/i);
    const hits = hitsMatch ? Number(hitsMatch[1]) : NaN;
    const winnerCount = Number(tier.numeroDeGanhadores);
    const prize = Number(tier.valorPremio);
    if (!Number.isInteger(hits) || hits < 0 || !Number.isInteger(winnerCount) || winnerCount < 0 ||
        !Number.isFinite(prize) || prize < 0 || !Number.isSafeInteger(Math.round(prize * 100))) {
      throw new Error(`Faixa de prêmio inválida no concurso ${contestNumber} de ${modality.code}.`);
    }
    return {
      hits,
      winner_count: winnerCount,
      prize_cents: Math.round(prize * 100),
      description
    };
  });

  return {
    contest_number: contestNumber,
    draw_date: normalizeDate(payload.dataApuracao ?? payload.data_apuracao),
    drawn_numbers: drawnNumbers,
    prize_tiers: prizeTiers
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`CAIXA respondeu HTTP ${response.status}.`);
  return response.json();
}

async function fetchLast15(modality: typeof modalities[number]) {
  const baseUrl = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${modality.endpoint}`;
  const latest = normalizeDraw(await fetchJson(baseUrl), modality);
  if (latest.contest_number < 15) throw new Error(`Histórico insuficiente para ${modality.code}.`);

  const previousNumbers = Array.from({ length: 14 }, (_, index) => latest.contest_number - index - 1);
  const previousDraws: ReturnType<typeof normalizeDraw>[] = [];
  for (let index = 0; index < previousNumbers.length; index += 5) {
    const batch = previousNumbers.slice(index, index + 5);
    const results = await Promise.all(batch.map(async contestNumber => {
      const draw = normalizeDraw(await fetchJson(`${baseUrl}/${contestNumber}`), modality);
      if (draw.contest_number !== contestNumber) {
        throw new Error(`A CAIXA retornou concurso inesperado para ${modality.code}.`);
      }
      return draw;
    }));
    previousDraws.push(...results);
  }

  return [latest, ...previousDraws].map(draw => ({
    modality: modality.code,
    ...draw,
    source: "CAIXA",
    fetched_at: new Date().toISOString()
  }));
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CONTEST_SYNC_SECRET");
  const scheduledRequest = Boolean(cronSecret && secretsMatch(cronSecret, request.headers.get("x-cron-secret")));
  if (!supabaseUrl || (!scheduledRequest && (!authorization || !anonKey))) {
    return jsonResponse({ error: "Sessão ou configuração do Supabase ausente." }, 401);
  }

  if (scheduledRequest && !serviceRoleKey) {
    return jsonResponse({ error: "A chave privada do Supabase não está configurada na função." }, 500);
  }

  const supabase = createClient(supabaseUrl, scheduledRequest ? serviceRoleKey! : anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(scheduledRequest ? {} : { global: { headers: { Authorization: authorization! } } })
  });

  if (!scheduledRequest) {
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
  }

  try {
    const rows = (await Promise.all(modalities.map(fetchLast15))).flat();
    const { error } = await supabase
      .from("contests")
      .upsert(rows, { onConflict: "modality,contest_number" });
    if (error) throw error;

    return jsonResponse({
      message: "Últimos 15 concursos sincronizados para cada modalidade.",
      totals: Object.fromEntries(modalities.map(modality => [
        modality.code,
        rows.filter(row => row.modality === modality.code).length
      ]))
    });
  } catch (error) {
    console.error("Falha ao sincronizar concursos oficiais.", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Falha ao sincronizar concursos." }, 502);
  }
});