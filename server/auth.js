import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
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
  app.all('/api/auth/*splat', toNodeHandler(auth));
}
