import { load } from 'cheerio';

const catalogSize = 120;
const pageSize = 100;
const cacheDuration = 10 * 60 * 1000;
let cachedCatalog;
let pendingCatalog;

function readWon(text) {
  const price = /^₩\s*([\d,]+)$/.exec(text.trim());
  return price ? Number(price[1].replaceAll(',', '')) : null;
}

async function fetchCatalog() {
  const deals = new Map();
  const checkedAt = new Date().toISOString();

  for (let start = 0; start < 400 && deals.size < catalogSize; start += pageSize) {
    const url = new URL('https://store.steampowered.com/search/results/');
    url.search = new URLSearchParams({
      query: '', start: String(start), count: String(pageSize), specials: '1',
      category1: '998', cc: 'KR', l: 'koreana', infinite: '1',
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.success || typeof payload.results_html !== 'string' ||
        !Number.isFinite(Number(payload.total_count))) {
      throw new Error('Invalid Steam search response');
    }

    const $ = load(payload.results_html);
    for (const row of $('a.search_result_row[data-ds-appid]')) {
      const item = $(row);
      const id = item.attr('data-ds-appid');
      const title = item.find('.title').first().text().trim();
      const originalPrice = readWon(item.find('.discount_original_price').first().text());
      const salePrice = readWon(item.find('.discount_final_price').first().text());
      const discount = Number(item.find('.discount_block').first().attr('data-discount'));
      if (!/^\d+$/.test(id ?? '') || !title || originalPrice === null ||
          salePrice === null || salePrice >= originalPrice ||
          !Number.isInteger(discount) || discount < 1 || discount > 100 || deals.has(id)) continue;

      deals.set(id, {
        store: 'steam',
        product_id: id,
        title,
        offer_type: discount === 100 ? 'giveaway' : 'discount',
        original_price: originalPrice,
        sale_price: salePrice,
        discount_percent: discount,
        ends_at: null,
        checked_at: checkedAt,
        product_url: `https://store.steampowered.com/app/${id}/`,
      });
      if (deals.size === catalogSize) break;
    }

    if (start + pageSize >= Number(payload.total_count)) break;
  }

  return [...deals.values()];
}

export async function getSteamDeals() {
  if (cachedCatalog && Date.now() < cachedCatalog.expiresAt) return cachedCatalog.deals;

  pendingCatalog ??= fetchCatalog().then((deals) => {
    cachedCatalog = { deals, expiresAt: Date.now() + cacheDuration };
    return deals;
  }).finally(() => {
    pendingCatalog = undefined;
  });

  return pendingCatalog;
}
