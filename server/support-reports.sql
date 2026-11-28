begin;
create table if not exists game_auth.support_reports (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  category text not null check (category in ('image','issue','question')),
  section text not null check (section in ('general','upcoming','deals','esports','news')),
  item_id text,
  item_title text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','working','done')),
  created_at timestamptz not null default now()
);
alter table game_auth.support_reports enable row level security;
revoke all on game_auth.support_reports from public, anon, authenticated;
commit;