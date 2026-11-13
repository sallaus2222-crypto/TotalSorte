# TotalSorte — Protótipo 0.6.2

Esta versão parte do protótipo 0.3.0 e acrescenta o fluxo visual de contribuição com os cinco códigos PIX informados pelo responsável e o contato de WhatsApp para envio de comprovante.

## Como abrir

1. Extraia o ZIP.
2. Abra a pasta `TotalSorte` no VS Code.
3. Para prévia rápida, abra `index.html` no navegador.
4. Para testar o PWA/service worker, use Live Server ou `python -m http.server 8000`.

## O que mudou na versão 0.4.0

- Nova tela “Escolha suas cotas” acessada pelo botão “Ver contribuição” do grupo MIX-031.
- Cinco opções PIX ligadas aos multiplicadores: 1x R$ 10,50; 2x R$ 21,00; 3x R$ 31,50; 4x R$ 42,00; 5x R$ 52,50.
- QR Codes em PNG gerados a partir dos códigos PIX Copia e Cola fornecidos.
- Campo PIX Copia e Cola com botão de copiar.
- Botão de WhatsApp usando o link fornecido, com mensagem preenchida com grupo, quantidade de cotas e valor.
- Aviso explícito de que o pagamento só é confirmado após conferência manual do administrador.
- No exemplo MIX-031, foram exibidas 5 cotas disponíveis; por isso todas as opções 1x a 5x ficam selecionáveis. A disponibilidade real deverá vir do banco de dados.
- Cache do PWA atualizado para 0.4.0 e os cinco QR Codes adicionados ao pré-cache.

## Importante — limites desta versão

Esta ainda é uma demonstração frontend. Os códigos PIX foram inseridos no JavaScript para facilitar o teste e são dados públicos de cobrança; em produção, a configuração deverá ser administrada com persistência no backend. A tela não verifica pagamento, não envia notificação automática ao administrador, não reserva cotas de verdade e não altera o status do grupo no servidor.

O botão do WhatsApp abre o link fornecido com uma mensagem pré-preenchida. O cliente ainda precisa anexar e enviar o comprovante manualmente. O administrador deve conferir o recebimento no banco antes de confirmar a participação.

Antes de usar com dinheiro real, valide cada QR Code no aplicativo bancário e confirme beneficiário e valor. Os preços de R$ 10,50 a R$ 52,50 são a regra interna de referência do TotalSorte, não preços oficiais das loterias. A operação de bolões/participações com dinheiro real também exige análise jurídica e verificação das regras aplicáveis.

Login, cadastro, grupos, cotas, pagamentos, painel administrativo, resultados e carteira continuam demonstrativos e não devem ser usados como operação real.

## Atualização 0.5.0 — Painel Administrativo 2.0

- Dashboard administrativo com indicadores de clientes, grupos ativos, PIX pendentes e saques.
- Atalhos para Pagamentos PIX, Grupos MIX, Clientes, Saques, Concursos, Relatórios, Notificações e Configurações.
- Área de pendências PIX com filtros por situação e cartões de solicitação.
- Ações demonstrativas: confirmar PIX, recusar, liberar cotas reservadas e remover participante do grupo, sempre solicitando justificativa quando aplicável.
- Histórico local das ações realizadas durante a sessão.
- Regra visual explícita: cotas não são liberadas automaticamente após 3 minutos; a decisão fica com o administrador.
- Painel acessível pela opção Administrador no login ou pelo botão de visualização demonstrativa.
- Layout responsivo para celular e desktop, integrado à identidade visual do TotalSorte.

**Limite importante:** o painel e as ações são demonstrativos e ficam apenas no navegador. Não há autenticação segura, permissões reais, banco de dados, upload/visualização de comprovante, auditoria permanente ou alteração real de cotas/pagamentos. Para produção, essas regras precisam ser implementadas no backend, com autorização do administrador e transações protegidas.


## Atualização 0.6.0 — motor de jogos MIX (prévia e definitivo)

- O grupo MIX-031 recebe uma prévia de 30 combinações assim que a interface carrega: 15 Lotofácil e 15 Lotomania. A tela identifica claramente que são jogos provisórios e que ainda não representam apostas registradas.
- O motor tenta consultar os últimos 15 concursos de cada modalidade no endpoint público observado da CAIXA (`servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil` e `/lotomania`). A coleta busca o concurso mais recente e os 14 anteriores.
- A geração aplica ponderação por frequência recente e equilíbrio de paridade/faixas. É uma heurística de organização, não previsão; não aumenta nem garante chances de acerto.
- O painel administrativo ganhou um controle de simulação de fechamento. A geração definitiva exige 10/10 cotas e tenta atualizar novamente os 15 concursos de cada modalidade. Se a consulta falhar, a prévia permanece e nenhum jogo definitivo é criado.
- Cada versão recebe identificador, data, rodada, tipo, origem e referência dos concursos utilizados. As versões ficam em histórico local (`localStorage`) no protótipo; uma versão definitiva não sobrescreve a anterior.
- Após a primeira geração definitiva, o painel oferece a criação dos jogos da rodada seguinte, mantendo as versões das rodadas anteriores.

**Limites técnicos desta etapa:** a CAIXA não oferece SLA público para essa interface de API, e a chamada direta pelo navegador pode falhar por CORS/rede. A integração de produção deve mover a coleta para backend, validar/armazenar resultados e versões em banco de dados, e só então confirmar o fechamento. O histórico local é apenas para demonstração e não substitui persistência central. O botão de fechamento atual é explicitamente uma simulação; não confirma pagamentos reais.


## Atualização 0.6.2 — registro consolidado das apostas na CAIXA

- Incluída no painel administrativo a seção “Registro oficial das apostas” para o grupo MIX-031.
- O controle representa um único registro administrativo por grupo e rodada, abrangendo o conjunto de 30 jogos: 15 Lotofácil e 15 Lotomania.
- O administrador informa os dois números de concurso e o valor total efetivamente pago. O valor inicial sugerido é R$ 105,00 (30 × R$ 3,50), mas pode ser alterado para refletir o pagamento real.
- O botão “Confirmar apostas realizadas” só fica disponível depois da geração dos jogos definitivos. A confirmação exige ação manual e confirmação adicional na tela.
- Não é obrigatório anexar comprovante para mudar o status, conforme a regra definida pelo responsável. A confirmação registra data/hora, rodada, concursos, valor total e usuário administrador.
- O histórico de confirmações é separado por rodada e não permite confirmar duas vezes a mesma rodada. Ao gerar a próxima rodada, o status volta a aguardar confirmação, sem apagar o registro anterior.
- Os registros ficam em `localStorage` nesta demonstração. Persistência compartilhada, autenticação e auditoria confiável exigem backend; limpar dados do navegador pode apagar esse histórico local.

**Importante:** esta confirmação é um controle interno do TotalSorte. Ela não registra apostas na CAIXA nem verifica transações. O administrador deve primeiro realizar e conferir as apostas nos canais oficiais e só então confirmar no TotalSorte. Lotofácil e Lotomania continuam sendo modalidades distintas, com seus próprios números de concurso e comprovantes oficiais.


## Atualização 0.7.0 — fundação Supabase

- Adicionada estrutura inicial de banco PostgreSQL em `supabase/migrations/202611090001_initial_schema.sql`, com perfis, grupos, cotas, pagamentos, concursos, versões de jogos, jogos, registro das apostas, carteira, lançamentos, saques e auditoria.
- Incluídas políticas iniciais de Row Level Security (RLS) para separar dados de participantes e administração.
- Adicionado cliente Supabase JS v2 carregado como módulo e arquivo de configuração pública `js/supabase-config.js` com campos para Project URL e chave anon/publishable.
- Service worker atualizado para a nova versão e para os novos arquivos.
- Guia de configuração em `supabase/README.md`.

**Limite da versão 0.7.0:** o projeto Supabase ainda precisava ser criado e as telas não estavam conectadas. A atualização 0.8.0 abaixo conecta os fluxos básicos, mas ainda não habilita resultados e apostas definitivas.


## Atualização 0.8.0 — fluxos conectados ao Supabase

- Cadastro, login e sessão usam Supabase Auth; a área administrativa depende do perfil `admin`.
- Grupos e cotas são lidos do banco. A reserva de cotas e a criação do pagamento são atômicas e bloqueiam excesso de capacidade.
- Administradores podem criar grupos MIX pelo painel.
- A conferência/recusa de PIX é feita por RPC administrativa, libera cotas quando recusada e mantém auditoria.
- Saldo e extrato são lidos do banco; saques reservam saldo em uma transação e o administrador pode registrar pagamento ou falha.
- Créditos de premiação exigem admin, chave de idempotência e registro de auditoria.
- O service worker não armazena respostas do Supabase em cache.

**Ativação:** aplicar também `supabase/migrations/202611090002_operational_workflows.sql` no projeto existente e preencher a URL e a chave pública em `js/supabase-config.js`. A geração/registro definitivo de jogos, importação de resultados oficiais e notificações continuam bloqueados; não usar o app para apostar ou movimentar dinheiro antes de concluir essas etapas, testar RLS com contas separadas e validar as obrigações legais e de privacidade.

## Piloto assistido — portal e carrinho da Lotofácil

O painel do admin apresenta o motivo de o portal não aparecer embutido: a resposta oficial da CAIXA inclui `X-Frame-Options: DENY`, portanto o navegador bloqueia iframe. O botão abre o domínio oficial em outra aba. Não há proxy para remover essa proteção.

Há uma extensão experimental em `loterias-assistente`. Ela roda apenas na página `www.loteriasonline.caixa.gov.br/silce-web/`, não lê nem salva credenciais e não acessa a rede. O piloto seleciona 15 dezenas, pede conferência visual e, somente após um segundo clique e confirmação, envia o clique no botão “Colocar no carrinho”. Não confirma aposta ou pagamento e não contorna CAPTCHA ou validações de segurança.

1. No Chrome, abra `chrome://extensions`, habilite “Modo do desenvolvedor” e selecione “Carregar sem compactação”.
2. Escolha a pasta `loterias-assistente` desta entrega e recarregue qualquer aba do portal CAIXA que já estava aberta.
3. Entre manualmente no portal oficial, escolha Lotofácil e deixe o volante sem dezenas marcadas.
4. No TotalSorte, entre como administrador e abra “Preparar um jogo no portal CAIXA”. Escolha exatamente 15 dezenas e copie a combinação.
5. Cole no painel da extensão do portal, confirme que o volante está vazio e clique “Marcar as 15 dezenas”.
6. Revise visualmente as dezenas. Marque a confirmação no painel e clique “Colocar 1 jogo no carrinho”. Confira o carrinho no próprio portal e pare antes de finalizar.

Este piloto exige que a tela use controles visíveis com texto exato para cada dezena e para “Colocar no carrinho”. Se o portal alterar a tela, se houver controle duplicado ou validação de segurança, a extensão deve parar; continue manualmente. A combinação é escolhida manualmente no painel e não é um jogo definitivo gerado ou persistido no Supabase. Teste sem efetuar pagamento.
