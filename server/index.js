import { createGameNewsCache } from './game-news.js';
import express from 'express';
import { getSteamDeals } from './steam-deals.js';
import { createClient } from '@supabase/supabase-js';
import { startSteamReleaseDateSync } from './sync-steam-release-dates.js';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PORT = 3000 } = process.env;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
const gameNews = createGameNewsCache();

app.get('/api/upcoming-games', async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  const { data, error } = await supabase
    .from('upcoming_game_recommendations')
    .select('audience,slot,category,slug,title,releases,source_url')
    .order('audience')
    .order('slot');

  if (error) {
    console.error('Upcoming games query failed:', error.message);
    return response.status(502).json({ error: '출시 예정 게임을 불러오지 못했습니다.' });
  }

  return response.json(data.map((game) => ({
    ...game,
    platforms: game.releases.map((release) => release.platform),
    release_date: game.releases.find((release) => release.release_date)?.release_date ?? null,
  })));
});

app.get('/api/deals', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const { data, error } = await supabase
    .from('game_deals')
    .select('store,product_id,title,offer_type,original_price,sale_price,discount_percent,ends_at,checked_at,product_url')
    .order('discount_percent', { ascending: false, nullsFirst: false })
    .order('title', { ascending: true })
    .order('store', { ascending: true })
    .order('product_id', { ascending: true })
    .order('offer_type', { ascending: true });

  if (error) {
    console.error('Deals query failed:', error.message);
    return response.status(502).json({ error: '할인 목록을 불러오지 못했습니다.' });
  }

  if (request.query.catalog !== '1') return response.json(data);

  const otherDeals = data.filter((deal) => deal.store !== 'steam');
  try {
    const steamDeals = await getSteamDeals();
    return response.json({ deals: [...steamDeals, ...otherDeals], steamUnavailable: false });
  } catch (steamError) {
    console.warn('Steam discounts lookup failed:', steamError.message);
    return response.json({ deals: otherDeals, steamUnavailable: true });
  }
});

app.get('/api/news', async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  const latest = await gameNews.getArticles();
  if (latest) return response.json(latest);

  const { data, error } = await supabase
    .from('industry_news')
    .select('title,summary,category,source_name,source_url,published_at')
    .order('published_at', { ascending: false })
    .order('source_url')
    .limit(10);

  if (error) {
    console.error('Industry news query failed:', error.message);
    return response.status(502).json({ error: '게임 산업 뉴스를 불러오지 못했습니다.' });
  }

  return response.json(data);
});

app.get('/api/esports-events', async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  const { data, error } = await supabase
    .from('esports_events')
    .select('slug,game,title,starts_at,event_url,watch_url')
    .not('featured_order', 'is', null)
    .order('featured_order')
    .limit(3);

  if (error) {
    console.error('Esports query failed:', error.message);
    return response.status(502).json({ error: '대회 목록을 불러오지 못했습니다.' });
  }

  return response.json(data);
});

app.listen(Number(PORT), () => {
  console.log(`API listening on http://localhost:${PORT}`);
  gameNews.start();
  const { SUPABASE_RELEASE_SYNC_SECRET_KEY } = process.env;
  if (SUPABASE_RELEASE_SYNC_SECRET_KEY) {
    const releaseSyncClient = createClient(SUPABASE_URL, SUPABASE_RELEASE_SYNC_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    startSteamReleaseDateSync(releaseSyncClient);
  }
});
