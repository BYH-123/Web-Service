const dayMs = 86_400_000;
const koreaOffsetMs = 9 * 60 * 60 * 1000;
const gameNames = {
  'cs-go': 'CS2',
  'counter-strike': 'CS2',
  'counter-strike-2': 'CS2',
  cs2: 'CS2',
  lol: '리그 오브 레전드',
  'league-of-legends': '리그 오브 레전드',
  pubg: '배틀그라운드',
};

function koreaDayStart(time) {
  return Math.floor((time + koreaOffsetMs) / dayMs) * dayMs - koreaOffsetMs;
}

function httpsUrl(value) {
  const url = typeof value === 'string' ? URL.parse(value) : null;
  return url?.protocol === 'https:' ? url.href : null;
}

export function createTodayMatches(token, fetchMatches = fetch, now = Date.now) {
  let cachedDay;
  let nextRefresh = 0;
  let pending;

  async function collect(start, running) {
    const end = start + dayMs;
    const matches = new Map();
    for (let page = 1; ; page++) {
      const url = new URL(running ? 'https://api.pandascore.co/matches/running' : 'https://api.pandascore.co/matches');
      url.search = new URLSearchParams({
        ...(running ? {} : { 'range[begin_at]': [start, end - 1000].map((time) => new Date(time).toISOString()).join(',') }),
        'page[number]': String(page),
        'page[size]': '100',
        sort: 'begin_at,id',
      });
      const response = await fetchMatches(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`PandaScore HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid PandaScore match list');

      for (const match of rows) {
        const game = gameNames[match.videogame?.slug] ?? (match.videogame?.id === 3 ? 'CS2' : undefined);
        const startsAt = Date.parse(match.begin_at ?? match.scheduled_at);
        if (typeof game !== 'string' || !Number.isInteger(match.id) ||
            !match.name || !Number.isFinite(startsAt) || (!running && !(startsAt >= start && startsAt < end)) ||
            ['canceled', 'postponed'].includes(match.status)) continue;

        const streams = Array.isArray(match.streams_list) ? match.streams_list : [];
        const channels = streams.filter(entry => httpsUrl(entry?.raw_url))
          .sort((a, b) => Number(!!b.official) - Number(!!a.official) || Number(b.language === 'ko') - Number(a.language === 'ko'));
        const urls = [...new Set(channels.map(entry => entry.raw_url))];
        matches.set(match.id, {
          slug: `pandascore-${match.id}`,
          game,
          title: match.name,
          starts_at: new Date(startsAt).toISOString(),
          event_url: httpsUrl(match.league?.url),
          watch_url: urls[0] ?? null,
          streams: urls,
          kind: 'match',
          live: running || match.status === 'running',
        });
      }
      if (rows.length < 100) break;
      if (page === 10) throw new Error('PandaScore daily match list exceeded ten pages');
    }

    return [...matches.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  async function getMatches() {
    if (!token) return [];
    const day = koreaDayStart(now());
    if (cachedDay === day && now() < nextRefresh) return pending;

    cachedDay = day;
    nextRefresh = now() + 60_000;
    pending = Promise.allSettled([collect(day, false), collect(day, true)]).then(results => {
      const matches = new Map();
      for (const result of results) {
        if (result.status === 'rejected') { console.warn('Esports schedule unavailable:', result.reason.message); continue; }
        for (const match of result.value) {
          const previous = matches.get(match.slug);
          if (previous) {
            match.streams = [...new Set([...match.streams, ...previous.streams])];
            match.watch_url = match.streams[0] ?? null;
          }
          matches.set(match.slug, match);
        }
      }
      return [...matches.values()].sort((a,b) => a.starts_at.localeCompare(b.starts_at));
    });
    return pending;
  }

  function start() {
    if (!token) return;
    void getMatches();
    function schedule() {
      const time = now();
      setTimeout(() => {
        void getMatches();
        schedule();
      }, koreaDayStart(time) + dayMs - time).unref();
    }
    schedule();
  }

  return { getMatches, start };
}
