begin;

-- Use a private schema outside the Supabase Data API exposed schemas.
create schema if not exists game_auth;
revoke all on schema game_auth from public, anon, authenticated;
set local search_path = game_auth;

create table if not exists "user" (
  id text primary key, name text not null, email text not null unique,
  "emailVerified" boolean not null default false, image text,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create table if not exists session (
  id text primary key, token text not null unique, "expiresAt" timestamptz not null,
  "userId" text not null references "user"(id) on delete cascade,
  "ipAddress" text, "userAgent" text,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create index if not exists session_user_idx on session ("userId");
create table if not exists account (
  id text primary key, "providerId" text not null, "accountId" text not null,
  "userId" text not null references "user"(id) on delete cascade,
  password text, scope text, "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
  unique ("providerId", "accountId")
);
create index if not exists account_user_idx on account ("userId");
create table if not exists verification (
  id text primary key, identifier text not null, value text not null, "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create index if not exists verification_identifier_idx on verification (identifier);
revoke all on all tables in schema game_auth from public, anon, authenticated;
create table if not exists game_auth.upcoming_preferences (
  user_id text primary key references game_auth."user"(id) on delete cascade,
  cards jsonb not null default '{}'
);
revoke all on game_auth.upcoming_preferences from public, anon, authenticated;
create table if not exists game_auth.esports_preferences (
  user_id text primary key references game_auth."user"(id) on delete cascade,
  settings jsonb not null
);
revoke all on game_auth.esports_preferences from public, anon, authenticated;
create table if not exists game_auth.content_edits (
  section text not null,
  item_id text not null,
  patch jsonb not null,
  primary key (section, item_id)
);
revoke all on game_auth.content_edits from public, anon, authenticated;
alter table game_auth.content_edits enable row level security;
commit;