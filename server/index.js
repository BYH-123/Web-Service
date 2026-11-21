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

app.listen(Number(PORT), () => console.log(`API listening on http://localhost:${PORT}`));
