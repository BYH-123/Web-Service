const dayMs = 86_400_000;
const koreaOffsetMs = 9 * 60 * 60 * 1000;
const gameNames = new Map([
  ['cs-go', 'CS2'], ['counter-strike', 'CS2'], ['counter-strike-2', 'CS2'], ['cs2', 'CS2'],
  ['lol', '리그 오브 레전드'], ['league-of-legends', '리그 오브 레전드'],
  ['valorant', '발로란트'], ['pubg', '배틀그라운드'],
  ['overwatch', '오버워치'], ['overwatch-2', '오버워치'], ['ow', '오버워치'],
  ['eternal-return', '이터널 리턴'],
  ['dota-2', '도타 2'], ['dota2', '도타 2'], ['rocket-league', '로켓 리그'], ['rl', '로켓 리그'],
]);

function koreaDayStart(time) {
  return Math.floor((time + koreaOffsetMs) / dayMs) * dayMs - koreaOffsetMs;
}

function httpsUrl(value) {
  const url = typeof value === 'string' ? URL.parse(value) : null;
  return url?.protocol === 'https:' && !url.username && !url.password ? url.href : null;
}

export function createTodayMatches(token, fetchMatches = fetch, now = Date.now) {
  const schedule = { day: null, until: 0, promise: null };
  const live = { day: null, until: 0, promise: null };
  let rateLimitedUntil = 0;

  async function collect(start, running) {
    const end = start + dayMs;
    const matches = [];
    for (let page = 1; page <= 10; page++) {
      if (now() < rateLimitedUntil) throw new Error('PandaScore is rate limited');
      const url = new URL(running ? 'https://api.pandascore.co/matches/running' : 'https://api.pandascore.co/matches');
      url.search = new URLSearchParams({
        ...(running ? {} : { 'range[scheduled_at]': [start, end - 1].map(time => new Date(time).toISOString()).join(',') }),
        'page[number]': String(page),
        'page[size]': '100',
        sort: 'scheduled_at,id',
      });
      const response = await fetchMatches(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now();
        rateLimitedUntil = Math.max(rateLimitedUntil, now() + (delay > 0 ? delay : 60_000));
      }
      if (!response.ok) throw new Error(`PandaScore HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid PandaScore match list');

      // A successful response can supply live status even when the running endpoint is delayed.
      for (const match of rows) {
        const game = gameNames.get(match.videogame?.slug) ?? (match.videogame?.id === 3 ? 'CS2' : undefined);
        const startsAt = Date.parse(match.scheduled_at ?? match.begin_at);
        if (!game || !Number.isInteger(match.id) || !match.name || !Number.isFinite(startsAt) ||
            (!running && (startsAt < start || startsAt >= end)) || ['canceled', 'postponed'].includes(match.status)) continue;
        const streams = Array.isArray(match.streams_list) ? match.streams_list : [];
        const channels = streams.filter(entry => httpsUrl(entry?.raw_url))
          .sort((a, b) => Number(!!b.official) - Number(!!a.official) || Number(b.language === 'ko') - Number(a.language === 'ko'));
        const urls = [...new Set(channels.map(entry => httpsUrl(entry.raw_url)))];
        matches.push({
          slug: `pandascore-${match.id}`,
          game,
          title: match.name,
          starts_at: new Date(startsAt).toISOString(),
          league: match.league?.name ?? null,
          series: match.serie?.full_name ?? null,
          event_url: httpsUrl(match.league?.url),
          watch_url: urls[0] ?? null,
          streams: urls,
          kind: 'match',
          status: running ? 'running' : match.status,
          live: running,
        });
      }
      if (rows.length < 100) return matches;
    }
    throw new Error('PandaScore match list exceeded ten pages');
  }

  function cached(cache, day, interval, running) {
    if (cache.day === day && cache.promise) return cache.promise;
    if (cache.day === day && now() < cache.until) return Promise.resolve(cache.data);
    cache.day = day;
    const request = collect(day, running).then(data => {
      if (cache.promise === request) {
        cache.until = now() + interval;
        cache.data = { data, ok: true };
      }
      return { data, ok: true };
    }).catch(error => {
      console.warn('Esports lookup unavailable:', error.message);
      const result = { data: [], ok: false };
      if (cache.promise === request) {
        cache.until = Math.max(now() + 30_000, rateLimitedUntil);
        cache.data = result;
      }
      return result;
    }).finally(() => {
      if (cache.promise === request) cache.promise = null;
    });
    cache.promise = request;
    return request;
  }

  async function getSnapshot() {
    if (!token) return { matches: [], scheduleAvailable: false, liveAvailable: false };
    const day = koreaDayStart(now());
    const [scheduled, running] = await Promise.all([
      cached(schedule, day, 5 * 60_000, false),
      cached(live, day, 30_000, true),
    ]);
    const matches = new Map(scheduled.data.map(match => [match.slug, {
      ...match,
      live: match.status === 'running' && !running.ok,
    }]));
    for (const match of running.data) {
      const previous = matches.get(match.slug);
      const streams = [...new Set([...match.streams, ...(previous?.streams ?? [])])];
      matches.set(match.slug, { ...match, streams, watch_url: streams[0] ?? null });
    }
    return {
      matches: [...matches.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      scheduleAvailable: scheduled.ok,
      liveAvailable: running.ok,
    };
  }

  return { getSnapshot };
}
