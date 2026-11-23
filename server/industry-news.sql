begin;

create table if not exists public.industry_news (
  source_url text primary key check (source_url like 'https://%'),
  title text not null,
  summary text not null,
  category text not null check (category in ('보안 사고', '정책·규제', '기업·산업')),
  source_name text not null,
  published_at timestamptz not null,
  hot_pick_order integer check (hot_pick_order > 0)
);

alter table public.industry_news enable row level security;
revoke all on public.industry_news from public, anon, authenticated;
grant select on public.industry_news to anon, authenticated;

drop policy if exists "Read published industry news" on public.industry_news;
create policy "Read published industry news" on public.industry_news
  for select to anon, authenticated using (published_at <= now());

insert into public.industry_news
  (source_url, title, summary, category, source_name, published_at, hot_pick_order)
values
  ('https://www.inven.co.kr/webzine/news/?news=323668',
   '넥슨 컨소시엄, AI 게임 등급분류 연구 공개',
   '넥슨이 이끄는 컨소시엄이 게임 콘텐츠 검토를 돕는 AI 연구의 1년차 성과를 발표했다. AI가 검토할 장면을 선별하고 최종 등급 판단은 사람이 맡는 방식이다.',
   '정책·규제', '인벤', '2026-11-20 23:46+09', 1),
  ('https://www.inven.co.kr/webzine/news/?news=323671',
   '엑솔라, 지스타에서 게임 웹샵 전략 소개',
   '엑솔라는 부산에서 열린 행사에서 모바일 결제 규제에 대응하는 방안과 게임사 웹샵 운영 전략을 소개했다.',
   '기업·산업', '인벤', '2026-11-21 03:45+09', 2)
on conflict (source_url) do nothing;

commit;
