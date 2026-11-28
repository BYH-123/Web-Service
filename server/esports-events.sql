begin;

create table if not exists public.esports_events (
  slug text primary key,
  game text not null,
  title text not null,
  starts_at timestamptz not null,
  last_day date not null,
  event_url text not null check (event_url like 'https://%'),
  watch_url text check (watch_url like 'https://%'),
  featured_order integer unique check (featured_order > 0),
  check (last_day >= (starts_at at time zone 'Asia/Seoul')::date)
);

alter table public.esports_events enable row level security;
revoke all on public.esports_events from public, anon, authenticated;
grant select on public.esports_events to anon, authenticated;

drop policy if exists "Read featured esports events" on public.esports_events;
create policy "Read featured esports events" on public.esports_events
  for select to anon, authenticated
  using (featured_order is not null);

insert into public.esports_events
  (slug, game, title, starts_at, last_day, event_url, watch_url, featured_order)
values
  ('pgl-singapore-2026', 'CS2', 'PGL CS2 Major Singapore 2026',
   '2026-11-24 13:00+09', '2026-12-13',
   'https://www.pglesports.com/cs2/pgl-major-singapore-2026/', null, 1),
  ('red-bull-league-of-its-own-2026', '리그 오브 레전드', 'Red Bull League of Its Own 2026',
   '2026-12-05 23:00+09', '2026-12-06',
   'https://www.redbull.com/gb-en/events/red-bull-league-of-its-own', null, 2),
  ('pgc-2026', '배틀그라운드', 'PUBG Global Championship 2026',
   '2026-12-01 20:00+09', '2026-12-13',
   'https://pubgesports.com/ko/news/11316', 'https://pubgesports.com/ko/news/11316', 3)
on conflict do nothing;

commit;
