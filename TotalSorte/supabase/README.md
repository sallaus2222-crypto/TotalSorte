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

## Teste controlado

1. Sirva o site por HTTPS ou por um servidor local, por exemplo Live Server.
2. Crie duas contas participantes e uma conta admin.
3. Confirme isolamento: participante não deve ler dados privados de outro, nem alterar saldo, cotas, pagamentos, saques ou auditoria.
4. Teste reserva concorrente de cotas e tentativas de saque acima do saldo disponível.
5. Confira no extrato bancário qualquer PIX antes de confirmar e registre a transferência real antes de marcar um saque como pago.

## Ainda bloqueado

- Integração backend para buscar/validar resultados oficiais, gerar e persistir jogos definitivos.
- Registro definitivo das apostas e painel para criar/gerenciar grupos.
- Upload seguro de comprovantes e notificações.
- Operação real exige revisão jurídica/regulatória, política de privacidade/LGPD, backups, monitoramento e testes de segurança independentes.

Não use dinheiro real até concluir essas etapas e testar as políticas RLS com usuários distintos.
