import { load } from 'cheerio';

const feedUrl = 'https://feeds.feedburner.com/inven';
const refreshInterval = 24 * 60 * 60 * 1000;
const newsLimit = 10;

export function createGameNewsCache(fetchFeed = fetch, now = Date.now) {
  let articles = null;
  let nextRefreshAt = 0;
  let pending;

  async function refresh() {
    const response = await fetchFeed(feedUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Inven RSS HTTP ${response.status}`);

    const $ = load(await response.text(), { xml: true });
    const uniqueArticles = new Map();

    for (const item of $('rss > channel > item')) {
      const article = $(item);
      const title = article.children('title').text().trim();
      const link = URL.parse(article.children('link').text().trim());
      const publishedAt = new Date(article.children('pubDate').text().trim());
      const description = load(article.children('description').text(), {}, false);
      description('script, style').remove();
      const summary = description.root().text().replace(/\s+/g, ' ').trim();
      const articleId = link?.searchParams.get('news');
      if (!title || !link || link.origin !== 'https://www.inven.co.kr' ||
          link.pathname !== '/webzine/news/' || !/^\d+$/.test(articleId ?? '') ||
          !Number.isFinite(publishedAt.getTime()) || publishedAt.getTime() > now()) continue;

      const sourceUrl = `https://www.inven.co.kr/webzine/news/?news=${articleId}`;
      uniqueArticles.set(sourceUrl, {
        title,
        summary,
        category: '게임 뉴스',
        source_name: '인벤',
        source_url: sourceUrl,
        published_at: publishedAt.toISOString(),
      });
    }

    const latest = [...uniqueArticles.values()]
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
      .slice(0, newsLimit);
    if (latest.length < newsLimit) throw new Error(`Inven RSS returned only ${latest.length} valid articles`);
    articles = latest;
  }

  async function getArticles() {
    if (pending) return pending;
    if (now() < nextRefreshAt) return articles;

    nextRefreshAt = now() + refreshInterval;
    pending = refresh()
      .catch((error) => console.warn('Game news refresh failed:', error.message))
      .then(() => articles)
      .finally(() => { pending = undefined; });
    return pending;
  }

  function start() {
    void getArticles();
    setInterval(() => { void getArticles(); }, refreshInterval).unref();
  }

  return { getArticles, start };
}
