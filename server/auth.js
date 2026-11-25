import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import pg from 'pg';

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
  const pool = new pg.Pool({
    connectionString: env.AUTH_DATABASE_URL,
    onConnect: async (client) => {
      await client.query('SET search_path TO game_auth');
    },
  });
  pool.on('error', () => console.error('회원 DB 연결이 종료되었습니다.'));
  const auth = betterAuth({
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    advanced: { ipAddress: { ipAddressHeaders: ['x-game-client-ip'] } },
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    account: { accountLinking: { enabled: false } },
    rateLimit: { enabled: true },
    socialProviders,
  });
  app.all('/api/auth/*splat', toNodeHandler(auth));
}
