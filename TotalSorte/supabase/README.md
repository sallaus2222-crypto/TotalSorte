# Supabase — TotalSorte

## Antes de aplicar

1. Faça backup do banco atual e confirme que selecionou o projeto correto no dashboard.
2. Em Project Settings → API, copie a Project URL e a chave pública `anon`/`publishable`.
3. Preencha `url` e `anonKey` em `js/supabase-config.js`.
4. Nunca use `service_role` ou qualquer chave `secret` no navegador, GitHub ou PWA.
5. Em Authentication → URL Configuration, configure a URL pública do site e as URLs de redirecionamento de desenvolvimento/produção. Mantenha confirmação de e-mail e limites de autenticação adequados.

## Aplicar as migrações

No SQL Editor do Supabase, execute nesta ordem:

1. `migrations/202611090001_initial_schema.sql` — tabelas, trigger de perfil e RLS inicial.
2. `migrations/202611090002_operational_workflows.sql` — grupos iniciais, RPCs transacionais e políticas de escrita restritas.
3. `migrations/202611130001_game_generation.sql` — persistência atômica dos jogos e leitura dos jogos publicados pelos clientes antes da participação.
4. `migrations/202611130002_prize_distribution.sql` — registro oficial das apostas, cálculo de prêmios por faixa da CAIXA e rateio confirmado pelo admin.
5. `migrations/202611130003_public_statistics.sql` — leitura pública, sem escrita, dos resultados oficiais.

Depois, confira no Table Editor se RLS está ativo em todas as tabelas. A segunda migração também cria perfis/carteiras para usuários já existentes e não altera as funções administrativas existentes.

## Criar o primeiro administrador

1. Crie a conta do responsável pelo cadastro do TotalSorte e confirme o e-mail, se exigido.
2. Copie o UUID do usuário em Authentication → Users.
3. No SQL Editor, execute com o UUID correto:

```sql
update public.profiles
set role = 'admin'
where id = 'UUID-DO-USUARIO-ADMIN';
```

Não crie uma opção de promover usuário a admin dentro da interface pública.

## Fluxos conectados

- Cadastro e login por e-mail/senha com Supabase Auth.
- Consulta de grupos, cotas próprias, saldo, extrato e saques; criação administrativa de grupos MIX.
- Reserva de cotas e abertura de pagamento via RPC transacional.
- Confirmação/recusa de pagamentos, processamento de saques e crédito de premiação somente por admin e via RPC auditada.
- O QR PIX e a conferência do pagamento continuam manuais; confira beneficiário e valor no banco antes de confirmar.

## Sincronizar resultados oficiais

O painel administrativo usa a Edge Function `sync-contests` para buscar, validar e salvar os últimos 15 concursos e as faixas oficiais de prêmio. Publique também `generate-group-games`, que usa esse histórico para montar 15 jogos de cada modalidade no grupo selecionado ou criar um novo grupo com os jogos. Com o Supabase CLI autenticado e o projeto correto vinculado, execute `supabase functions deploy sync-contests --no-verify-jwt` e `supabase functions deploy generate-group-games`. A função de sincronização verifica internamente a sessão e o perfil admin para chamadas manuais e exige um segredo para o cron; a geração exige JWT e perfil admin. A criação e os jogos são persistidos pela RPC transacional e ficam visíveis a clientes autenticados enquanto o grupo aceita participantes. Não configure nem exponha uma chave `service_role` no aplicativo.

## Atualização automática das estatísticas

1. Publique `sync-contests` com `supabase functions deploy sync-contests --no-verify-jwt`. A função valida internamente o JWT de admin para chamadas manuais e exige um segredo separado para chamadas agendadas.
2. Gere um segredo aleatório forte. Configure-o como segredo da Edge Function `CONTEST_SYNC_SECRET` e armazene o mesmo valor no Supabase Vault com o nome `totalsorte_contest_sync_secret`. Não coloque esse valor nos arquivos do app nem o compartilhe em mensagens.
3. Execute `schedule-contest-sync.sql` no SQL Editor do projeto. Ele agenda a busca dos resultados a cada 6 horas usando `pg_cron`, `pg_net` e Vault.
4. Execute uma sincronização manual no painel admin para carregar os dados iniciais. A tela Estatísticas lê os 15 concursos mais recentes de cada modalidade ao abrir, ao pressionar “Atualizar agora” e a cada 15 minutos enquanto estiver visível.

O agendamento roda no servidor mesmo quando nenhum usuário está com o app aberto. Se a CAIXA estiver indisponível, a última sincronização válida continua sendo exibida.

## Teste controlado

1. Sirva o site por HTTPS ou por um servidor local, por exemplo Live Server.
2. Crie duas contas participantes e uma conta admin.
3. Confirme isolamento: participante não deve ler dados privados de outro, nem alterar saldo, cotas, pagamentos, saques ou auditoria.
4. Teste reserva concorrente de cotas e tentativas de saque acima do saldo disponível.
5. Confira no extrato bancário qualquer PIX antes de confirmar e registre a transferência real antes de marcar um saque como pago.

## Ainda bloqueado

- Colocação automática de apostas na CAIXA. O admin ainda registra manualmente os números dos concursos e o valor pago depois de conferir as apostas oficiais.
- Upload seguro de comprovantes e notificações.
- Operação real exige revisão jurídica/regulatória, política de privacidade/LGPD, backups, monitoramento e testes de segurança independentes.

Os fluxos de resultados, jogos e rateio só ficam ativos depois de aplicar todas as migrações e publicar as duas Edge Functions. O crédito de prêmio exige prévia e confirmação administrativa. Não use dinheiro real até concluir as etapas pendentes e testar as políticas RLS com usuários distintos.
