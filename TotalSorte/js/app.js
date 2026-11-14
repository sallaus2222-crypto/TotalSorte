const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let availableBalance = 0;
let deferredInstallPrompt = null;
const pages = ["home","stats","groups","payment","results","profile","wallet","history","settings","help","login","register","admin"];

function showPage(name){
  if(!pages.includes(name)) return;
  $$(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  document.body.classList.remove("drawer-open");
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="stats")window.dispatchEvent(new CustomEvent("totalsorte:stats-requested"));
}
function toast(message){
  const el=$("#toast"); el.textContent=message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2800);
}
$$("[data-page]").forEach(btn=>btn.addEventListener("click",()=>showPage(btn.dataset.page)));
$("#menuOpen").addEventListener("click",()=>document.body.classList.add("drawer-open"));
$("#menuClose").addEventListener("click",()=>document.body.classList.remove("drawer-open"));
$("#drawerBackdrop").addEventListener("click",()=>document.body.classList.remove("drawer-open"));
$("#notifyBtn").addEventListener("click",()=>toast("Você está em uma versão de demonstração."));

const contestStats = {lotofacil:[],lotomania:[]};
let activeLottery = "lotofacil";
function renderFrequency(lottery=activeLottery){
 activeLottery=lottery;
 const draws=contestStats[lottery]||[];
 const list=$("#frequencyList");
 const history=$("#contestHistoryList");
 const parity=$("#statsParity");
 const repetition=$("#statsRepeat");
 if(!draws.length){
  list.replaceChildren(Object.assign(document.createElement("div"),{className:"empty-state",textContent:"Estatísticas oficiais ainda não foram carregadas."}));
  history.replaceChildren(Object.assign(document.createElement("div"),{className:"empty-state",textContent:"Aguardando resultados oficiais."}));
  parity.textContent="Aguardando resultados oficiais.";
  repetition.textContent="Aguardando resultados oficiais.";
  return;
 }

 const minimum=lottery==="lotofacil"?1:0;
 const maximum=lottery==="lotofacil"?25:99;
 const frequency=Array(maximum-minimum+1).fill(0);
 let oddCount=0;
 for(const draw of draws){
  for(const number of draw.drawn_numbers){
   frequency[number-minimum]+=1;
   if(number%2!==0)oddCount+=1;
  }
 }
 const topNumbers=frequency.map((count,index)=>({number:index+minimum,count}))
  .sort((left,right)=>right.count-left.count||left.number-right.number).slice(0,10);
 const maxFrequency=Math.max(1,...topNumbers.map(item=>item.count));
 list.replaceChildren();
 for(const item of topNumbers){
  const row=document.createElement("div");row.className="freq-row";
  const number=document.createElement("span");number.className="freq-number";number.textContent=String(item.number).padStart(2,"0");
  const track=document.createElement("div");track.className="freq-track";
  const fill=document.createElement("span");fill.style.width=`${item.count/maxFrequency*100}%`;track.append(fill);
  const count=document.createElement("span");count.className="freq-count";count.textContent=String(item.count);
  row.append(number,track,count);list.append(row);
 }

 const totalNumbers=draws.reduce((sum,draw)=>sum+draw.drawn_numbers.length,0);
 parity.textContent=`Ímpares: ${oddCount} · Pares: ${totalNumbers-oddCount} · ${draws.length} concursos`;
 if(draws.length>1){
  const previous=new Set(draws[1].drawn_numbers);
  const repeated=draws[0].drawn_numbers.filter(number=>previous.has(number)).length;
  repetition.textContent=`${repeated} dezenas repetidas entre os concursos ${draws[0].contest_number} e ${draws[1].contest_number}.`;
 }else repetition.textContent="Aguardando o concurso anterior.";

 history.replaceChildren();
 for(const draw of draws){
  const article=document.createElement("article");article.className="contest-history-item";
  const heading=document.createElement("div");heading.className="contest-history-heading";
  const date=draw.draw_date?new Date(`${draw.draw_date}T00:00:00`).toLocaleDateString("pt-BR"):"Data indisponível";
  const label=document.createElement("b");label.textContent=`Concurso ${draw.contest_number} · ${date}`;
  heading.append(label);
  const numbers=document.createElement("div");numbers.className="contest-history-numbers";
  for(const value of draw.drawn_numbers){
   const ball=document.createElement("span");ball.className="ball";ball.textContent=String(value).padStart(2,"0");numbers.append(ball);
  }
  article.append(heading,numbers);history.append(article);
 }
}
$$("[data-lottery]").forEach(btn=>btn.addEventListener("click",()=>{
 $$('[data-lottery]').forEach(b=>b.classList.toggle("selected",b===btn));
 renderFrequency(btn.dataset.lottery);
}));
renderFrequency();
window.addEventListener("totalsorte:contests-updated",event=>{
 const detail=event.detail||{};
 if(detail.error){$("#statsRefreshStatus").textContent=detail.error;return;}
 contestStats.lotofacil=detail.lotofacil||[];
 contestStats.lotomania=detail.lotomania||[];
 const refreshedAt=detail.fetchedAt?new Date(detail.fetchedAt).toLocaleString("pt-BR"):"agora";
 $("#statsRefreshStatus").textContent=`Dados salvos no Supabase · última atualização ${refreshedAt}`;
 renderFrequency(activeLottery);
});
$("#refreshStatsButton").addEventListener("click",()=>window.dispatchEvent(new CustomEvent("totalsorte:stats-requested")));
function renderBalls(id, nums){$(id).innerHTML=nums.map(n=>`<span class="ball">${String(n).padStart(2,"0")}</span>`).join("");}

function openWithdraw(){ $("#availableAmount").textContent=currency(availableBalance); $("#withdrawModal").classList.add("open"); }
function closeWithdraw(){ $("#withdrawModal").classList.remove("open"); }
function currency(v){return v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
$("#withdrawOpen").addEventListener("click",openWithdraw);
$("#withdrawClose").addEventListener("click",closeWithdraw);
$("#withdrawModal").addEventListener("click",e=>{if(e.target.id==="withdrawModal")closeWithdraw();});
const caixaTestNumbers=new Set();
const caixaTestGrid=$("#caixaTestNumberGrid");
const caixaTestPayload=$("#caixaTestPayload");
function renderCaixaTestSelection(){
 const numbers=[...caixaTestNumbers].sort((a,b)=>a-b);
 caixaTestPayload.value=numbers.map(number=>String(number).padStart(2,"0")).join(", ");
 $("#caixaTestSelectionCount").textContent=`${numbers.length} de 15 dezenas`;
 $("#caixaTestSelectionStatus").textContent=numbers.length===15?"Pronto para copiar":numbers.length>15?"Remova uma dezena":"Selecione 15";
 $("#copyCaixaTestGame").disabled=numbers.length!==15;
 $$("#caixaTestNumberGrid button").forEach(button=>{
  button.classList.toggle("selected",caixaTestNumbers.has(Number(button.dataset.number)));
  button.disabled=numbers.length===15&&!caixaTestNumbers.has(Number(button.dataset.number));
 });
}
for(let number=1;number<=25;number++){
 const button=document.createElement("button");
 button.type="button";
 button.dataset.number=String(number);
 button.textContent=String(number).padStart(2,"0");
 button.setAttribute("aria-pressed","false");
 button.addEventListener("click",()=>{
  const value=Number(button.dataset.number);
  if(caixaTestNumbers.has(value))caixaTestNumbers.delete(value);
  else if(caixaTestNumbers.size<15)caixaTestNumbers.add(value);
  button.setAttribute("aria-pressed",String(caixaTestNumbers.has(value)));
  renderCaixaTestSelection();
 });
 caixaTestGrid.append(button);
}
renderCaixaTestSelection();
$("#copyCaixaTestGame").addEventListener("click",async()=>{
 if(caixaTestNumbers.size!==15){toast("Selecione exatamente 15 dezenas.");return;}
 try{
  if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(caixaTestPayload.value);
  else{
   caixaTestPayload.focus();caixaTestPayload.select();
   if(!document.execCommand("copy"))throw new Error("copy unavailable");
  }
  toast("Combinação copiada. Cole-a na extensão da CAIXA.");
 }catch(error){
  caixaTestPayload.focus();caixaTestPayload.select();
  toast("Não foi possível copiar. A combinação foi selecionada para cópia manual.");
 }
});
$$(`[data-action]`).forEach(btn=>btn.addEventListener("click",()=>{
 if(btn.dataset.action==="contribute"){
 showPage("payment");
 renderPixPayment(1);
 return;
 }
 const actions={
  "group-details":"Detalhes completos do grupo serão conectados na próxima etapa.",
  "about":"TotalSorte 0.4.0 — protótipo visual com pagamentos PIX demonstrativos."
 };
 toast(actions[btn.dataset.action]||"Função demonstrativa.");
}));
function installApp(){
 if(deferredInstallPrompt){
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(()=>{deferredInstallPrompt=null;}).catch(()=>{});
 }else{
  toast("No Chrome Android: menu ⋮ → Adicionar à tela inicial ou Instalar aplicativo.");
 }
}
$("#installProfile").addEventListener("click",installApp);
$("#installSettings").addEventListener("click",installApp);
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;});
$("#themeToggle").addEventListener("click",()=>{document.body.classList.toggle("light");toast("Tema alterado nesta sessão.");});
if("serviceWorker" in navigator && location.protocol!=="file:"){
 window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(error=>console.error("Falha ao registrar o service worker.",error)));
}

// Jogos de demonstração: números sorteados ficam destacados nos cartões da tela inicial.
const demoResults = {
  lf: [1,2,4,5,6,8,9,10,11,13,14,17,19,22,25],
  lm: [3,8,12,17,21,24,29,34,41,46,50,55,62,68,72,77,83,89,94,99]
};
const demoGames = {
  lf: [1,2,3,4,7,8,9,10,11,12,14,15,16,17,18],
  lm: [1,3,5,8,12,17,20,21,24,29,34,38,41,46,50,52,55,59,62,68,70,72,74,77,80,83,85,89,91,94,96,99,2,4,6,9,11,13,15,18,22,25,27,31,36,43,48,57,66,88]
};
function renderHomeGames(){
  $$('[data-game]').forEach(container=>{
    const type=container.dataset.game;
    const drawn=new Set(demoResults[type]);
    container.innerHTML=demoGames[type].map(n=>`<span class="game-number ${drawn.has(n)?'hit':''}" aria-label="Número ${String(n).padStart(2,'0')} ${drawn.has(n)?'sorteado':'não sorteado'}">${String(n).padStart(2,'0')}</span>`).join('');
  });
}
$('#homeWithdrawOpen').addEventListener('click',openWithdraw);

// Preparação visual de cadastro/login. A autenticação real exige backend; não validar credenciais no navegador.
const loginRoleButtons=$$('[data-role]');
loginRoleButtons.forEach(button=>button.addEventListener('click',()=>{
  loginRoleButtons.forEach(item=>item.classList.toggle('selected',item===button));
  const isAdmin=button.dataset.role==='admin';
  $('#loginUser').placeholder='Digite seu e-mail';
  $('#loginUser').value='';
  toast(isAdmin?'Informe o e-mail da conta de administrador.':'Informe o e-mail da sua conta.');
}));


// PIX pré-cadastrados do TotalSorte: os códigos são públicos e correspondem aos valores internos de cada multiplicador.
// Em produção, mover esta configuração para o painel administrativo/backend.
const TOTALSORTE_WHATSAPP_LINK = "https://wa.me/qr/GGEL72Q2HNF5E1?s=v";
const PIX_PAYMENT_OPTIONS = {
  1: { amount: 10.50, label: "R$ 10,50", code: "00020101021126360014br.gov.bcb.pix0114+5573999424413520400005303986540510.505802BR5919UALLAS SILVA SANTOS6009SAO PAULO622905251M6VM9QMDDH12R8QMTY9Q26X9630487D1", image: "assets/pix/pix-1x.png" },
  2: { amount: 21.00, label: "R$ 21,00", code: "00020101021126360014br.gov.bcb.pix0114+5573999424413520400005303986540521.005802BR5919UALLAS SILVA SANTOS6009SAO PAULO622905251M6VMD1QAV12MP8D80KES2QP963041184", image: "assets/pix/pix-2x.png" },
  3: { amount: 31.50, label: "R$ 31,50", code: "00020101021126360014br.gov.bcb.pix0114+5573999424413520400005303986540531.505802BR5919UALLAS SILVA SANTOS6009SAO PAULO622905251M6VMFDDPE8S9T7J1KDT6YPRB63041F5F", image: "assets/pix/pix-3x.png" },
  4: { amount: 42.00, label: "R$ 42,00", code: "00020101021126360014br.gov.bcb.pix0114+5573999424413520400005303986540542.005802BR5919UALLAS SILVA SANTOS6009SAO PAULO622905251M6VMHF7KRXTB30DMYEB7E4XK6304A02C", image: "assets/pix/pix-4x.png" },
  5: { amount: 52.50, label: "R$ 52,50", code: "00020101021126360014br.gov.bcb.pix0114+5573999424413520400005303986540552.505802BR5919UALLAS SILVA SANTOS6009SAO PAULO622905251M6VMKBMDY52JCYNZP0BKRZA863042489", image: "assets/pix/pix-5x.png" }
};
let activePaymentGroupCode = "MIX-031";

function renderPixPayment(multiplier){
  const option=PIX_PAYMENT_OPTIONS[multiplier];
  if(!option) return;
  const amount=currency(option.amount);
  const image=$("#pixQrImage");
  image.src=option.image;
  image.alt=`QR Code PIX para pagamento de ${amount}`;
  $("#pixQrCaption").textContent=`PIX de ${multiplier} ${multiplier===1?"cota":"cotas"} · ${amount}`;
  $("#pixPayload").value=option.code;
  $("#contributionAmount").textContent=amount;
  $$(".quota-option").forEach(button=>button.classList.toggle("selected",Number(button.dataset.multiplier)===multiplier));
  const message=`Olá! Realizei o pagamento do TotalSorte. Grupo: ${activePaymentGroupCode}. Cotas: ${multiplier}x (${multiplier} ${multiplier===1?"cota":"cotas"}). Valor: ${amount}. Estou enviando o comprovante para conferência.`;
  const separator=TOTALSORTE_WHATSAPP_LINK.includes("?")?"&":"?";
  $("#whatsappProofLink").href=`${TOTALSORTE_WHATSAPP_LINK}${separator}text=${encodeURIComponent(message)}`;
}

$$(".quota-option").forEach(button=>{
  const multiplier=Number(button.dataset.multiplier);
  button.addEventListener("click",()=>{
    if(button.disabled)return;
    renderPixPayment(multiplier);
  });
});
$("#copyPixButton").addEventListener("click",async()=>{
  const payload=$("#pixPayload").value;
  try{
    if(navigator.clipboard && window.isSecureContext){await navigator.clipboard.writeText(payload);}
    else{
      const field=$("#pixPayload");field.focus();field.select();
      const copied=document.execCommand("copy");
      if(!copied)throw new Error("copy unavailable");
    }
    toast("Código PIX copiado. Confira o valor antes de pagar.");
  }catch(error){toast("Não foi possível copiar automaticamente. Selecione e copie o código PIX.");}
});
renderPixPayment(1);
window.renderPixPayment=renderPixPayment;
window.setPaymentGroupCode=code=>{activePaymentGroupCode=code;};
window.showPage=showPage;
window.toast=toast;
window.openWithdraw=openWithdraw;


// Painel Administrativo 2.0 — dados fictícios e ações locais para validar o fluxo visual.
const adminPixRequests = [];
let adminPixFilter='all';
function adminStatusLabel(status){return status==='confirmed'?'Confirmado':status==='rejected'?'Recusado':'Aguardando';}
function renderAdminPix(){
 const list=$('#adminPixList'); if(!list)return;
 const visible=adminPixRequests.filter(x=>adminPixFilter==='all'||x.status===adminPixFilter);
 list.innerHTML=visible.length?visible.map(x=>`<article class="admin-pix-card" data-request="${x.id}"><div class="admin-pix-top"><div><span class="eyebrow">${x.id}</span><h3>${x.name}</h3></div><span class="status-pill ${x.status==='confirmed'?'status-green':x.status==='rejected'?'status-red':'status-amber'}">${adminStatusLabel(x.status)}</span></div><div class="admin-pix-details"><span><small>Grupo</small><b>${x.group}</b></span><span><small>Cotas</small><b>${x.multiplier}x</b></span><span><small>Valor</small><b>${currency(x.amount)}</b></span><span><small>Solicitação</small><b>${x.time}</b></span></div><div class="admin-proof"><span>▧ ${x.proof}</span><small>Confirme o valor no extrato C6 antes de aprovar.</small></div>${x.status==='pending'?`<div class="admin-actions"><button class="primary-btn" data-pix-action="confirm" data-id="${x.id}">Confirmar PIX</button><button class="outline-btn" data-pix-action="reject" data-id="${x.id}">Recusar</button><button class="danger-btn" data-pix-action="release" data-id="${x.id}">Liberar cotas</button><button class="danger-outline-btn" data-pix-action="remove" data-id="${x.id}">Expulsar participante</button></div>`:''}</article>`).join(''):'<div class="empty-state">Nenhuma solicitação nesta categoria.</div>';
 const pending=adminPixRequests.filter(x=>x.status==='pending').length;
 $('#adminPendingCount').textContent=String(pending).padStart(2,'0'); $('#pixPendingBadge').textContent=`${pending} pendentes`;
}
function adminAudit(message){const list=$('#adminAuditList');if(!list)return; if(list.querySelector('.empty-state'))list.innerHTML='';const row=document.createElement('div');row.className='admin-audit-row';const time=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});row.textContent=`${time} · ${message}`;list.prepend(row);}
$$('[data-pix-filter]').forEach(b=>b.addEventListener('click',()=>{adminPixFilter=b.dataset.pixFilter;$$('[data-pix-filter]').forEach(x=>x.classList.toggle('active',x===b));renderAdminPix();}));
$('#adminPixList').addEventListener('click',e=>{const b=e.target.closest('[data-pix-action]');if(!b)return;const item=adminPixRequests.find(x=>x.id===b.dataset.id);if(!item||item.status!=='pending')return;const action=b.dataset.pixAction;
 if(action==='confirm'){if(!confirm(`Confirmar o recebimento de ${currency(item.amount)} para ${item.id}? Confira o extrato bancário antes.`))return;item.status='confirmed';adminAudit(`${item.id}: pagamento de ${currency(item.amount)} confirmado por Uallas.`);toast('Pagamento marcado como confirmado na demonstração.');}
 if(action==='reject'){const reason=prompt('Informe o motivo da recusa:');if(!reason||!reason.trim())return;item.status='rejected';adminAudit(`${item.id}: PIX recusado. Motivo: ${reason.trim()}`);toast('Pagamento recusado na demonstração.');}
 if(action==='release'){const reason=prompt('Motivo para liberar as cotas reservadas:');if(!reason||!reason.trim())return;item.status='rejected';adminAudit(`${item.id}: cotas liberadas. Motivo: ${reason.trim()}`);toast('Cotas liberadas na demonstração.');}
 if(action==='remove'){const reason=prompt('Motivo para remover este participante do grupo:');if(!reason||!reason.trim())return;item.status='rejected';adminAudit(`${item.name} removido de ${item.group}. Motivo: ${reason.trim()}`);toast('Participante removido na demonstração.');}
 renderAdminPix();
});
$$('[data-admin-scroll]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.adminScroll)?.scrollIntoView({behavior:'smooth',block:'start'})));
$$('[data-admin-demo]').forEach(b=>b.addEventListener('click',()=>toast(`${b.dataset.adminDemo}: função ilustrativa, será conectada ao backend.`)));
renderAdminPix();

/* MOTOR MIX — prévias e versões definitivas.
   A consulta direta à CAIXA pode ser bloqueada por CORS/navegador. Em produção,
   esta rotina deve ser executada por um backend e gravada no banco de dados. */
const MIX_ENGINE = {
  groupCode: 'MIX-031',
  capacity: 10,
  paidQuotas: 0,
  currentRound: 1,
  groupClosed: false,
  gamesPerQuota: 3,
  versions: [],
  latestHistory: { lf: [], lm: [] },
  sourceStatus: 'pending'
};
const MIX_API = {
  lf: 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil',
  lm: 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotomania'
};
const MIX_ARCHIVE_KEY = 'totalsorte:MIX-031:game-versions:v1';
const MIX_REGISTRATION_KEY = 'totalsorte:MIX-031:official-registrations:v1';

function mixReadArchive(){
  try { const value=JSON.parse(localStorage.getItem(MIX_ARCHIVE_KEY)||'[]'); return Array.isArray(value)?value:[]; }
  catch { return []; }
}
function mixSaveVersion(version){
  MIX_ENGINE.versions.push(version);
  try { localStorage.setItem(MIX_ARCHIVE_KEY,JSON.stringify(MIX_ENGINE.versions)); }
  catch(error){ console.warn('Não foi possível persistir o histórico local de jogos.',error); }
}
function mixReadRegistrations(){
  try { const value=JSON.parse(localStorage.getItem(MIX_REGISTRATION_KEY)||'[]'); return Array.isArray(value)?value:[]; }
  catch { return []; }
}
function mixSaveRegistration(registration){
  const records=mixReadRegistrations();
  if(records.some(item=>item.groupCode===registration.groupCode&&Number(item.round)===Number(registration.round)))
    throw new Error('Esta rodada já possui uma confirmação de apostas realizadas.');
  records.push(registration);
  localStorage.setItem(MIX_REGISTRATION_KEY,JSON.stringify(records));
  return records;
}
function mixRenderOfficialRegistration(){
  const records=mixReadRegistrations();
  const current=records.find(item=>item.groupCode===MIX_ENGINE.groupCode&&Number(item.round)===Number(MIX_ENGINE.currentRound));
  const definitive=MIX_ENGINE.versions.some(item=>item.groupCode===MIX_ENGINE.groupCode&&Number(item.round)===Number(MIX_ENGINE.currentRound)&&item.type==='definitive');
  const status=$('#mixOfficialStatus'),button=$('#confirmMixOfficialRegistration');
  if(!status||!button)return;
  const adminBadge=$('#adminMix031Status');
  if(current){
    status.textContent='Apostas realizadas';status.className='status-pill status-green';
    $('#mixOfficialContestLf').value=current.contests.lotofacil;
    $('#mixOfficialContestLm').value=current.contests.lotomania;
    $('#mixOfficialPaidAmount').value=Number(current.totalPaid).toFixed(2);
    button.disabled=true;button.textContent='Apostas confirmadas nesta rodada';
    if(adminBadge){adminBadge.textContent='Apostas realizadas';adminBadge.className='status-pill status-green';}
    if($('#mix031GroupStatus'))$('#mix031GroupStatus').textContent='Apostas realizadas';
  }else{
    status.textContent=definitive?'Aguardando registro na CAIXA':'Aguardando jogos definitivos';
    status.className='status-pill status-amber';
    button.disabled=!definitive;button.textContent='Confirmar apostas realizadas';
    if(adminBadge&&definitive){adminBadge.textContent='Aguardando registro';adminBadge.className='status-pill status-amber';}
    if($('#mix031GroupStatus')&&definitive)$('#mix031GroupStatus').textContent='Jogos definitivos';
  }
  const history=$('#mixOfficialHistory');
  if(history){
    history.innerHTML=records.filter(item=>item.groupCode===MIX_ENGINE.groupCode).slice().reverse().map(item=>`<div class="mix-official-history-row"><b>Rodada ${item.round} · ${currency(Number(item.totalPaid))}</b><span>LF #${item.contests.lotofacil} · LM #${item.contests.lotomania}</span><small>Confirmado em ${new Date(item.confirmedAt).toLocaleString('pt-BR')} por ${item.confirmedBy}</small></div>`).join('')||'<small>Nenhuma rodada registrada ainda.</small>';
  }
}
$('#confirmMixOfficialRegistration')?.addEventListener('click',()=>{
  const hasDefinitive=MIX_ENGINE.versions.some(item=>item.groupCode===MIX_ENGINE.groupCode&&Number(item.round)===Number(MIX_ENGINE.currentRound)&&item.type==='definitive');
  if(!hasDefinitive){toast('Gere os jogos definitivos antes de confirmar as apostas.');return;}
  const contestLf=$('#mixOfficialContestLf').value.trim(),contestLm=$('#mixOfficialContestLm').value.trim();
  const totalPaid=Number(String($('#mixOfficialPaidAmount').value).replace(',','.'));
  if(!contestLf||!contestLm||!/^\d+$/.test(contestLf)||!/^\d+$/.test(contestLm)){toast('Informe os números dos concursos da Lotofácil e da Lotomania.');return;}
  if(!Number.isFinite(totalPaid)||totalPaid<=0){toast('Informe o valor total efetivamente pago.');return;}
  if(!confirm(`Confirma que registrou na CAIXA os 30 jogos desta rodada?\nLotofácil: concurso ${contestLf}\nLotomania: concurso ${contestLm}\nTotal pago: ${currency(totalPaid)}\n\nEsta confirmação ficará registrada no histórico.`))return;
  try{
    const registration={groupCode:MIX_ENGINE.groupCode,round:MIX_ENGINE.currentRound,contests:{lotofacil:contestLf,lotomania:contestLm},totalPaid:Number(totalPaid.toFixed(2)),confirmedAt:new Date().toISOString(),confirmedBy:'Administrador'};
    mixSaveRegistration(registration);mixRenderOfficialRegistration();
    adminAudit(`${MIX_ENGINE.groupCode} rodada ${MIX_ENGINE.currentRound}: administrador confirmou o registro dos 30 jogos na CAIXA; total ${currency(totalPaid)}.`);
    toast('Apostas realizadas registradas para esta rodada.');
  }catch(error){toast(error.message||'Não foi possível salvar a confirmação local.');}
});
function mixNormalizeDraw(payload){
  const raw=payload.listaDezenas||payload.dezenasSorteadasOrdemSorteio||payload.dezenas||[];
  const numbers=raw.map(v=>Number(String(v).replace(/\D/g,''))).filter(Number.isInteger);
  return { contest:Number(payload.numero||payload.concurso||0), date:payload.dataApuracao||payload.data_apuracao||'', numbers };
}
async function mixFetchJson(url){
  const response=await fetch(url,{method:'GET',headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`Fonte de resultados respondeu HTTP ${response.status}`);
  return response.json();
}
async function mixFetchLatest15(modality){
  const latest=await mixFetchJson(MIX_API[modality]);
  const first=mixNormalizeDraw(latest);
  if(!first.contest||first.numbers.length!==(modality==='lf'?15:20))throw new Error('Formato de resultado inesperado da CAIXA.');
  const draws=[first];
  for(let offset=1;offset<15;offset++){
    const contest=first.contest-offset;
    if(contest<1)break;
    const payload=await mixFetchJson(`${MIX_API[modality]}/${contest}`);
    const draw=mixNormalizeDraw(payload);
    if(draw.contest!==contest||draw.numbers.length!==(modality==='lf'?15:20))throw new Error(`Resultado incompleto no concurso ${contest}.`);
    draws.push(draw);
  }
  if(draws.length!==15)throw new Error('Não foi possível obter os 15 concursos completos.');
  return draws;
}
async function mixRefreshHistory(){
  const [lf,lm]=await Promise.all([mixFetchLatest15('lf'),mixFetchLatest15('lm')]);
  MIX_ENGINE.latestHistory={lf,lm};
  MIX_ENGINE.sourceStatus='official';
  return MIX_ENGINE.latestHistory;
}
function mixBuildWeights(draws,min,max){
  const freq=Array(max-min+1).fill(0);
  const last=draws[0]?.numbers||[];
  draws.forEach((draw,index)=>draw.numbers.forEach(n=>{if(n>=min&&n<=max)freq[n-min]+=(15-index)/15;}));
  const maxFreq=Math.max(1,...freq);
  return freq.map((count,index)=>{
    const number=index+min;
    const recent=last.includes(number)?1.12:1;
    return 0.72+(count/maxFreq)*1.35*recent;
  });
}
function mixWeightedPick(pool,weights){
  let total=weights.reduce((sum,w)=>sum+w,0),point=Math.random()*total;
  for(let i=0;i<pool.length;i++){point-=weights[i];if(point<=0)return pool[i];}
  return pool[pool.length-1];
}
function mixGenerateOne(modality,draws){
  const isLf=modality==='lf',min=isLf?1:0,max=isLf?25:99,count=isLf?15:50;
  const pool=Array.from({length:max-min+1},(_,i)=>i+min);
  const weights=mixBuildWeights(draws,min,max);
  let best=null,bestScore=-Infinity;
  for(let attempt=0;attempt<45;attempt++){
    const remaining=pool.slice(),selected=[];
    while(selected.length<count){
      const localWeights=remaining.map(n=>weights[n-min]);
      const chosen=mixWeightedPick(remaining,localWeights);
      selected.push(chosen);remaining.splice(remaining.indexOf(chosen),1);
    }
    selected.sort((a,b)=>a-b);
    const odd=selected.filter(n=>n%2).length;
    const expectedOdd=count/2;
    const ranges=isLf?[selected.filter(n=>n<=8).length,selected.filter(n=>n>=9&&n<=17).length,selected.filter(n=>n>=18).length]:[selected.filter(n=>n<=24).length,selected.filter(n=>n>=25&&n<=49).length,selected.filter(n=>n>=50&&n<=74).length,selected.filter(n=>n>=75).length];
    const rangeTarget=count/ranges.length;
    const rangePenalty=ranges.reduce((sum,n)=>sum+Math.abs(n-rangeTarget),0);
    const parityPenalty=Math.abs(odd-expectedOdd);
    const score=selected.reduce((sum,n)=>sum+weights[n-min],0)-parityPenalty*0.55-rangePenalty*0.22;
    if(score>bestScore){bestScore=score;best=selected;}
  }
  return best;
}
function mixGenerateSet(history,versionType){
  const games=[];
  for(let i=0;i<15;i++)games.push({id:`LF-${String(i+1).padStart(2,'0')}`,modality:'Lotofácil',numbers:mixGenerateOne('lf',history?.lf||[])});
  for(let i=0;i<15;i++)games.push({id:`LM-${String(i+1).padStart(2,'0')}`,modality:'Lotomania',numbers:mixGenerateOne('lm',history?.lm||[])});
  return {id:`${MIX_ENGINE.groupCode}-R${MIX_ENGINE.currentRound}-${versionType}-${Date.now()}`,groupCode:MIX_ENGINE.groupCode,round:MIX_ENGINE.currentRound,type:versionType,createdAt:new Date().toISOString(),source:history?'CAIXA — 15 concursos por modalidade':'Sem histórico oficial disponível — geração provisória aleatória',contestRefs:history?{lotofacil:history.lf.map(x=>x.contest),lotomania:history.lm.map(x=>x.contest)}:null,games};
}
function mixRenderGames(version){
  const list=$('#mix031GameList');if(!list||!version)return;
  list.innerHTML=version.games.map(game=>`<article class="generated-game"><div class="generated-game-top"><b>${game.modality} · ${game.id}</b><span>${game.numbers.length} dezenas</span></div><div class="generated-game-numbers">${game.numbers.map(n=>`<span>${String(n).padStart(2,'0')}</span>`).join('')}</div></article>`).join('');
  const definitive=version.type==='definitive';
  $('#mix031GameStatus').textContent=definitive?'Jogos definitivos':'Prévia — aguardando fechamento do grupo';
  $('#mix031GameMeta').textContent=`30 combinações · versão ${MIX_ENGINE.versions.indexOf(version)+1} · ${new Date(version.createdAt).toLocaleString('pt-BR')}`;
  $('#mix031GameBadge').textContent=definitive?'DEFINITIVOS':'PRÉVIA';
  $('#mix031GameBadge').className=`status-pill ${definitive?'status-green':'status-amber'}`;
  const refs=version.contestRefs;
  $('#mix031GameSource').textContent=refs?`Base: últimos 15 concursos da Lotofácil (${refs.lotofacil[14]}–${refs.lotofacil[0]}) e da Lotomania (${refs.lotomania[14]}–${refs.lotomania[0]}). ${version.source}.`:`${version.source}. Esta prévia não deve ser registrada como aposta.`;
}
function mixCreatePreview(history=null){
  const version=mixGenerateSet(history,'preview');
  mixSaveVersion(version);mixRenderGames(version);
  return version;
}
function mixSetGroupStatus(){
  $('#mix031QuotaCount').textContent=`${MIX_ENGINE.paidQuotas}/10`;
  $('#mix031GroupStatus').textContent=MIX_ENGINE.paidQuotas===10?'Pronto para jogar':'Pendente';
  $('#adminMix031Summary').textContent=`${MIX_ENGINE.paidQuotas}/10 cotas confirmadas · ${MIX_ENGINE.paidQuotas===10?'grupo completo':'aguardando fechamento'}`;
  $('#adminMix031Progress').style.width=`${MIX_ENGINE.paidQuotas*10}%`;
  $('#adminMix031Status').textContent=MIX_ENGINE.paidQuotas===10?'Completo':'Prévia';
  $('#adminMix031Status').className=`status-pill ${MIX_ENGINE.paidQuotas===10?'status-green':'status-amber'}`;
}
async function mixFinalizeGroup(){
  if(MIX_ENGINE.paidQuotas!==MIX_ENGINE.capacity){toast('O grupo só pode fechar com 10 cotas preenchidas e todos os pagamentos confirmados.');return;}
  if(!confirm('Confirmar que as 10 cotas foram pagas? Os jogos provisórios serão substituídos por uma nova versão definitiva.'))return;
  const button=$('#demoCloseMixGroup');button.disabled=true;button.textContent='Consultando os últimos 15 concursos…';
  try{
    const history=await mixRefreshHistory();
    const definitive=mixGenerateSet(history,'definitive');
    mixSaveVersion(definitive);mixRenderGames(definitive);mixRenderOfficialRegistration();
    $('#adminMix031Summary').textContent=`10/10 cotas confirmadas · rodada ${MIX_ENGINE.currentRound} com jogos definitivos`;
    $('#adminMix031Status').textContent='Jogos definitivos';$('#adminMix031Status').className='status-pill status-green';
    $('#demoNextMixContest').hidden=false;
    adminAudit(`MIX-031: versão definitiva gerada com 15 concursos oficiais de cada modalidade.`);
    toast('Jogos definitivos gerados. A versão anterior foi preservada no histórico local.');
  }catch(error){
    console.error(error);
    toast('Não foi possível consultar os 15 concursos da CAIXA. Nenhum jogo definitivo foi criado. Tente novamente ou use a integração de backend.');
    $('#mix031GameSource').textContent=`Falha ao atualizar resultados: ${error.message}. A prévia foi mantida e não foi promovida a jogo definitivo.`;
  }finally{button.disabled=false;button.textContent='Simular fechamento e gerar jogos definitivos';}
}

MIX_ENGINE.versions=[];
$('#mix031GameStatus').textContent='Jogos aguardando integração operacional';
$('#mix031GameMeta').textContent='Nenhum jogo definitivo registrado no banco';
$('#mix031GameBadge').textContent='AGUARDANDO';
$('#mix031GameSource').textContent='A geração definitiva está bloqueada até a consulta e validação dos resultados no backend.';
$('#mix031GroupCard').querySelector('#mix031GamesPanel').hidden=true;
$('#demoCloseMixGroup').disabled=true;
$('#demoNextMixContest').disabled=true;
$('#confirmMixOfficialRegistration').disabled=true;
