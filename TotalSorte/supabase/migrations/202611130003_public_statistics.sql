grant select on public.contests to anon, authenticated;

drop policy if exists contests_read_public on public.contests;
create policy contests_read_public on public.contests
for select to anon, authenticated using (true);