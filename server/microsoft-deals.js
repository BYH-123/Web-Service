import { load } from 'cheerio';

const dealsPage = 'https://www.microsoft.com/ko-kr/store/deals/games/pc';
const catalogSize = 120;
const pageSize = 50;
const cacheDuration = 10 * 60 * 1000;
let cachedCatalog;
let pendingCatalog;

function readWon(value) {
  const price = typeof value === 'string' && /^₩\s*([\d,]+)$/.exec(value.trim());
  return price ? Number(price[1].replaceAll(',', '')) : null;
}

async function fetchPage(offset, fetchStore) {
  const url = new URL(dealsPage);
  if (offset) url.searchParams.set('skipitems', String(offset));
  const response = await fetchStore(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Microsoft Store HTTP ${response.status}`);

  const $ = load(await response.text());
  const script = $('script').toArray()
    .map((element) => $(element).text().trim())
    .find((source) => /^window\.__List__\s*=/.test(source));
  if (!script) throw new Error('Microsoft Store list data is missing');

  const list = JSON.parse(script.replace(/^window\.__List__\s*=\s*/, '').replace(/;$/, ''));
  if (!Array.isArray(list.cards) || !Number.isInteger(list.totalProducts) ||
      Number(list.offset) !== offset || list.error) {
    throw new Error('Invalid Microsoft Store list data');
  }
  return list;
}

export async function fetchMicrosoftCatalog(fetchStore = fetch) {
  const deals = new Map();
  const first = await fetchPage(0, fetchStore);
  const checkedAt = new Date().toISOString();

  function addCards(cards) {
    for (const card of cards) {
      const originalPrice = readWon(card.price?.originalPrice);
      const salePrice = readWon(card.price?.currentPrice);
      const productUrl = typeof card.pdpUri === 'string' ? URL.parse(card.pdpUri) : null;
      if (card.inStock === false || !card.title || !/^[a-z0-9]{12}$/i.test(card.productId ?? '') ||
          productUrl?.origin !== 'https://www.microsoft.com' || !productUrl.pathname.startsWith('/ko-kr/p/') ||
          originalPrice === null || salePrice === null || originalPrice <= salePrice ||
          deals.has(card.productId)) continue;

      deals.set(card.productId, {
        store: 'microsoft',
        product_id: card.productId,
        title: card.title,
        offer_type: salePrice === 0 ? 'giveaway' : 'discount',
        original_price: originalPrice,
        sale_price: salePrice,
        discount_percent: Math.round((1 - salePrice / originalPrice) * 100) || null,
        ends_at: null,
        checked_at: checkedAt,
        product_url: productUrl.href,
      });
      if (deals.size === catalogSize) break;
    }
  }

  addCards(first.cards);
  const maxOffset = Math.min(first.totalProducts, pageSize * 8);
  for (let start = pageSize; start < maxOffset && deals.size < catalogSize; start += pageSize * 3) {
    const offsets = [start, start + pageSize, start + pageSize * 2].filter((offset) => offset < maxOffset);
    const pages = await Promise.all(offsets.map((offset) => fetchPage(offset, fetchStore)));
    for (const page of pages) {
      addCards(page.cards);
      if (deals.size === catalogSize) break;
    }
  }

  return [...deals.values()];
}

export async function getMicrosoftDeals() {
  if (cachedCatalog && Date.now() < cachedCatalog.expiresAt) return cachedCatalog.deals;

  pendingCatalog ??= fetchMicrosoftCatalog().then((deals) => {
    cachedCatalog = { deals, expiresAt: Date.now() + cacheDuration };
    return deals;
  }).finally(() => {
    pendingCatalog = undefined;
  });

  return pendingCatalog;
}
