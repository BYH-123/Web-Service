begin;

create table if not exists public.game_deals (
  store text not null check (store in ('steam', 'epic', 'microsoft', 'battle_net', 'ea')),
  product_id text not null,
  title text not null,
  offer_type text not null check (offer_type in ('discount', 'giveaway', 'free_play')),
  original_price integer check (original_price > 0),
  sale_price integer check (sale_price >= 0),
  discount_percent integer check (discount_percent between 1 and 100),
  ends_at timestamptz,
  checked_at timestamptz,
  product_url text not null check (product_url like 'https://%'),
  is_active boolean not null default true,
  primary key (store, product_id, offer_type),
  check (sale_price is null or original_price is null or sale_price <= original_price)
);

-- Expand the store constraint on databases created before Microsoft Store and EA were added.
alter table public.game_deals drop constraint if exists game_deals_store_check;
alter table public.game_deals add constraint game_deals_store_check
  check (store in ('steam', 'epic', 'microsoft', 'battle_net', 'ea'));

alter table public.game_deals enable row level security;
revoke all on public.game_deals from public, anon, authenticated;
grant select on public.game_deals to anon, authenticated;

drop policy if exists "Read active deals" on public.game_deals;
create policy "Read active deals" on public.game_deals
  for select to anon, authenticated
  using (is_active and (ends_at is null or ends_at > now()));

-- Steam: Korean store snapshot recorded on 2026-11-21 05:04 KST.
-- https://wikidocs.net/blog/@wondergrid/37897/
-- Epic: official product listing, which gives the end time in UTC.
insert into public.game_deals
  (store, product_id, title, offer_type, original_price, sale_price,
   discount_percent, ends_at, checked_at, product_url)
values
  ('steam', '1222680', '니드 포 스피드 히트', 'discount', 77000, 3850, 95, '2026-12-04 03:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/1222680/'),
  ('steam', '1238840', '배틀필드 1', 'discount', 44000, 2200, 95, '2026-12-04 03:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/1238840/'),
  ('steam', '413410', '단간론파: 희망의 학원과 절망의 고교생', 'discount', 21000, 2100, 90, '2026-11-25 02:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/413410/'),
  ('steam', '35450', 'Red Orchestra 2: Heroes of Stalingrad with Rising Storm', 'discount', 21000, 2100, 90, '2026-11-25 23:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/35450/'),
  ('steam', '934700', '데드 아일랜드 2', 'discount', 70900, 7090, 90, '2026-12-04 02:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/934700/'),
  ('steam', '302670', 'Call to Arms', 'discount', 16500, 1650, 90, '2026-11-24 03:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/302670/'),
  ('steam', '2290180', '라이더스 리퍼블릭', 'discount', 45500, 4550, 90, '2026-12-03 02:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/2290180/'),
  ('steam', '1338770', 'Sniper Ghost Warrior Contracts 2', 'discount', 41000, 4100, 90, '2026-12-05 03:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/1338770/'),
  ('steam', '446800', 'Transport Fever', 'discount', 32000, 3200, 90, '2026-11-23 03:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/446800/'),
  ('steam', '2933080', '크라임 보스: 록케이 시티', 'discount', 21500, 2150, 90, '2026-12-01 03:00+09', '2026-11-21 05:04+09', 'https://store.steampowered.com/app/2933080/'),
  ('steam', '1158310', '크루세이더 킹즈 III', 'discount', 55000, 16500, 70, null, '2026-11-21 05:04+09', 'https://store.steampowered.com/app/1158310/'),
  ('epic', 'mark-of-the-deep-f7dc08', 'Mark of the Deep', 'giveaway', null, 0, 100, '2026-11-26 16:00+00', null, 'https://store.epicgames.com/p/mark-of-the-deep-f7dc08/?lang=ko')
on conflict (store, product_id, offer_type) do nothing;

commit;
