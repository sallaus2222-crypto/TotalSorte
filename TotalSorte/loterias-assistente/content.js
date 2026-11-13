(() => {
  if (location.hostname !== "www.loteriasonline.caixa.gov.br" ||
      !location.pathname.startsWith("/silce-web/") ||
      document.getElementById("totalsorte-caixa-assistant")) return;

  const host = document.createElement("div");
  host.id = "totalsorte-caixa-assistant";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box}
      .panel{width:min(360px,calc(100vw - 32px));padding:16px;border:1px solid #49617e;border-radius:14px;background:#0d1729;color:#f4f7ff;box-shadow:0 12px 40px #0008;font:13px/1.45 system-ui,sans-serif}
      h2{margin:0 0 7px;font-size:16px}
      p{margin:7px 0;color:#bdcbe0}
      textarea{display:block;width:100%;min-height:64px;margin:9px 0;padding:9px;border:1px solid #49617e;border-radius:8px;background:#07101f;color:#fff;font:12px/1.4 monospace;resize:vertical}
      label{display:flex;gap:8px;align-items:flex-start;margin:9px 0;color:#d9e3f2}
      input{margin-top:3px}
      button{width:100%;margin-top:7px;padding:10px;border:1px solid #38bed1;border-radius:8px;background:#17384b;color:#effcff;font-weight:700;cursor:pointer}
      button:disabled{opacity:.45;cursor:not-allowed}
      .secondary{border-color:#52617a;background:#202d42}
      .status{min-height:36px;margin-top:8px;padding:8px;border-radius:8px;background:#17243a;color:#c9d6e8}
      .warning{font-size:11px;color:#ffdc91}
    </style>
    <section class="panel" aria-label="Assistente TotalSorte para Lotofacil">
      <h2>TotalSorte · teste Lotofácil</h2>
      <p>Cole uma combinação de 15 dezenas, separadas por vírgula ou espaço.</p>
      <textarea id="numbers" inputmode="numeric" spellcheck="false" placeholder="01, 02, 03, ..."></textarea>
      <label><input id="ready" type="checkbox">Estou na tela Lotofácil e o volante está vazio, sem dezenas marcadas.</label>
      <button id="mark" type="button">Marcar as 15 dezenas</button>
      <label><input id="reviewed" type="checkbox" disabled>Conferi visualmente as 15 dezenas marcadas.</label>
      <button id="cart" class="secondary" type="button" disabled>Colocar 1 jogo no carrinho</button>
      <p class="warning">Não finaliza aposta ou pagamento. Não informe credenciais aqui. Se a tela mudar ou aparecer validação de segurança, pare e continue manualmente.</p>
      <div id="status" class="status" role="status">Aguardando combinação.</div>
    </section>`;

  const input = root.querySelector("#numbers");
  const ready = root.querySelector("#ready");
  const markButton = root.querySelector("#mark");
  const reviewed = root.querySelector("#reviewed");
  const cartButton = root.querySelector("#cart");
  const status = root.querySelector("#status");
  let markedNumbers = [];

  function parseNumbers(value) {
    const tokens = value.trim().split(/[,\s;]+/).filter(Boolean);
    if (tokens.length !== 15 || tokens.some(token => !/^\d{1,2}$/.test(token))) {
      throw new Error("Informe exatamente 15 dezenas entre 01 e 25.");
    }
    const numbers = tokens.map(Number);
    if (numbers.some(number => number < 1 || number > 25) ||
        new Set(numbers).size !== 15) {
      throw new Error("As dezenas precisam ser únicas e estar entre 01 e 25.");
    }
    return numbers.sort((a, b) => a - b);
  }

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden" &&
      style.pointerEvents !== "none";
  }

  function interactiveControls() {
    return [...document.querySelectorAll(
      'button,a,[role="button"],[aria-pressed],[aria-checked],[tabindex="0"]'
    )].filter(visible);
  }

  function exactNumberControl(number) {
    const expected = new Set([String(number), String(number).padStart(2, "0")]);
    const matches = interactiveControls().filter(element => {
      const label = (element.getAttribute("aria-label") || element.innerText || element.textContent || "")
        .replace(/\s+/g, " ").trim();
      return expected.has(label);
    });
    if (matches.length !== 1) {
      throw new Error(`Esperava um único controle visível para ${String(number).padStart(2, "0")}; encontrei ${matches.length}.`);
    }
    if (matches[0].disabled || matches[0].getAttribute("aria-disabled") === "true") {
      throw new Error(`A dezena ${String(number).padStart(2, "0")} está desabilitada.`);
    }
    return matches[0];
  }

  function hasSecurityChallenge() {
    return /captcha|não sou um robô|nao sou um robo|verificação de segurança|verificacao de seguranca/i
      .test(document.body.innerText);
  }

  input.addEventListener("input", () => {
    reviewed.checked = false;
    reviewed.disabled = true;
    cartButton.disabled = true;
    markedNumbers = [];
  });

  markButton.addEventListener("click", async () => {
    markButton.disabled = true;
    cartButton.disabled = true;
    reviewed.checked = false;
    reviewed.disabled = true;
    let clickStarted = false;
    try {
      if (hasSecurityChallenge()) {
        throw new Error("A página mostrou uma validação de segurança. Continue manualmente.");
      }
      if (!ready.checked) {
        throw new Error("Confirme que selecionou Lotofácil e que o volante está vazio.");
      }
      markedNumbers = parseNumbers(input.value);
      markedNumbers.forEach(exactNumberControl);
      status.textContent = "Marcando dezenas. Não clique na página até terminar.";
      for (let index = 0; index < markedNumbers.length; index += 1) {
        const control = exactNumberControl(markedNumbers[index]);
        clickStarted = true;
        control.click();
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      reviewed.disabled = false;
      cartButton.disabled = false;
      status.textContent = "Preenchimento enviado. Confira as dezenas no volante antes de habilitar o carrinho.";
    } catch (error) {
      markedNumbers = [];
      status.textContent = `${error.message || "Não consegui reconhecer a tela."}${clickStarted ? " A sequência pode ter parado no meio; limpe o volante manualmente antes de tentar novamente." : ""}`;
    } finally {
      markButton.disabled = false;
    }
  });

  reviewed.addEventListener("change", () => {
    cartButton.disabled = !reviewed.checked || markedNumbers.length !== 15;
  });

  cartButton.addEventListener("click", () => {
    cartButton.disabled = true;
    try {
      if (!reviewed.checked || markedNumbers.length !== 15) {
        throw new Error("Confira as dezenas antes de colocar o jogo no carrinho.");
      }
      if (hasSecurityChallenge()) {
        throw new Error("A página mostrou uma validação de segurança. Continue manualmente.");
      }
      const matches = interactiveControls().filter(element =>
        (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim() === "Colocar no carrinho"
      );
      if (matches.length !== 1 || matches[0].disabled) {
        throw new Error(`Esperava um único botão ativo “Colocar no carrinho”; encontrei ${matches.length}.`);
      }
      if (!window.confirm("Adicionar este jogo da Lotofácil ao carrinho? A compra e o pagamento não serão realizados.")) {
        cartButton.disabled = false;
        return;
      }
      matches[0].click();
      status.textContent = "Clique enviado. Confira o carrinho no portal; a extensão não confirma compra nem pagamento.";
    } catch (error) {
      status.textContent = error.message || "Não foi possível adicionar ao carrinho.";
      cartButton.disabled = false;
    }
  });
})();
