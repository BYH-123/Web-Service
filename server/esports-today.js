const dayMs = 86_400_000;
const koreaOffsetMs = 9 * 60 * 60 * 1000;
const gameNames = {
  'cs-go': 'CS2',
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
  let pending;

  async function collect(start) {
    const end = start + dayMs;
    const matches = new Map();
    for (let page = 1; ; page++) {
      const url = new URL('https://api.pandascore.co/matches');
      url.search = new URLSearchParams({
        'range[begin_at]': [start, end - 1000].map((time) => new Date(time).toISOString()).join(','),
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
        const game = gameNames[match.videogame?.slug];
        const startsAt = Date.parse(match.begin_at);
        if (typeof game !== 'string' || !Number.isInteger(match.id) ||
            !match.name || !(startsAt >= start && startsAt < end) ||
            ['canceled', 'postponed'].includes(match.status)) continue;

        const streams = Array.isArray(match.streams_list) ? match.streams_list : [];
        const stream = streams.find((entry) => entry.official && entry.language === 'ko' && httpsUrl(entry.raw_url))
          ?? streams.find((entry) => entry.official && httpsUrl(entry.raw_url));
        matches.set(match.id, {
          slug: `pandascore-${match.id}`,
          game,
          title: match.name,
          starts_at: new Date(startsAt).toISOString(),
          event_url: httpsUrl(match.league?.url),
          watch_url: httpsUrl(stream?.raw_url),
          kind: 'match',
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
    if (cachedDay === day) return pending;

    cachedDay = day;
    pending = collect(day).catch((error) => {
      console.warn('Esports daily schedule refresh failed:', error.message);
      return [];
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
