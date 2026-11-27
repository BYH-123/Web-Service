import { betterAuth } from 'better-auth';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import express from 'express';
import pg from 'pg';

const sessionSeconds = 60 * 60;

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
    return;
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
  app.use(preferences, async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return res.sendStatus(401);
    res.locals.member = session.user.id;
    next();
  });
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
}
