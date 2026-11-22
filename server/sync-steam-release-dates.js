const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseSteamReleaseDate(value) {
  if (typeof value !== 'string') return null;

  const us = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(value.trim());
  const international = /^(\d{1,2}) ([A-Za-z]{3}),? (\d{4})$/.exec(value.trim());
  if (!us && !international) return null;

  const [, monthName, day, year] = us ?? [
    international[0], international[2], international[1], international[3],
  ];
  const month = months.indexOf(monthName) + 1;
  if (month === 0 || Number(year) < 1900) return null;

  const iso = [year, String(month).padStart(2, '0'), day.padStart(2, '0')].join('-');
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export async function syncSteamReleaseDates(supabase, fetchStore = fetch) {
  const { data: games, error } = await supabase
    .from('upcoming_game_recommendations')
    .select('slug,source_url,releases');
  if (error) throw new Error(error.message);

  const checked = new Set();
  for (const game of games) {
    if (checked.has(game.slug)) continue;
    const steamRelease = game.releases.find((release) => release.platform === 'Steam');
    const appId = /^https:\/\/store\.steampowered\.com\/app\/(\d+)(?:[/?#]|$)/.exec(game.source_url)?.[1];
    if (!steamRelease || steamRelease.release_date || !appId) continue;
    checked.add(game.slug);

    try {
      const url = new URL('https://store.steampowered.com/api/appdetails');
      url.search = new URLSearchParams({ appids: appId, filters: 'release_date', cc: 'KR', l: 'english' });
      const response = await fetchStore(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
      const payload = await response.json();
      const result = payload[appId];
      if (result?.success !== true) throw new Error('Steam did not return the app details');

      const releaseDate = parseSteamReleaseDate(result.data?.release_date?.date);
      if (!releaseDate) continue;

      const { error: updateError } = await supabase
        .from('upcoming_recommendation_releases')
        .update({ release_date: releaseDate, release_year: null })
        .eq('game_slug', game.slug)
        .eq('platform', 'Steam')
        .is('release_date', null);
      if (updateError) throw new Error(updateError.message);
    } catch (error) {
      console.warn('Steam release date check failed for', game.slug, error.message);
    }
  }
}

export function startSteamReleaseDateSync(supabase) {
  async function run() {
    try {
      await syncSteamReleaseDates(supabase);
    } catch (error) {
      console.warn('Steam release date sync failed:', error.message);
    } finally {
      setTimeout(run, ONE_DAY_MS).unref();
    }
  }

  void run();
}
