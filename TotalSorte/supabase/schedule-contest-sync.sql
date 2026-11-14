create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'totalsorte-sync-contests-6h';

select cron.schedule(
  'totalsorte-sync-contests-6h',
  '0 */6 * * *',
  $$
    select net.http_post(
      url := 'https://ulpwwkzgitraxgqcjatc.supabase.co/functions/v1/sync-contests',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'totalsorte_contest_sync_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $$
);