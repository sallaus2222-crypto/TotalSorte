const supabase = window.totalSorteSupabase;
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = cents => currency.format(Number(cents || 0) / 100);
const $ = selector => document.querySelector(selector);
const statusLabels = {
  open: "Aberto",
  awaiting_payment: "Aguardando pagamentos",
  ready: "Pronto para fechar",
  active: "Em andamento",
  paused: "Pausado",
  closed: "Encerrado",
  cancelled: "Cancelado"
};
let currentUser = null;
let currentProfile = null;
let groupRows = [];
let ownQuotas = [];
let wallet = null;
let adminPayments = [];
let adminWithdrawals = [];
let adminFilter = "all";
let selectedGroupCode = "MIX-031";
let adminContestHistoryReady = false;
let adminGameSets = [];
let adminBetRegistrations = [];
let adminPrizeDistributions = [];
let pendingGroupPrizeCalculation = null;

function notify(message) {
  if (typeof window.toast === "function") window.toast(message);
}

function publishContestStats(detail) {
  window.dispatchEvent(new CustomEvent("totalsorte:contests-updated", { detail }));
}

async function loadPublicContestStats() {
  if (!supabase) {
    publishContestStats({ error: "Configure a conexão Supabase para carregar resultados oficiais." });
    return;
  }
  const [lotofacil, lotomania] = await Promise.all([
    supabase.from("contests").select("modality, contest_number, draw_date, drawn_numbers, fetched_at")
      .eq("modality", "LOTOFACIL").order("contest_number", { ascending: false }).limit(15),
    supabase.from("contests").select("modality, contest_number, draw_date, drawn_numbers, fetched_at")
      .eq("modality", "LOTOMANIA").order("contest_number", { ascending: false }).limit(15)
  ]);
  if (lotofacil.error || lotomania.error) {
    publishContestStats({ error: "Não foi possível carregar resultados oficiais. Verifique a conexão e a migração de estatísticas." });
    return;
  }
  const rows = [...(lotofacil.data || []), ...(lotomania.data || [])];
  const fetchedAt = rows.reduce((latest, row) => !latest || row.fetched_at > latest ? row.fetched_at : latest, null);
  publishContestStats({
    lotofacil: lotofacil.data || [],
    lotomania: lotomania.data || [],
    fetchedAt
  });
}

window.addEventListener("totalsorte:stats-requested", () => {
  loadPublicContestStats().catch(error => {
    console.error("Falha ao carregar estatísticas oficiais.", error);
    publishContestStats({ error: "Falha ao carregar resultados oficiais." });
  });
});

window.setInterval(() => {
  if (document.visibilityState === "visible") {
    loadPublicContestStats().catch(error => {
      console.error("Falha ao atualizar estatísticas oficiais.", error);
    });
  }
}, 15 * 60 * 1000);

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function reportError(context, error) {
  console.error(`TotalSorte: ${context}`, error);
  notify(error?.message || `Não foi possível ${context}.`);
}

function setConnectionStatus(connected, message) {
  setText("#connectionStatus", message);
  setText("#walletConnectionState", connected ? "● CONECTADO" : "● NÃO CONECTADO");
  setText("#loginMessage", message);
}

function updateAccountAccess(signedIn) {
  const button = $("#accountAccessButton");
  if (!button) return;
  button.textContent = signedIn ? "Minha conta" : "Entrar";
  button.dataset.page = signedIn ? "profile" : "login";
}

function requireAccount() {
  if (!supabase) {
    notify("Supabase não configurado. Preencha js/supabase-config.js com a URL e a chave pública do projeto.");
    return false;
  }
  if (!currentUser) {
    window.showPage("login");
    notify("Entre na sua conta para continuar.");
    return false;
  }
  return true;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function idempotencyKey(namespace, fingerprint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `totalsorte:${namespace}:${hex}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  }
  return {
    value: key,
    clear: () => sessionStorage.removeItem(storageKey)
  };
}

function renderGroupCard(group, occupied, participantQuotas = []) {
  const article = makeElement("article", "group-card");
  const top = makeElement("div", "group-card-top");
  const status = makeElement("span", `status-pill ${group.status === "active" ? "status-green" : "status-amber"}`, statusLabels[group.status] || group.status);
  const code = makeElement("span", "group-code", group.code);
  top.append(status, code);
  article.append(top, makeElement("h3", "", group.title));
  article.append(makeElement("p", "muted", `${group.modality} · Rodada ${group.current_round}`));

  const progress = makeElement("div", "progress-track");
  const fill = makeElement("span");
  fill.style.width = `${Math.min(100, occupied / group.capacity_quotas * 100)}%`;
  progress.append(fill);
  article.append(progress);

  const meta = makeElement("div", "group-meta");
  meta.append(
    makeElement("span", "", `${occupied}/${group.capacity_quotas} cotas ocupadas`),
    makeElement("span", "", `${Math.max(0, group.capacity_quotas - occupied)} vagas`)
  );
  article.append(meta);

  const contribution = participantQuotas.reduce((sum, quota) => sum + Number(quota.total_amount_cents || 0), 0);
  if (participantQuotas.length) {
    const details = makeElement("div", "group-details");
    const amount = makeElement("div");
    amount.append(makeElement("small", "", "Minha contribuição"), makeElement("b", "", money(contribution)));
    const quotaStatus = makeElement("div");
    quotaStatus.append(makeElement("small", "", "Minha situação"), makeElement("b", "", participantQuotas.map(quota => quota.status).join(", ")));
    details.append(amount, quotaStatus);
    article.append(details);
  }

  const gameSet = (group.gameSets || []).find(set => Number(set.round_number) === Number(group.current_round));
  if (gameSet?.games?.length) {
    const preview = makeElement("details", "group-game-preview");
    preview.append(makeElement("summary", "", `Ver jogos desta rodada (${gameSet.games.length})`));
    const gameList = makeElement("div", "game-preview-scroll");
    for (const game of gameSet.games) {
      const card = makeElement("article", "generated-game");
      card.append(makeElement("div", "generated-game-top", `${game.modality === "LOTOFACIL" ? "Lotofácil" : "Lotomania"} · ${game.game_code}`));
      const numbers = makeElement("div", "generated-game-numbers");
      for (const number of game.numbers) numbers.append(makeElement("span", "", String(number).padStart(2, "0")));
      card.append(numbers);
      gameList.append(card);
    }
    preview.append(gameList);
    article.append(preview);
  }

  if (["open", "awaiting_payment"].includes(group.status) && occupied < group.capacity_quotas) {
    const button = makeElement("button", "primary-btn full", "Ver contribuição");
    button.type = "button";
    button.dataset.action = "contribute";
    button.dataset.groupCode = group.code;
    article.append(button);
  }
  return article;
}

function renderGroups() {
  const list = $("#groupsList");
  const homeList = $("#homeGroupsList");
  const mixGroup = groupRows.find(group => group.code === "MIX-031");
  const myMixQuotas = ownQuotas.filter(quota => quota.group_id === mixGroup?.id);

  if (list) {
    list.replaceChildren();
    if (!groupRows.length) list.append(makeElement("div", "empty-state", "Nenhum grupo disponível."));
    for (const group of groupRows) {
      list.append(renderGroupCard(group, group.occupied, ownQuotas.filter(quota => quota.group_id === group.id)));
    }
  }

  if (homeList) {
    homeList.replaceChildren();
    const participating = groupRows.filter(group => ownQuotas.some(quota => quota.group_id === group.id));
    if (!participating.length) homeList.append(makeElement("div", "empty-state", "Você ainda não participa de grupos."));
    for (const group of participating) {
      homeList.append(renderGroupCard(group, group.occupied, ownQuotas.filter(quota => quota.group_id === group.id)));
    }
  }

  if (mixGroup) {
    setText("#mix031QuotaCount", `${mixGroup.occupied}/${mixGroup.capacity_quotas}`);
    setText("#mix031GroupStatus", statusLabels[mixGroup.status] || mixGroup.status);
    setText("#quotaAvailability", `${Math.max(0, mixGroup.capacity_quotas - mixGroup.occupied)} de ${mixGroup.capacity_quotas}`);
    setText("#quotaGroupStatus", statusLabels[mixGroup.status] || mixGroup.status);
    setText("#mix031MyContribution", money(myMixQuotas.reduce((sum, quota) => sum + Number(quota.total_amount_cents || 0), 0)));
    setText("#mix031PaymentStatus", myMixQuotas.length ? myMixQuotas.map(quota => quota.status).join(", ") : "Não participante");
    const available = Math.max(0, mixGroup.capacity_quotas - mixGroup.occupied);
    document.querySelectorAll(".quota-option").forEach(button => {
      button.disabled = Number(button.dataset.multiplier) > available;
    });
    setText("#adminMix031Summary", `${mixGroup.occupied}/${mixGroup.capacity_quotas} cotas reservadas ou pagas · ${statusLabels[mixGroup.status] || mixGroup.status}`);
    const progress = $("#adminMix031Progress");
    if (progress) progress.style.width = `${Math.min(100, available === 0 ? 100 : mixGroup.occupied / mixGroup.capacity_quotas * 100)}%`;
  }
  updateGameGenerationButton();

  const selectedGroup = groupRows.find(group => group.code === selectedGroupCode);
  const pendingMixQuota = ownQuotas.find(quota => quota.group_id === selectedGroup?.id && ["pending", "reserved"].includes(quota.status));
  const paymentDetails = $("#pixPaymentDetails");
  if (paymentDetails) paymentDetails.hidden = !pendingMixQuota;
  const reserveButton = $("#createQuotaPayment");
  if (reserveButton) {
    reserveButton.disabled = Boolean(pendingMixQuota);
    reserveButton.textContent = pendingMixQuota ? "Reserva já registrada" : "Reservar cotas e iniciar pagamento";
  }
  if (pendingMixQuota) {
    const option = document.querySelector(`.quota-option[data-multiplier="${pendingMixQuota.multiplier}"]`);
    if (option) {
      document.querySelectorAll(".quota-option").forEach(button => button.classList.toggle("selected", button === option));
      window.renderPixPayment?.(Number(pendingMixQuota.multiplier));
    }
    setText("#quotaPaymentStatus", `Reserva pendente de ${pendingMixQuota.multiplier} cota(s). Faça o pagamento e aguarde a conferência administrativa.`);
  }
  updateSelectedGroup();

  setText("#homeGroupCount", String(new Set(ownQuotas.map(quota => quota.group_id)).size));
}

function updateSelectedGroup() {
  const group = groupRows.find(row => row.code === selectedGroupCode);
  if (!group) return;
  const available = Math.max(0, group.capacity_quotas - group.occupied);
  setText("#paymentGroupCode", group.code);
  setText("#quotaAvailability", `${available} de ${group.capacity_quotas}`);
  setText("#quotaGroupStatus", statusLabels[group.status] || group.status);
  document.querySelectorAll(".quota-option").forEach(button => {
    button.disabled = available < Number(button.dataset.multiplier) || !["open", "awaiting_payment"].includes(group.status);
  });
  const pending = ownQuotas.find(quota => quota.group_id === group.id && ["pending", "reserved"].includes(quota.status));
  const details = $("#pixPaymentDetails");
  if (details) details.hidden = !pending;
  const reserveButton = $("#createQuotaPayment");
  if (reserveButton) {
    reserveButton.disabled = Boolean(pending) || available < 1 || !["open", "awaiting_payment"].includes(group.status);
    reserveButton.textContent = pending ? "Reserva já registrada" : "Reservar cotas e iniciar pagamento";
  }
  if (pending) {
    const option = document.querySelector(`.quota-option[data-multiplier="${pending.multiplier}"]`);
    if (option) {
      document.querySelectorAll(".quota-option").forEach(button => button.classList.toggle("selected", button === option));
      window.renderPixPayment?.(Number(pending.multiplier));
    }
    setText("#quotaPaymentStatus", `Reserva pendente de ${pending.multiplier} cota(s). Faça o pagamento e aguarde a conferência administrativa.`);
  } else {
    setText("#quotaPaymentStatus", "Ao reservar, as cotas e o pagamento serão registrados no banco.");
  }
  window.setPaymentGroupCode?.(group.code);
}

async function loadGroups() {
  const { data: groups, error: groupsError } = await supabase
    .from("groups")
    .select("id, code, title, modality, capacity_quotas, status, current_round")
    .order("created_at", { ascending: false });
  if (groupsError) throw groupsError;

  const { data: quotas, error: quotasError } = await supabase
    .from("quotas")
    .select("id, group_id, multiplier, quota_count, total_amount_cents, status")
    .eq("participant_id", currentUser.id)
    .order("created_at", { ascending: false });
  if (quotasError) throw quotasError;

  ownQuotas = quotas || [];
  const groupIds = (groups || []).map(group => group.id);
  let gameSetRows = [];
  if (groupIds.length) {
    const { data, error } = await supabase.from("game_sets")
      .select("id, group_id, round_number, version_number, version_type")
      .in("group_id", groupIds)
      .eq("version_type", "definitive")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    gameSetRows = data || [];
  }
  const gameSetIds = gameSetRows.map(gameSet => gameSet.id);
  let gameRows = [];
  if (gameSetIds.length) {
    const { data, error } = await supabase.from("games")
      .select("id, game_set_id, game_code, modality, numbers")
      .in("game_set_id", gameSetIds)
      .order("game_code", { ascending: true });
    if (error) throw error;
    gameRows = data || [];
  }
  const gamesBySet = new Map();
  for (const game of gameRows) {
    const rows = gamesBySet.get(game.game_set_id) || [];
    rows.push(game);
    gamesBySet.set(game.game_set_id, rows);
  }
  const setsByGroup = new Map();
  for (const gameSet of gameSetRows) {
    const rows = setsByGroup.get(gameSet.group_id) || [];
    rows.push({ ...gameSet, games: gamesBySet.get(gameSet.id) || [] });
    setsByGroup.set(gameSet.group_id, rows);
  }
  groupRows = await Promise.all((groups || []).map(async group => {
    const { data: occupied, error } = await supabase.rpc("get_group_occupancy", { p_group_code: group.code });
    if (error) throw error;
    return { ...group, occupied: Number(occupied || 0), gameSets: setsByGroup.get(group.id) || [] };
  }));
  renderGroups();
}

function renderWithdrawals(rows, target, adminMode = false) {
  const list = $(target);
  if (!list) return;
  list.replaceChildren();
  if (!rows.length) {
    list.append(makeElement("div", "empty-state", "Nenhuma solicitação de saque."));
    return;
  }

  for (const row of rows) {
    const card = makeElement("article", "admin-pix-card");
    const heading = makeElement("div", "admin-pix-top");
    const summary = makeElement("div");
    summary.append(
      makeElement("span", "eyebrow", row.id.slice(0, 8).toUpperCase()),
      makeElement("h3", "", money(row.amount_cents))
    );
    const label = row.status === "paid" ? "Pago" : row.status === "failed" ? "Falhou" : row.status === "processing" ? "Em processamento" : "Solicitado";
    heading.append(summary, makeElement("span", `status-pill ${row.status === "paid" ? "status-green" : "status-amber"}`, label));
    card.append(heading);
    if (adminMode) {
      card.append(makeElement("p", "muted", `${row.full_name || "Participante"} · ${row.pix_key_snapshot}`));
    } else {
      card.append(makeElement("p", "muted", `Solicitado em ${new Date(row.created_at).toLocaleString("pt-BR")}`));
    }
    if (row.admin_note) card.append(makeElement("p", "muted", `Observação: ${row.admin_note}`));

    if (adminMode && ["requested", "processing"].includes(row.status)) {
      const actions = makeElement("div", "admin-actions");
      for (const [decision, labelText] of [["paid", "Confirmar pago"], ["failed", "Falha / liberar saldo"]]) {
        const button = makeElement("button", decision === "paid" ? "primary-btn" : "outline-btn", labelText);
        button.type = "button";
        button.dataset.withdrawalAction = decision;
        button.dataset.id = row.id;
        actions.append(button);
      }
      card.append(actions);
    }
    list.append(card);
  }
}

function renderTransactions(rows) {
  const target = $("#walletTransactions");
  const history = $("#activityHistory");
  if (!target || !history) return;
  target.replaceChildren();
  history.replaceChildren();
  if (!rows.length) {
    target.append(makeElement("div", "empty-state", "Nenhum lançamento."));
    history.append(makeElement("div", "empty-state", "Nenhum histórico disponível."));
    return;
  }

  let credits = 0;
  for (const row of rows) {
    const negative = ["withdrawal_paid", "withdrawal_reserve"].includes(row.transaction_type);
    const amount = `${negative ? "−" : "+"} ${money(row.amount_cents)}`;
    if (row.transaction_type === "prize_credit") credits += Number(row.amount_cents);
    const item = makeElement("div", "ledger-item");
    item.append(
      makeElement("div", "ledger-icon", row.transaction_type === "prize_credit" ? "✦" : "◈"),
      makeElement("div", "ledger-main", row.description),
      makeElement("strong", negative ? "" : "positive", amount)
    );
    const when = makeElement("small", "", new Date(row.created_at).toLocaleString("pt-BR"));
    item.querySelector(".ledger-main").append(when);
    target.append(item);

    const historyRow = makeElement("div", "report-row");
    historyRow.append(makeElement("span", "", row.description), makeElement("b", "", amount));
    history.append(historyRow);
  }
  setText("#walletReceivedBalance", money(credits));
}

async function loadWalletData() {
  const [{ data: walletData, error: walletError }, { data: transactions, error: transactionError }, { data: withdrawals, error: withdrawalsError }, { count: paymentCount, error: paymentCountError }] = await Promise.all([
    supabase.from("wallet_accounts").select("balance_cents, reserved_cents").eq("participant_id", currentUser.id).maybeSingle(),
    supabase.from("wallet_transactions").select("transaction_type, amount_cents, description, created_at").eq("participant_id", currentUser.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("withdrawals").select("id, amount_cents, pix_key_snapshot, status, admin_note, created_at").eq("participant_id", currentUser.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("participant_id", currentUser.id).eq("status", "confirmed")
  ]);
  if (walletError) throw walletError;
  if (transactionError) throw transactionError;
  if (withdrawalsError) throw withdrawalsError;
  if (paymentCountError) throw paymentCountError;

  wallet = walletData;
  const balance = Number(wallet?.balance_cents || 0);
  const reserved = Number(wallet?.reserved_cents || 0);
  availableBalance = Math.max(0, balance - reserved) / 100;
  setText("#homeBalance", money(balance - reserved));
  setText("#walletBalance", money(balance - reserved));
  setText("#homeReservedBalance", `Saldo reservado: ${money(reserved)}`);
  setText("#walletReservedBalance", money(reserved));
  setText("#homePrizeBalance", money(balance - reserved));
  setText("#homePaymentCount", String(paymentCount || 0));
  renderTransactions(transactions || []);
  renderWithdrawals(withdrawals || [], "#withdrawalList");
}

function filteredAdminPayments() {
  return adminPayments.filter(payment => {
    if (adminFilter === "pending") return ["pending", "under_review"].includes(payment.status);
    return adminFilter === "all" || payment.status === adminFilter;
  });
}

function renderAdminPayments() {
  const list = $("#adminPixList");
  if (!list) return;
  const rows = filteredAdminPayments();
  list.replaceChildren();
  if (!rows.length) list.append(makeElement("div", "empty-state", "Nenhum pagamento nesta categoria."));
  for (const payment of rows) {
    const card = makeElement("article", "admin-pix-card");
    const top = makeElement("div", "admin-pix-top");
    const identity = makeElement("div");
    identity.append(makeElement("span", "eyebrow", payment.id.slice(0, 8).toUpperCase()), makeElement("h3", "", payment.full_name || "Participante"));
    const label = payment.status === "confirmed" ? "Confirmado" : payment.status === "rejected" ? "Recusado" : "Aguardando";
    top.append(identity, makeElement("span", `status-pill ${payment.status === "confirmed" ? "status-green" : payment.status === "rejected" ? "status-red" : "status-amber"}`, label));
    card.append(top);
    card.append(makeElement("p", "muted", `${payment.group_code || "Grupo"} · ${payment.multiplier || 0} cotas · ${money(payment.amount_cents)}`));
    card.append(makeElement("small", "muted", new Date(payment.created_at).toLocaleString("pt-BR")));
    if (["pending", "under_review"].includes(payment.status)) {
      const actions = makeElement("div", "admin-actions");
      for (const [decision, title] of [["confirmed", "Confirmar PIX"], ["rejected", "Recusar e liberar cotas"]]) {
        const button = makeElement("button", decision === "confirmed" ? "primary-btn" : "outline-btn", title);
        button.type = "button";
        button.dataset.paymentAction = decision;
        button.dataset.id = payment.id;
        actions.append(button);
      }
      card.append(actions);
    }
    list.append(card);
  }
  const pending = adminPayments.filter(payment => ["pending", "under_review"].includes(payment.status)).length;
  setText("#adminPendingCount", String(pending).padStart(2, "0"));
  setText("#pixPendingBadge", `${pending} pendentes`);
}

function renderAdminContests(contests) {
  const list = $("#adminContestList");
  if (!list) return;
  list.replaceChildren();
  if (!contests.length) {
    adminContestHistoryReady = false;
    list.className = "empty-state";
    list.textContent = "Nenhum resultado oficial carregado.";
    setText("#adminContestStatus", "Resultados oficiais ainda não sincronizados.");
    updateGameGenerationButton();
    return;
  }

  adminContestHistoryReady = ["LOTOFACIL", "LOTOMANIA"].every(modality =>
    contests.filter(contest => contest.modality === modality).length === 15
  );
  list.className = "admin-contest-list";
  const labels = { LOTOFACIL: "Lotofácil", LOTOMANIA: "Lotomania" };
  const latestFetch = contests.reduce((latest, contest) =>
    !latest || contest.fetched_at > latest ? contest.fetched_at : latest, null);
  setText("#adminContestStatus", `Última sincronização: ${new Date(latestFetch).toLocaleString("pt-BR")}`);

  for (const modality of ["LOTOFACIL", "LOTOMANIA"]) {
    const rows = contests.filter(contest => contest.modality === modality);
    const section = makeElement("section", "admin-contest-modality");
    section.append(makeElement("h3", "", `${labels[modality]} · ${rows.length}/15 concursos`));
    for (const contest of rows) {
      const row = makeElement("div", "report-row");
      const date = contest.draw_date
        ? new Date(`${contest.draw_date}T00:00:00`).toLocaleDateString("pt-BR")
        : "Data indisponível";
      row.append(makeElement("b", "", `Concurso ${contest.contest_number} · ${date}`));
      row.append(makeElement("small", "muted", contest.drawn_numbers.map(number => String(number).padStart(2, "0")).join(", ")));
      section.append(row);
    }
    list.append(section);
  }
  updateGameGenerationButton();
}

function updateGameGenerationButton() {
  const button = $("#generateGroupGames");
  const createButton = $("#createGroupWithGamesButton");
  if (!button) return;
  if (createButton) {
    createButton.disabled = !adminContestHistoryReady;
    createButton.textContent = adminContestHistoryReady ? "Criar novo grupo com jogos" : "Sincronize os resultados primeiro";
  }
  const group = groupRows.find(row => row.code === $("#gameGenerationGroup")?.value);
  const canAcceptParticipants = ["open", "awaiting_payment", "ready"].includes(group?.status);
  const alreadyPublished = group && adminGameSets.some(gameSet =>
    gameSet.group_id === group.id && Number(gameSet.round_number) === Number(group.current_round) && gameSet.version_type === "definitive"
  );
  button.disabled = !canAcceptParticipants || !adminContestHistoryReady || Boolean(alreadyPublished);
  button.textContent = alreadyPublished
    ? "Jogos já publicados nesta rodada"
    : !group ? "Selecione um grupo"
      : !canAcceptParticipants ? "Grupo não aceita participantes"
        : adminContestHistoryReady ? "Gerar 30 jogos definitivos" : "Sincronize os resultados primeiro";
}

function renderGameGenerationGroups(groups) {
  const selector = $("#gameGenerationGroup");
  if (!selector) return;
  const previous = selector.value;
  const available = (groups || []).filter(group => ["open", "awaiting_payment", "ready"].includes(group.status));
  selector.replaceChildren();
  if (!available.length) {
    selector.add(new Option("Nenhum grupo aceita participantes", ""));
    updateGameGenerationButton();
    return;
  }
  for (const group of available) selector.add(new Option(`${group.code} · ${group.title}`, group.code));
  selector.value = available.some(group => group.code === previous)
    ? previous
    : available.find(group => group.code === "MIX-031")?.code || available[0].code;
  selector.onchange = updateGameGenerationButton;
  updateGameGenerationButton();
}

function renderOfficialRegistrationControls(groups) {
  const selector = $("#officialRegistrationGroup");
  const button = $("#confirmMixOfficialRegistration");
  if (!selector || !button) return;
  const previous = selector.value;
  const registeredKeys = new Set(adminBetRegistrations.map(row => `${row.group_id}:${row.round_number}`));
  const available = (groups || []).filter(group => group.status === "ready" &&
    adminGameSets.some(gameSet => gameSet.group_id === group.id && Number(gameSet.round_number) === Number(group.current_round)) &&
    !registeredKeys.has(`${group.id}:${group.current_round}`)
  );
  selector.replaceChildren();
  if (!available.length) {
    selector.add(new Option("Nenhum grupo pronto para registrar", ""));
    button.disabled = true;
    setText("#mixOfficialStatus", adminBetRegistrations.length ? "Apostas registradas" : "Aguardando grupo completo");
  } else {
    for (const group of available) {
      selector.add(new Option(`${group.code} · ${group.title} · rodada ${group.current_round}`, `${group.code}|${group.current_round}`));
    }
    selector.value = available.some(group => `${group.code}|${group.current_round}` === previous)
      ? previous
      : `${available[0].code}|${available[0].current_round}`;
    button.disabled = false;
    setText("#mixOfficialStatus", "Aguardando registro");
  }
  selector.onchange = () => setText("#mixOfficialStatus", "Aguardando registro");

  const groupById = new Map((groups || []).map(group => [group.id, group]));
  const history = $("#mixOfficialHistory");
  if (history) {
    history.replaceChildren();
    if (!adminBetRegistrations.length) {
      history.append(makeElement("small", "", "Nenhuma rodada registrada ainda."));
    } else {
      for (const registration of adminBetRegistrations) {
        const group = groupById.get(registration.group_id);
        const row = makeElement("div", "mix-official-history-row");
        row.append(makeElement("b", "", `${group?.code || "Grupo"} · rodada ${registration.round_number} · ${money(registration.total_paid_cents)}`));
        row.append(makeElement("span", "", `LF #${registration.lotofacil_contest} · LM #${registration.lotomania_contest}`));
        row.append(makeElement("small", "", `Confirmado em ${new Date(registration.confirmed_at).toLocaleString("pt-BR")}`));
        history.append(row);
      }
    }
  }
}

function renderPrizeDistributionControls(groups) {
  const selector = $("#prizeDistributionGroup");
  const calculateButton = $("#calculateGroupPrizeButton");
  const confirmButton = $("#confirmGroupPrizeButton");
  if (!selector || !calculateButton || !confirmButton) return;

  const previous = selector.value;
  pendingGroupPrizeCalculation = null;
  confirmButton.disabled = true;
  confirmButton.textContent = "Confirmar rateio e creditar saldos";
  const preview = $("#groupPrizePreview");
  preview.replaceChildren(makeElement("div", "empty-state", "Selecione uma rodada registrada para calcular."));
  setText("#groupPrizeStatus", "Nenhum rateio calculado.");
  const distributedKeys = new Set(adminPrizeDistributions.map(row => `${row.group_id}:${row.round_number}`));
  const available = adminBetRegistrations.filter(row => row.status === "registered" &&
    !distributedKeys.has(`${row.group_id}:${row.round_number}`)
  );
  const groupById = new Map((groups || []).map(group => [group.id, group]));
  selector.replaceChildren();
  if (!available.length) {
    selector.add(new Option("Nenhuma rodada aguardando rateio", ""));
    calculateButton.disabled = true;
  } else {
    for (const registration of available) {
      const group = groupById.get(registration.group_id);
      selector.add(new Option(`${group?.code || "Grupo"} · rodada ${registration.round_number}`, `${group?.code || ""}|${registration.round_number}`));
    }
    selector.value = available.some(row => `${groupById.get(row.group_id)?.code || ""}|${row.round_number}` === previous)
      ? previous
      : selector.options[0].value;
    calculateButton.disabled = false;
  }
  selector.onchange = () => {
    pendingGroupPrizeCalculation = null;
    confirmButton.disabled = true;
    confirmButton.textContent = "Confirmar rateio e creditar saldos";
    const preview = $("#groupPrizePreview");
    preview.replaceChildren(makeElement("div", "empty-state", "Calcule a prévia desta rodada."));
    setText("#groupPrizeStatus", "Nenhum rateio calculado.");
  };

  const history = $("#adminPrizeDistributionHistory");
  if (history) {
    history.replaceChildren();
    for (const distribution of adminPrizeDistributions) {
      const group = groupById.get(distribution.group_id);
      history.append(makeElement("div", "admin-audit-row", `${group?.code || "Grupo"} · rodada ${distribution.round_number} · ${money(distribution.total_prize_cents)} rateados em ${new Date(distribution.created_at).toLocaleString("pt-BR")}`));
    }
  }
}

function renderGroupPrizeCalculation(calculation) {
  const preview = $("#groupPrizePreview");
  preview.replaceChildren();
  const summary = makeElement("div", "admin-list-card");
  const details = makeElement("div");
  details.append(makeElement("b", "", `${calculation.group_code} · rodada ${calculation.round_number}`));
  details.append(makeElement("small", "", `Lotofácil #${calculation.lotofacil_contest}: ${money(calculation.lotofacil_prize_cents)} · Lotomania #${calculation.lotomania_contest}: ${money(calculation.lotomania_prize_cents)}`));
  details.append(makeElement("strong", "", `Total apurado: ${money(calculation.total_prize_cents)}`));
  summary.append(details);
  preview.append(summary);

  const wins = makeElement("section", "admin-list-card");
  const winDetails = makeElement("div");
  winDetails.append(makeElement("b", "", `Jogos premiados (${calculation.winning_games.length})`));
  if (!calculation.winning_games.length) {
    winDetails.append(makeElement("small", "", "Nenhum dos jogos atingiu uma faixa de prêmio."));
  } else {
    for (const game of calculation.winning_games) {
      winDetails.append(makeElement("small", "", `${game.game_code} · ${game.hits} acertos · ${money(game.prize_cents)}`));
    }
  }
  wins.append(winDetails);
  preview.append(wins);

  const shares = makeElement("section", "admin-list-card");
  const shareDetails = makeElement("div");
  shareDetails.append(makeElement("b", "", `Rateio proporcional (${calculation.paid_quota_count} cotas pagas)`));
  for (const share of calculation.shares) {
    shareDetails.append(makeElement("small", "", `${share.full_name} · ${share.quota_count} cotas · ${money(share.amount_cents)}`));
  }
  shares.append(shareDetails);
  preview.append(shares);
}

async function loadAdminData() {
  if (currentProfile?.role !== "admin") return;
  const [{ data: payments, error: paymentsError }, { data: withdrawals, error: withdrawalsError }, { data: profiles, error: profilesError }, { data: groups, error: groupsError }, { data: lotofacilContests, error: lotofacilContestsError }, { data: lotomaniaContests, error: lotomaniaContestsError }, { data: gameSets, error: gameSetsError }, { data: registrations, error: registrationsError }, { data: distributions, error: distributionsError }, { data: logs, error: logsError }] = await Promise.all([
    supabase.from("payments").select("id, quota_id, group_id, participant_id, amount_cents, status, created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("withdrawals").select("id, participant_id, amount_cents, pix_key_snapshot, status, admin_note, created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name, display_name, role, status").order("created_at", { ascending: false }).limit(500),
    supabase.from("groups").select("id, code, title, status, current_round").limit(500),
    supabase.from("contests").select("modality, contest_number, draw_date, drawn_numbers, fetched_at").eq("modality", "LOTOFACIL").order("contest_number", { ascending: false }).limit(15),
    supabase.from("contests").select("modality, contest_number, draw_date, drawn_numbers, fetched_at").eq("modality", "LOTOMANIA").order("contest_number", { ascending: false }).limit(15),
    supabase.from("game_sets").select("id, group_id, round_number, version_type").eq("version_type", "definitive").order("created_at", { ascending: false }).limit(500),
    supabase.from("bet_registrations").select("id, group_id, round_number, lotofacil_contest, lotomania_contest, total_paid_cents, status, confirmed_by, confirmed_at, created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("group_prize_distributions").select("id, group_id, round_number, total_prize_cents, created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("admin_logs").select("action, entity_type, details, created_at").order("created_at", { ascending: false }).limit(100)
  ]);
  if (paymentsError) throw paymentsError;
  if (withdrawalsError) throw withdrawalsError;
  if (profilesError) throw profilesError;
  if (groupsError) throw groupsError;
  if (lotofacilContestsError) throw lotofacilContestsError;
  if (lotomaniaContestsError) throw lotomaniaContestsError;
  if (gameSetsError) throw gameSetsError;
  if (registrationsError) throw registrationsError;
  if (distributionsError) throw distributionsError;
  if (logsError) throw logsError;
  adminGameSets = gameSets || [];
  adminBetRegistrations = registrations || [];
  adminPrizeDistributions = distributions || [];
  renderGameGenerationGroups(groups || []);
  renderAdminContests([...(lotofacilContests || []), ...(lotomaniaContests || [])]);
  renderOfficialRegistrationControls(groups || []);
  renderPrizeDistributionControls(groups || []);

  const paymentRows = payments || [];
  const participantIds = [...new Set(paymentRows.map(payment => payment.participant_id))];
  const quotaIds = [...new Set(paymentRows.map(payment => payment.quota_id))];
  const groupIds = [...new Set(paymentRows.map(payment => payment.group_id))];
  const [{ data: quotas, error: quotasError }, { data: paymentProfiles, error: paymentProfilesError }, { data: paymentGroups, error: paymentGroupsError }] = await Promise.all([
    quotaIds.length ? supabase.from("quotas").select("id, multiplier").in("id", quotaIds) : Promise.resolve({ data: [], error: null }),
    participantIds.length ? supabase.from("profiles").select("id, full_name").in("id", participantIds) : Promise.resolve({ data: [], error: null }),
    groupIds.length ? supabase.from("groups").select("id, code").in("id", groupIds) : Promise.resolve({ data: [], error: null })
  ]);
  if (quotasError) throw quotasError;
  if (paymentProfilesError) throw paymentProfilesError;
  if (paymentGroupsError) throw paymentGroupsError;
  const quotaById = new Map((quotas || []).map(row => [row.id, row]));
  const profileById = new Map((profiles || []).map(row => [row.id, row]));
  const groupById = new Map((paymentGroups || []).map(row => [row.id, row]));
  adminPayments = paymentRows.map(payment => ({
    ...payment,
    multiplier: quotaById.get(payment.quota_id)?.multiplier,
    full_name: profileById.get(payment.participant_id)?.full_name,
    group_code: groupById.get(payment.group_id)?.code
  }));
  adminWithdrawals = (withdrawals || []).map(row => ({
    ...row,
    full_name: profileById.get(row.participant_id)?.full_name
  }));
  renderAdminPayments();
  renderWithdrawals(adminWithdrawals, "#adminWithdrawalList", true);
  const auditList = $("#adminAuditList");
  if (auditList) {
    auditList.replaceChildren();
    if (!(logs || []).length) auditList.append(makeElement("div", "empty-state", "Nenhuma ação administrativa registrada."));
    for (const log of logs || []) {
      const description = log.details?.reason || log.details?.note || log.action.replaceAll("_", " ");
      auditList.append(makeElement("div", "admin-audit-row", `${new Date(log.created_at).toLocaleString("pt-BR")} · ${description}`));
    }
  }

  const clientList = $("#adminClientList");
  const selector = $("#prizeParticipant");
  if (clientList) clientList.replaceChildren();
  if (selector) selector.replaceChildren(new Option("Selecione", ""));
  for (const profile of profiles || []) {
    if (clientList) {
      const row = makeElement("article", "admin-list-card");
      row.append(
        makeElement("div", "", profile.full_name),
        makeElement("span", `status-pill ${profile.status === "active" ? "status-green" : "status-amber"}`, profile.status)
      );
      clientList.append(row);
    }
    if (selector && profile.role === "participant" && profile.status === "active") {
      selector.add(new Option(`${profile.display_name || profile.full_name} · ${profile.id.slice(0, 8)}`, profile.id));
    }
  }
  setText("#adminClientCount", String((profiles || []).length));
  setText("#adminGroupCount", String((groups || []).filter(group => ["active", "ready", "awaiting_payment"].includes(group.status)).length));
  setText("#adminWithdrawalCount", String((withdrawals || []).filter(row => ["requested", "processing"].includes(row.status)).length));
}

async function refreshSession() {
  if (!supabase) {
    updateAccountAccess(false);
    setConnectionStatus(false, "Supabase não configurado. Configure URL e chave pública antes de operar.");
    setText("#profileName", "Visitante");
    setText("#homeBalance", money(0));
    window.showPage("login");
    return;
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  currentUser = user;
  if (!currentUser) {
    currentProfile = null;
    updateAccountAccess(false);
    setConnectionStatus(true, "Supabase conectado. Entre ou crie sua conta.");
    setText("#profileName", "Visitante");
    setText("#profileRole", "Entre para acessar sua conta.");
    $("#logoutButton").hidden = true;
    window.showPage("login");
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, display_name, role, status, created_at")
    .eq("id", currentUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.status !== "active") {
    await supabase.auth.signOut();
    throw new Error("Perfil não encontrado ou conta desativada. Contate o administrador.");
  }
  currentProfile = profile;
  updateAccountAccess(true);
  const displayName = profile.display_name || profile.full_name;
  const initials = profile.full_name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  setText("#welcomeName", displayName);
  setText("#welcomeAvatar", initials);
  setText("#profileAvatar", initials);
  setText("#profileName", profile.full_name);
  setText("#profileRole", profile.role === "admin" ? "Administrador" : "Participante");
  setText("#profileCreated", `Membro desde ${new Date(profile.created_at).toLocaleDateString("pt-BR")}`);
  $("#logoutButton").hidden = false;
  setConnectionStatus(true, `Conectado como ${profile.role === "admin" ? "administrador" : "participante"}.`);
  await Promise.all([loadGroups(), loadWalletData(), loadAdminData()]);
  if (profile.role === "admin") {
    setText(".admin-status", "● Administrador autenticado");
  }
}

async function signUp(form) {
  const fullName = $("#registerName").value.trim();
  const displayName = $("#registerDisplay").value.trim();
  const email = $("#registerEmail").value.trim();
  const phone = $("#registerPhone").value.trim();
  const password = $("#registerPassword").value;
  if (password !== $("#registerPasswordConfirm").value) throw new Error("As senhas não conferem.");
  if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, display_name: displayName, phone } }
    });
    if (error) throw error;
    form.reset();
    if (data.session) {
      await refreshSession();
      window.showPage("home");
      notify("Conta criada.");
    } else {
      setText("#registerMessage", "Conta criada. Confirme seu e-mail antes de entrar.");
      window.showPage("login");
      notify("Conta criada. Verifique seu e-mail para confirmar o cadastro.");
    }
  } finally {
    submit.disabled = false;
  }
}

async function signIn(form) {
  const email = $("#loginUser").value.trim();
  const password = $("#loginPassword").value;
const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await refreshSession();
    window.showPage(currentProfile?.role === "admin" ? "admin" : "home");
    notify("Acesso autorizado.");
  } finally {
    submit.disabled = false;
  }
}

async function createQuotaPayment() {
  if (!requireAccount()) return;
  const group = groupRows.find(row => row.code === selectedGroupCode);
  if (!group) throw new Error(`Grupo ${selectedGroupCode} não está cadastrado no Supabase.`);
  const option = document.querySelector(".quota-option.selected");
  const multiplier = Number(option?.dataset.multiplier);
  if (!multiplier) throw new Error("Escolha a quantidade de cotas.");

  const existing = ownQuotas.find(quota => quota.group_id === group.id && ["pending", "reserved"].includes(quota.status));
  if (existing) {
    $("#pixPaymentDetails").hidden = false;
    window.renderPixPayment?.(Number(existing.multiplier));
    setText("#quotaPaymentStatus", `Você já tem uma reserva pendente de ${existing.multiplier} cota(s). Confira o PIX e aguarde a conferência administrativa.`);
    notify("Já existe uma solicitação pendente para este grupo.");
    return;
  }

  const button = $("#createQuotaPayment");
  button.disabled = true;
  try {
    const { data: quotaId, error } = await supabase.rpc("request_quota_payment", {
      p_group_code: selectedGroupCode,
      p_multiplier: multiplier
    });
    if (error) throw error;
    $("#pixPaymentDetails").hidden = false;
    window.renderPixPayment?.(multiplier);
    setText("#quotaPaymentStatus", `Reserva ${quotaId.slice(0, 8)} criada. Faça o PIX no valor exibido e aguarde a conferência manual.`);
    notify("Cotas reservadas. O pagamento aguarda conferência manual.");
    await Promise.all([loadGroups(), loadWalletData()]);
  } finally {
    button.disabled = Boolean(pendingGroupPrizeCalculation);
  }
}

async function reviewPayment(button) {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const decision = button.dataset.paymentAction;
  const reason = decision === "rejected" ? window.prompt("Informe o motivo da recusa:") : null;
  if (decision === "rejected" && !reason?.trim()) return;
  if (decision === "confirmed" && !window.confirm("Confirme somente após localizar e conferir o pagamento no extrato bancário.")) return;
  const { error } = await supabase.rpc("admin_review_payment", {
    p_payment_id: button.dataset.id,
    p_decision: decision,
    p_reason: reason?.trim() || null
  });
  if (error) throw error;
  notify(decision === "confirmed" ? "Pagamento confirmado." : "Pagamento recusado e cotas liberadas.");
  await Promise.all([loadGroups(), loadAdminData()]);
}

async function requestWithdrawal() {
  if (!requireAccount()) return;
  const amount = Number($("#withdrawAmount").value);
  const pixKey = $("#pixKey").value.trim();
  if (!Number.isFinite(amount) || amount <= 0 || !pixKey) throw new Error("Informe um valor válido e a chave PIX.");
  const cents = Math.round(amount * 100);
  const button = $("#withdrawSubmit");
  button.disabled = true;
  try {
    const request = await idempotencyKey("withdrawal", `${currentUser.id}:${cents}:${pixKey}`);
    const { error } = await supabase.rpc("request_withdrawal", {
      p_amount_cents: cents,
      p_pix_key: pixKey,
      p_request_key: request.value
    });
    if (error) throw error;
    request.clear();
    $("#withdrawAmount").value = "";
    $("#pixKey").value = "";
    $("#withdrawModal").classList.remove("open");
    notify("Solicitação registrada. O saldo foi reservado.");
    await loadWalletData();
  } finally {
    button.disabled = false;
  }
}

async function processWithdrawal(button) {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const decision = button.dataset.withdrawalAction;
  const note = window.prompt(decision === "paid" ? "Confirme a transferência e registre a referência:" : "Informe o motivo da falha:");
  if (!note?.trim()) return;
  if (decision === "paid" && !window.confirm("O PIX foi transferido e conferido no extrato bancário?")) return;
  const { error } = await supabase.rpc("admin_process_withdrawal", {
    p_withdrawal_id: button.dataset.id,
    p_decision: decision,
    p_note: note.trim()
  });
  if (error) throw error;
  notify(decision === "paid" ? "Saque marcado como pago." : "Saque marcado como falha; saldo liberado.");
  await Promise.all([loadWalletData(), loadAdminData()]);
}

async function creditPrize() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const participantId = $("#prizeParticipant").value;
  const amount = Number($("#prizeAmount").value);
  const description = $("#prizeDescription").value.trim();
  if (!participantId || !Number.isFinite(amount) || amount <= 0 || !description) {
    throw new Error("Selecione o participante e informe valor e referência.");
  }
  if (!window.confirm(`Creditar ${currency.format(amount)}? Confira participante e premiação antes de continuar.`)) return;
  const cents = Math.round(amount * 100);
  const request = await idempotencyKey("prize-credit", `${currentProfile.id}:${participantId}:${cents}:${description}`);
  const { error } = await supabase.rpc("admin_credit_prize", {
    p_participant_id: participantId,
    p_amount_cents: cents,
    p_description: description,
    p_idempotency_key: request.value,
    p_group_id: null
  });
  if (error) throw error;
  request.clear();
  $("#prizeAmount").value = "";
  $("#prizeDescription").value = "";
  notify("Premiação creditada e registrada na auditoria.");
  await Promise.all([loadWalletData(), loadAdminData()]);
}

async function createGroup() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const code = window.prompt("Código do grupo:", "MIX-032");
  if (code === null) return;
  const title = window.prompt("Nome do grupo:");
  if (title === null) return;
  const capacity = Number(window.prompt("Capacidade de cotas (1 a 10):", "10"));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10) {
    throw new Error("A capacidade deve ser um número inteiro entre 1 e 10.");
  }
  const { error } = await supabase.rpc("admin_create_group", {
    p_code: code,
    p_title: title,
    p_capacity_quotas: capacity
  });
  if (error) throw error;
  notify("Grupo criado e registrado na auditoria.");
  await Promise.all([loadGroups(), loadAdminData()]);
}

async function syncOfficialContests() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const button = $("#syncContestsButton");
  button.disabled = true;
  button.textContent = "Buscando resultados…";
  setText("#adminContestStatus", "Consultando e validando os resultados oficiais…");
  try {
    const { data, error } = await supabase.functions.invoke("sync-contests");
    if (error) throw error;
    await loadAdminData();
    notify(data?.message || "Resultados sincronizados.");
  } catch (error) {
    setText("#adminContestStatus", `Falha na sincronização: ${error.message || "erro desconhecido"}`);
    throw error;
  } finally {
    button.disabled = false;
    button.textContent = "Buscar últimos 15";
  }
}

async function generateMixGames() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const groupCode = $("#gameGenerationGroup").value;
  if (!groupCode) throw new Error("Selecione o grupo para gerar os jogos.");
  if (!window.confirm(`Gerar e publicar 30 jogos para ${groupCode} com base nos últimos 15 concursos de cada modalidade? Isso não registra apostas na CAIXA.`)) return;

  const button = $("#generateGroupGames");
  button.disabled = true;
  button.textContent = "Gerando jogos…";
  setText("#gameGenerationStatus", "Validando grupo, concursos e combinações…");
  try {
    const { data, error } = await supabase.functions.invoke("generate-group-games", { body: { groupCode } });
    if (error) throw error;
    setText("#gameGenerationStatus", data?.message || "Jogos salvos para esta rodada.");
    notify(data?.message || "Jogos definitivos gerados e salvos.");
    await Promise.all([loadGroups(), loadAdminData()]);
  } catch (error) {
    setText("#gameGenerationStatus", `Falha ao gerar jogos: ${error.message || "erro desconhecido"}`);
    throw error;
  } finally {
    updateGameGenerationButton();
  }
}

async function createGroupWithGames() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  if (!adminContestHistoryReady) throw new Error("Sincronize os últimos 15 concursos de cada modalidade antes de criar o grupo.");
  const code = window.prompt("Código do novo grupo (ex.: MIX-032):", "MIX-032");
  if (code === null) return;
  const title = window.prompt("Nome do grupo:");
  if (title === null) return;
  const capacity = Number(window.prompt("Capacidade de cotas (1 a 10):", "10"));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10 || title.trim().length < 3) {
    throw new Error("Informe nome e capacidade válidos (1 a 10 cotas).");
  }
  if (!window.confirm(`Criar ${code.trim().toUpperCase()} com 30 jogos gerados a partir dos últimos 15 concursos de cada modalidade?`)) return;

  const button = $("#createGroupWithGamesButton");
  button.disabled = true;
  button.textContent = "Criando grupo e jogos…";
  setText("#gameGenerationStatus", "Validando resultados e criando o grupo com seus jogos…");
  try {
    const { data, error } = await supabase.functions.invoke("generate-group-games", {
      body: { createGroup: true, code, title, capacityQuotas: capacity }
    });
    if (error) throw error;
    setText("#gameGenerationStatus", data?.message || "Grupo criado com jogos publicados.");
    notify(data?.message || "Grupo criado com jogos publicados.");
    await Promise.all([loadGroups(), loadAdminData()]);
  } catch (error) {
    setText("#gameGenerationStatus", `Falha ao criar grupo: ${error.message || "erro desconhecido"}`);
    throw error;
  } finally {
    updateGameGenerationButton();
  }
}

async function recordOfficialRegistration() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const [groupCode, roundValue] = $("#officialRegistrationGroup").value.split("|");
  const group = groupRows.find(row => row.code === groupCode && Number(row.current_round) === Number(roundValue));
  const lotofacilContest = Number($("#mixOfficialContestLf").value);
  const lotomaniaContest = Number($("#mixOfficialContestLm").value);
  const totalPaid = Number($("#mixOfficialPaidAmount").value);
  if (!group || !Number.isInteger(lotofacilContest) || lotofacilContest < 1 ||
      !Number.isInteger(lotomaniaContest) || lotomaniaContest < 1 ||
      !Number.isFinite(totalPaid) || totalPaid <= 0) {
    throw new Error("Informe o grupo, os dois concursos e o valor total efetivamente pago.");
  }
  if (!window.confirm(`Confirmar as apostas realizadas para ${groupCode}, rodada ${roundValue}? Confira os concursos e o valor pago antes de continuar.`)) return;

  const button = $("#confirmMixOfficialRegistration");
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("admin_record_bet_registration", {
      p_group_code: groupCode,
      p_round_number: Number(roundValue),
      p_lotofacil_contest: lotofacilContest,
      p_lotomania_contest: lotomaniaContest,
      p_total_paid_cents: Math.round(totalPaid * 100)
    });
    if (error) throw error;
    notify("Registro oficial salvo. O grupo foi fechado para novas participações nesta rodada.");
    await Promise.all([loadGroups(), loadAdminData()]);
  } finally {
    button.disabled = false;
  }
}

async function calculateGroupPrize() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  const [groupCode, roundValue] = $("#prizeDistributionGroup").value.split("|");
  const roundNumber = Number(roundValue);
  if (!groupCode || !Number.isInteger(roundNumber)) throw new Error("Selecione uma rodada registrada.");

  const button = $("#calculateGroupPrizeButton");
  button.disabled = true;
  setText("#groupPrizeStatus", "Calculando jogos e rateio proporcional…");
  try {
    const { data, error } = await supabase.rpc("admin_calculate_group_prize", {
      p_group_code: groupCode,
      p_round_number: roundNumber
    });
    if (error) throw error;
    pendingGroupPrizeCalculation = data;
    renderGroupPrizeCalculation(data);
    const zeroPrize = Number(data.total_prize_cents) === 0;
    const confirmButton = $("#confirmGroupPrizeButton");
    confirmButton.disabled = false;
    confirmButton.textContent = zeroPrize ? "Confirmar apuração sem créditos" : "Confirmar rateio e creditar saldos";
    setText("#groupPrizeStatus", zeroPrize
      ? "Nenhuma faixa premiada; a confirmação registrará a apuração sem alterar saldos."
      : "Confira os resultados e os valores individuais antes de confirmar.");
  } catch (error) {
    pendingGroupPrizeCalculation = null;
    $("#confirmGroupPrizeButton").disabled = true;
    setText("#groupPrizeStatus", `Não foi possível calcular: ${error.message || "erro desconhecido"}`);
    throw error;
  } finally {
    button.disabled = false;
  }
}

async function confirmGroupPrizeDistribution() {
  if (currentProfile?.role !== "admin") throw new Error("Ação restrita ao administrador.");
  if (!pendingGroupPrizeCalculation) throw new Error("Calcule a prévia antes de confirmar.");
  const calculation = pendingGroupPrizeCalculation;
  const total = money(calculation.total_prize_cents);
  if (!window.confirm(`Confirma o rateio de ${total} para ${calculation.group_code}, rodada ${calculation.round_number}? O valor será dividido proporcionalmente às cotas pagas e creditado nas carteiras.`)) return;

  const button = $("#confirmGroupPrizeButton");
  button.disabled = true;
  setText("#groupPrizeStatus", "Confirmando e creditando os saldos…");
  try {
    const { data, error } = await supabase.rpc("admin_distribute_group_prize", {
      p_group_code: calculation.group_code,
      p_round_number: calculation.round_number,
      p_expected_calculation: calculation
    });
    if (error) throw error;
    pendingGroupPrizeCalculation = null;
    setText("#groupPrizeStatus", `Rateio confirmado. Total creditado: ${money(data.total_prize_cents)}.`);
    notify("Rateio confirmado e registrado na auditoria.");
    await loadAdminData();
  } finally {
    button.disabled = !pendingGroupPrizeCalculation;
  }
}

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  currentUser = null;
  currentProfile = null;
  wallet = null;
  notify("Sessão encerrada.");
  await refreshSession();
}

document.addEventListener("submit", event => {
  if (!["loginForm", "registerForm"].includes(event.target.id)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!supabase) {
    notify("Supabase não configurado. Complete js/supabase-config.js.");
    return;
  }
  const operation = event.target.id === "loginForm" ? signIn(event.target) : signUp(event.target);
  operation.catch(error => reportError("autenticar a conta", error));
}, true);

document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const pageButton = target.closest("[data-page]");
  if (pageButton && ["wallet", "payment", "admin", "groups", "history"].includes(pageButton.dataset.page) && !currentUser) {
    event.preventDefault();
    event.stopImmediatePropagation();
    requireAccount();
    return;
  }
  if (pageButton?.dataset.page === "admin" && currentProfile?.role !== "admin") {
    event.preventDefault();
    event.stopImmediatePropagation();
    notify("O painel exige autenticação de administrador.");
    return;
  }

  const actionButton = target.closest("#logoutButton, #withdrawOpen, #homeWithdrawOpen, #createQuotaPayment, #withdrawSubmit, #creditPrizeButton, #createGroupButton, #syncContestsButton, #generateGroupGames, #createGroupWithGamesButton, #confirmMixOfficialRegistration, #calculateGroupPrizeButton, #confirmGroupPrizeButton, [data-payment-action], [data-withdrawal-action], [data-pix-filter], [data-action='contribute'], [data-admin-demo], #openAdminDemo, #demoCloseMixGroup, #demoNextMixContest");
  if (!actionButton) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (actionButton.matches("#demoCloseMixGroup, #demoNextMixContest")) {
    notify("Esta operação depende da integração de resultados e jogos no backend; permanece bloqueada para evitar registros locais fictícios.");
    return;
  }
  if (actionButton.matches("[data-admin-demo]")) {
    notify("Esta ação ainda precisa de uma operação administrativa transacional no backend.");
    return;
  }
  if (actionButton.matches("#withdrawOpen, #homeWithdrawOpen")) {
    if (!requireAccount()) return;
    window.openWithdraw?.();
    return;
  }
  if (actionButton.matches("#openAdminDemo")) {
    notify("O painel exige autenticação de administrador.");
    return;
  }
  if (actionButton.matches("[data-pix-filter]")) {
    adminFilter = actionButton.dataset.pixFilter;
    document.querySelectorAll("[data-pix-filter]").forEach(button => button.classList.toggle("active", button === actionButton));
    renderAdminPayments();
    return;
  }
  if (actionButton.matches("[data-action='contribute']")) {
    if (!requireAccount()) return;
    selectedGroupCode = actionButton.dataset.groupCode || "MIX-031";
    updateSelectedGroup();
    window.showPage("payment");
    return;
  }

  const operation = actionButton.matches("#logoutButton") ? logout()
    : actionButton.matches("#createQuotaPayment") ? createQuotaPayment()
    : actionButton.matches("#withdrawSubmit") ? requestWithdrawal()
    : actionButton.matches("#creditPrizeButton") ? creditPrize()
    : actionButton.matches("#createGroupButton") ? createGroup()
    : actionButton.matches("#syncContestsButton") ? syncOfficialContests()
    : actionButton.matches("#generateGroupGames") ? generateMixGames()
    : actionButton.matches("#createGroupWithGamesButton") ? createGroupWithGames()
    : actionButton.matches("#confirmMixOfficialRegistration") ? recordOfficialRegistration()
    : actionButton.matches("#calculateGroupPrizeButton") ? calculateGroupPrize()
    : actionButton.matches("#confirmGroupPrizeButton") ? confirmGroupPrizeDistribution()
    : actionButton.matches("[data-payment-action]") ? reviewPayment(actionButton)
    : processWithdrawal(actionButton);
  operation.catch(error => reportError("concluir a operação", error));
}, true);

if (supabase) {
  loadPublicContestStats().catch(error => {
    console.error("Falha ao carregar estatísticas oficiais.", error);
    publishContestStats({ error: "Falha ao carregar resultados oficiais." });
  });
  refreshSession().catch(error => reportError("carregar os dados da conta", error));
  supabase.auth.onAuthStateChange(() => {
    window.setTimeout(() => refreshSession().catch(error => reportError("atualizar a sessão", error)), 0);
  });
} else {
  publishContestStats({ error: "Configure a conexão Supabase para carregar resultados oficiais." });
  setConnectionStatus(false, "Supabase não configurado. Configure URL e chave pública antes de operar.");
  window.showPage("login");
}
