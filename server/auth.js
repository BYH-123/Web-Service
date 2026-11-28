import { betterAuth } from 'better-auth';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import express from 'express';
import pg from 'pg';
import { mountAdmin } from './admin-content.js';

const sessionSeconds = 60 * 60;
const esportsPreferences = '/api/me/esports';
const esportsGames = ['CS2', '리그 오브 레전드', '발로란트', '배틀그라운드'];
const selectableEsportsGames = [...esportsGames, '오버워치', '이터널 리턴', '도타 2', '로켓 리그'];
const broadcastUrl = /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]{11}|chzzk\.naver\.com\/(?:live\/[a-f0-9]{32}\/?|video\/\d+\/?|clips\/[\w-]+))$/i;
const youtubeChannelPath = /^\/(?:@(?:[\w.-]|%[\da-f]{2})+|(?:channel|c|user)\/[\w.-]+)(?:\/(?:live|streams))?$/i;

function parseEsportsPreferences(body) {
  const { games, slots } = body ?? {};
  if (!Array.isArray(games) || games.length > esportsGames.length ||
      !games.every(game => esportsGames.includes(game)) || !Array.isArray(slots) || slots.length !== 3) return null;
  const normalized = [];
  const used = new Set();
  for (const slot of slots) {
    if (slot === null) {
      normalized.push(null);
      continue;
    }
    const { match, title, url } = slot ?? {};
    const key = typeof match === 'string' && /^pandascore-[1-9]\d{0,15}$/.test(match) ? match
      : typeof url === 'string' && url.length <= 500 && broadcastUrl.test(url) &&
        typeof title === 'string' && title.trim() && title.length <= 120 ? url : null;
    if (!key || used.has(key)) return null;
    used.add(key);
    normalized.push(key === match ? { match } : { title: title.trim(), url });
  }
  return { games: [...new Set(games)], slots: normalized };
}

export function mountAuth(app) {
  const env = process.env;
  const baseURL = env.BETTER_AUTH_URL || 'http://localhost:5173';
  app.use('/api/auth', (req, res, next) => {
    req.headers['x-game-client-ip'] = req.ip;
    res.set('Cache-Control', 'no-store');
    next();
  });

  if (!env.AUTH_DATABASE_URL || !env.BETTER_AUTH_SECRET) {
    app.use('/api/auth', (_req, res) => res.status(503).json({ message: '회원 기능 설정이 필요합니다.' }));
    app.use(esportsPreferences, (_req, res) => res.sendStatus(503));
    return async (_section, rows) => rows;
  }

  const socialProviders = {};
  for (const provider of ['google', 'naver']) {
    const key = provider.toUpperCase();
    const clientId = env[key + '_CLIENT_ID'];
    const clientSecret = env[key + '_CLIENT_SECRET'];
    if (clientId && clientSecret) socialProviders[provider] = { clientId, clientSecret };
  }
  let existingSessionsCapped = false;
  const pool = new pg.Pool({
    connectionString: env.AUTH_DATABASE_URL,
    onConnect: async (client) => {
      await client.query('SET search_path TO game_auth');
      if (!existingSessionsCapped) {
        await client.query(`UPDATE game_auth.session
          SET "expiresAt" = "createdAt" + interval '1 hour'
          WHERE "expiresAt" > "createdAt" + interval '1 hour'`);
        existingSessionsCapped = true;
      }
    },
  });
  pool.on('error', () => console.error('회원 DB 연결이 종료되었습니다.'));
  const auth = betterAuth({
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    session: { expiresIn: sessionSeconds, disableSessionRefresh: true },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: {
              ...session,
              expiresAt: new Date(Math.min(session.expiresAt.getTime(), session.createdAt.getTime() + sessionSeconds * 1000)),
            },
          }),
        },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['x-game-client-ip'] } },
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    account: { accountLinking: { enabled: false } },
    rateLimit: { enabled: true },
    socialProviders,
  });
  const preferences = '/api/me/upcoming-games';
  const requireMember = async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return res.sendStatus(401);
    res.locals.member = session.user.id;
    next();
  };
  const applyEdits = mountAdmin(app, pool, requireMember);
  app.use([preferences, esportsPreferences], requireMember);
  app.get(preferences, async (_req, res) => {
    const result = await pool.query('select cards from game_auth.upcoming_preferences where user_id=$1', [res.locals.member]);
    res.json(result.rows[0]?.cards ?? {});
  });
  app.put(preferences + '/:card', express.json({limit:'8kb'}), async (req, res) => {
    const key = req.params.card;
    if (!/^(?:(?:global|kr)-[123]|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(key)) return res.sendStatus(400);
    const { title, date, link, reset } = req.body ?? {};
    if (reset === true) {
      await pool.query('update game_auth.upcoming_preferences set cards=cards-$2::text where user_id=$1', [res.locals.member,key]);
      return res.sendStatus(204);
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
        typeof date !== 'string' || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
        (date && (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) ||
        typeof link !== 'string' || link.length > 2048 || (link && (!URL.canParse(link) || new URL(link).protocol !== 'https:'))) return res.sendStatus(400);
    const card = {title:title.trim(),date,link};
    const result = await pool.query(`insert into game_auth.upcoming_preferences as p(user_id,cards)
      values ($1,jsonb_build_object($2::text,$3::jsonb))
      on conflict(user_id) do update set cards=p.cards || excluded.cards
      where p.cards ? $2 or (select count(*) from jsonb_object_keys(p.cards)) < 5`, [res.locals.member,key,JSON.stringify(card)]);
    if (!result.rowCount) return res.sendStatus(409);
    res.json(card);
  });
  app.get(esportsPreferences, async (_req, res) => {
    const result = await pool.query('select settings from game_auth.esports_preferences where user_id=$1', [res.locals.member]);
    res.json(result.rows[0]?.settings ?? { games: [], slots: [null, null, null] });
  });
  app.put(esportsPreferences, express.json({ limit: '8kb' }), async (req, res) => {
    const settings = parseEsportsPreferences(req.body);
    if (!settings) return res.sendStatus(400);
    await pool.query(`insert into game_auth.esports_preferences as p (user_id, settings)
      values ($1, $2::jsonb) on conflict (user_id) do update set settings = p.settings || excluded.settings`,
    [res.locals.member, JSON.stringify(settings)]);
    res.json(settings);
  });
  app.put(esportsPreferences + '/selection', express.json({ limit: '8kb' }), async (req, res) => {
    const { selectedGames } = req.body ?? {};
    if (!Array.isArray(selectedGames) || selectedGames.length > 3 ||
        selectedGames.some(game => typeof game !== 'string') || new Set(selectedGames).size !== selectedGames.length) {
      return res.sendStatus(400);
    }
    const member = res.locals.member;
    const result = await pool.query('select settings from game_auth.esports_preferences where user_id=$1', [member]);
    const settings = result.rows[0]?.settings;
    const available = new Set(selectableEsportsGames);
    for (const key of Object.keys(settings?.customGames ?? {})) available.add('custom:' + key);
    for (const slot of settings?.slots ?? []) {
      if (slot?.url) available.add('custom:' + slot.title.trim().normalize('NFKC').toLowerCase());
    }
    if (!selectedGames.every(game => available.has(game))) return res.sendStatus(400);
    await pool.query(`insert into game_auth.esports_preferences as p (user_id, settings)
      values ($1, jsonb_build_object('selectedGames', $2::jsonb))
      on conflict (user_id) do update set settings = p.settings || excluded.settings`,
    [member, JSON.stringify(selectedGames)]);
    res.json({ selectedGames });
  });
  app.post(esportsPreferences + '/games', express.json({ limit: '2kb' }), async (req, res) => {
    const { name, url } = req.body ?? {};
    const parsed = typeof url === 'string' && url.length <= 500 ? URL.parse(url) : null;
    if (typeof name !== 'string' || !name.trim() || name.length > 80 ||
        !parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !(broadcastUrl.test(parsed.href) || (parsed.hostname === 'www.youtube.com' &&
          !parsed.search && !parsed.hash && youtubeChannelPath.test(parsed.pathname)))) return res.sendStatus(400);
    const game = { name: name.trim(), url: parsed.href };
    const key = game.name.normalize('NFKC').toLowerCase();
    const result = await pool.query(`insert into game_auth.esports_preferences as p (user_id, settings)
      values ($1, jsonb_build_object('customGames', jsonb_build_object($2::text, $3::jsonb)))
      on conflict (user_id) do update set settings = jsonb_set(p.settings, '{customGames}',
        coalesce(p.settings->'customGames', '{}'::jsonb) || (excluded.settings->'customGames'))
      where not coalesce(p.settings->'customGames', '{}'::jsonb) ? $2
      returning settings->'customGames' as games`,
    [res.locals.member, key, JSON.stringify(game)]);
    if (!result.rowCount) return res.sendStatus(409);
    res.json(result.rows[0].games);
  });
  app.all('/api/auth/*splat', toNodeHandler(async (request) => {
    const response = await auth.handler(request);
    const cookies = response.headers.getSetCookie();
    if (!cookies.length) return response;
    const headers = new Headers(response.headers);
    headers.delete('set-cookie');
    for (let cookie of cookies) {
      // Leave expired logout cookies intact so the browser removes them immediately.
      if (/^(?:__Secure-)?better-auth\.session_token=[^;]/.test(cookie)) {
        cookie = cookie.replace(/;\s*(?:Max-Age|Expires)=[^;]*/gi, '');
      }
      headers.append('set-cookie', cookie);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }));
  return applyEdits;
}
