import express from 'express';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PORT = 3000 } = process.env;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();

app.get('/api/upcoming-games', async (_request, response) => {
  const { data, error } = await supabase
    .from('upcoming_games_test')
    .select('slug,title,platforms,release_date,source_url')
    .order('release_date', { ascending: true, nullsFirst: false })
    .order('title', { ascending: true });

  if (error) {
    console.error('Upcoming games query failed:', error.message);
    return response.status(502).json({ error: '출시 예정 게임을 불러오지 못했습니다.' });
  }

  return response.json(data);
});

app.get('/api/deals', async (_request, response) => {
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

  return response.json(data);
});

app.get('/api/news', async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  const { data, error } = await supabase
    .from('industry_news')
    .select('title,summary,category,source_name,source_url,published_at')
    .not('hot_pick_order', 'is', null)
    .order('hot_pick_order', { ascending: true })
    .order('published_at', { ascending: false })
    .order('source_url')
    .limit(5);

  if (error) {
    console.error('Industry news query failed:', error.message);
    return response.status(502).json({ error: '게임 산업 뉴스를 불러오지 못했습니다.' });
  }

  return response.json(data);
});

app.listen(Number(PORT), () => console.log(`API listening on http://localhost:${PORT}`));
