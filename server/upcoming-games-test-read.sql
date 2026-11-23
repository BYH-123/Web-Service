begin;

alter table public.upcoming_games_test enable row level security;
revoke all on public.upcoming_games_test from public, anon, authenticated;
grant select on public.upcoming_games_test to anon;

drop policy if exists "Read upcoming games test" on public.upcoming_games_test;
create policy "Read upcoming games test"
  on public.upcoming_games_test
  for select to anon
  using (true);

commit;
