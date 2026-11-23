-- Supabase SQL Editor에서 전체 실행합니다.
-- global = 글로벌 이용자 기준, kr = 국내 이용자 기준입니다.
-- 각 그룹의 1~2번은 기대작, 3번은 6개월 이내 출시 예정작입니다.

begin;

create table if not exists public.upcoming_recommendation_games (
    slug text primary key,
    title text not null check (btrim(title) <> ''),
    source_url text not null check (source_url like 'https://%')
);

create table if not exists public.upcoming_recommendation_releases (
    game_slug text not null references public.upcoming_recommendation_games (slug)
        on delete cascade,
    platform text not null check (btrim(platform) <> ''),
    release_date date,
    release_year integer check (release_year between 1900 and 9999),
    primary key (game_slug, platform),
    check (release_date is null or release_year is null)
);

create table if not exists public.upcoming_recommendation_slots (
    audience text not null check (audience in ('global', 'kr')),
    slot smallint not null check (slot between 1 and 3),
    game_slug text not null references public.upcoming_recommendation_games (slug),
    primary key (audience, slot),
    unique (audience, game_slug)
);

insert into public.upcoming_recommendation_games (slug, title, source_url)
values
    ('deadlock', 'Deadlock', 'https://store.steampowered.com/app/1422450/Deadlock/'),
    ('dear-passengers', 'Dear Passengers', 'https://store.steampowered.com/app/4534960/Dear_Passengers/'),
    ('fable', 'Fable', 'https://store.steampowered.com/app/2769570/Fable/'),
    ('nakwon', '낙원: LAST PARADISE', 'https://store.steampowered.com/app/2582960/'),
    ('vindictus-defying-fate', '빈딕투스: 디파잉 페이트', 'https://store.steampowered.com/app/2814860/'),
    ('dragon-quest-monsters-4', 'DRAGON QUEST MONSTERS 4', 'https://www.square-enix.com/asia/newsportal/en/topics/dragonquest-monsters4/post02.html')
on conflict (slug) do nothing;

insert into public.upcoming_recommendation_releases
    (game_slug, platform, release_date, release_year)
values
    ('deadlock', 'Steam', null, null),
    ('dear-passengers', 'Steam', null, 2026),
    ('fable', 'Steam', date '2027-02-23', null),
    ('nakwon', 'Steam', null, null),
    ('vindictus-defying-fate', 'Steam', null, 2027),
    ('dragon-quest-monsters-4', 'Nintendo Switch', date '2026-12-03', null),
    ('dragon-quest-monsters-4', 'Nintendo Switch 2', date '2026-12-03', null),
    ('dragon-quest-monsters-4', 'PS5', date '2026-12-03', null),
    ('dragon-quest-monsters-4', 'Xbox Series X|S', date '2026-12-03', null),
    ('dragon-quest-monsters-4', 'Xbox on PC', date '2026-12-03', null),
    ('dragon-quest-monsters-4', 'Steam', date '2026-12-04', null)
on conflict (game_slug, platform) do nothing;

insert into public.upcoming_recommendation_slots (audience, slot, game_slug)
values
    ('global', 1, 'deadlock'),
    ('global', 2, 'dear-passengers'),
    ('global', 3, 'fable'),
    ('kr', 1, 'nakwon'),
    ('kr', 2, 'vindictus-defying-fate'),
    ('kr', 3, 'dragon-quest-monsters-4')
on conflict (audience, slot) do nothing;

alter table public.upcoming_recommendation_games enable row level security;
alter table public.upcoming_recommendation_releases enable row level security;
alter table public.upcoming_recommendation_slots enable row level security;

drop policy if exists public_read on public.upcoming_recommendation_games;
create policy public_read on public.upcoming_recommendation_games
    for select to anon, authenticated using (true);
drop policy if exists public_read on public.upcoming_recommendation_releases;
create policy public_read on public.upcoming_recommendation_releases
    for select to anon, authenticated using (true);
drop policy if exists public_read on public.upcoming_recommendation_slots;
create policy public_read on public.upcoming_recommendation_slots
    for select to anon, authenticated using (true);

create or replace view public.upcoming_game_recommendations
with (security_invoker = true) as
select
    s.audience,
    s.slot,
    case when s.slot = 3 then 'near_release' else 'anticipated' end as category,
    g.slug,
    g.title,
    g.source_url,
    coalesce(
        jsonb_agg(
            jsonb_build_object(
                'platform', r.platform,
                'release_date', r.release_date,
                'release_year', r.release_year,
                'date_precision', case
                    when r.release_date is not null then 'day'
                    when r.release_year is not null then 'year'
                    else 'tba'
                end
            )
            order by r.release_date nulls last, r.platform
        ) filter (where r.platform is not null),
        '[]'::jsonb
    ) as releases
from public.upcoming_recommendation_slots s
join public.upcoming_recommendation_games g on g.slug = s.game_slug
left join public.upcoming_recommendation_releases r on r.game_slug = g.slug
group by s.audience, s.slot, g.slug, g.title, g.source_url
having s.slot <> 3 or min(r.release_date) between
    (now() at time zone 'Asia/Seoul')::date
    and ((now() at time zone 'Asia/Seoul')::date + interval '6 months')::date;

revoke all on public.upcoming_recommendation_games,
    public.upcoming_recommendation_releases, public.upcoming_recommendation_slots,
    public.upcoming_game_recommendations from public, anon, authenticated;

grant select on public.upcoming_recommendation_games,
    public.upcoming_recommendation_releases, public.upcoming_recommendation_slots,
    public.upcoming_game_recommendations to anon, authenticated, service_role;

-- 서버의 Steam 출시일 동기화에 필요한 쓰기 권한입니다.
grant update (release_date, release_year)
    on public.upcoming_recommendation_releases to service_role;

notify pgrst, 'reload schema';
commit;

-- 확인용 조회입니다. 화면에서는 audience를 필터링하고 slot으로 정렬합니다.
select audience, slot, category, title, releases, source_url
from public.upcoming_game_recommendations
order by audience, slot;
