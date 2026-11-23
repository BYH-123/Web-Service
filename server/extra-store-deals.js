import { load } from 'cheerio';
import confirmedDeals from './confirmed-store-deals.json' with { type: 'json' };

const cacheDuration = 10 * 60 * 1000;
const resultLimit = 20;
const fallbackLifetime = 24 * 60 * 60 * 1000;
const epicKoreanDiscountCatalog =
  'https://store.epicgames.com/ko/browse?sortBy=releaseDate&sortDir=DESC&priceTier=tierDiscouted&category=Game&count=40&start=0';
// Seasonal listings can remain online after the sale. Stop using them at the review deadline.
const campaignReviewAt = Date.parse('2026-12-01T00:00:00+09:00');

function readWon(value) {
  const match = /^₩\s*([\d,]+)$/.exec(value.trim());
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function readDiscount(value) {
  const match = /^-(\d{1,3})%$/.exec(value.trim());
  const percent = Number(match?.[1]);
  return percent > 0 && percent <= 100 ? percent : null;
}

function deal(store, id, title, productUrl, percent, fields = {}) {
  return {
    store, product_id: id, title, product_url: productUrl,
    offer_type: 'discount', original_price: null, sale_price: null,
    discount_percent: percent, ends_at: null, ...fields,
  };
}

function epicDeals($) {
  if (!$('[data-testid="card"]').length && !$('title').text().includes('Epic Games Store')) {
    throw new Error('Epic Games Store browse page is missing');
  }

  return $('[data-testid="card"]').toArray().flatMap((element) => {
    const card = $(element);
    const path = card.find('a[href^="/p/"], a[href^="/ko/p/"]').first().attr('href');
    const title = card.find('[data-testid="card-title"]').text().trim();
    const original = readWon(card.find('[class*="_originalPrice_"] s').first().text());
    const sale = readWon(card.find('[class*="_currentPrice_"]').first().text());
    const percent = readDiscount(card.find('[class*="_discountTag_"]').first().text());
    if (!path || !title || !percent || original === null || sale === null || sale >= original) return [];

    const url = new URL(path.replace(/^\/ko\//, '/'), 'https://store.epicgames.com');
    url.searchParams.set('lang', 'ko');
    return [deal('epic', url.pathname.split('/').at(-1), title, url.href, percent, {
      original_price: original, sale_price: sale, offer_type: sale === 0 ? 'giveaway' : 'discount',
    })];
  });
}

function eaDeals($) {
  if (!$('h1, h2').toArray().some((element) => /black friday sale 2026/i.test($(element).text()))) {
    throw new Error('EA sale page is missing');
  }

  return $('a[class*="Card_headlessButton__"][href^="/ko/games/"]').toArray().flatMap((element) => {
    const card = $(element);
    const title = card.find('h3').first().text().trim();
    const path = card.attr('href');
    const percent = readDiscount(card.find('[class*="PriceBadge_discountWrapper__"] [class*="Tag_tag__"]').first().text());
    if (!title || !percent) return [];
    return [deal('ea', path, title, new URL(path, 'https://www.ea.com').href, percent, {
      price_note: 'EA 행사 페이지 기준 · 국내 가격은 EA app에서 확인',
    })];
  });
}

function battleNetDeals($) {
  if (!$('h1').text().includes('Battle.net')) throw new Error('Battle.net sale page is missing');

  return $('.deal-list-item[data-shop-name="Battle.net"]').toArray().flatMap((element) => {
    const card = $(element);
    const title = card.attr('data-game-title')?.trim();
    const id = card.attr('data-container-game-id');
    const path = card.find('a.game-info-title[href^="/game/"]').first().attr('href');
    const priceText = card.find('.price-inner-wrapper').text();
    const percent = readDiscount(/Discount:\s*(-\d{1,3}%)/.exec(priceText)?.[1] ?? '');
    if (!title || !id || !path || !percent) return [];
    return [deal('battle_net', id, title, new URL(path, 'https://gg.deals').href, percent, {
      price_note: 'GG.deals 해외 Battle.net 기준 · 국내 가격 미확인',
      link_label: '할인 출처 보기',
    })];
  });
}

async function loadStorePage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    const { hostname, pathname } = new URL(url);
    throw Object.assign(new Error(`Store HTTP ${response.status} at ${hostname}${pathname}`), {
      status: response.status,
    });
  }
  return load(await response.text());
}

async function loadEpicDiscounts(url) {
  let $;
  try {
    $ = await loadStorePage(url);
  } catch (error) {
    if (error.status !== 403) throw error;
    return loadStorePage(epicKoreanDiscountCatalog);
  }

  // Follow the official specials page's discounted catalog in the Korean storefront.
  const catalog = $('a[href]').toArray()
    .map((element) => URL.parse($(element).attr('href'), url))
    .find((link) => link?.origin === 'https://store.epicgames.com' &&
      ['/browse', '/ko/browse'].includes(link.pathname) &&
      link.searchParams.get('priceTier') === 'tierDiscouted');
  if (!catalog) throw new Error('Epic Games Store specials catalog link is missing');

  catalog.pathname = '/ko/browse';
  return loadStorePage(catalog.href);
}

export const extraDealSources = {
  epic: {
    url: 'https://store.epicgames.com/sales-and-specials/?lang=ko',
    loadPage: loadEpicDiscounts,
    parse: epicDeals,
  },
  ea: { url: 'https://www.ea.com/ko/sales/black-friday-sale-2026', parse: eaDeals },
  battle_net: {
    url: 'https://gg.deals/deal/black-friday-comes-to-battlenet-early-with-big-time-savings-on-big-name-games/',
    parse: battleNetDeals,
  },
};

const cache = new Map();
const pending = new Map();
const forbidden = new Map();

function getFallbackDeals(store, cached, now) {
  const checkedAt = cached?.checkedAt ?? confirmedDeals.checkedAt;
  const expiresAt = Date.parse(checkedAt) + fallbackLifetime;
  if (now >= expiresAt) return null;

  const deals = cached?.deals ?? confirmedDeals.stores[store];
  if (!deals?.length) return null;
  return deals
    .filter((entry) => !entry.ends_at || Date.parse(entry.ends_at) > now)
    .map((entry) => ({
      ...entry, checked_at: checkedAt, previous_check: true,
      fallback_until: new Date(expiresAt).toISOString(),
    }));
}

export async function getExtraStoreDeals(store) {
  if (store !== 'epic' && Date.now() >= campaignReviewAt) return [];
  const now = Date.now();
  const cached = cache.get(store);
  if (cached && now < cached.expiresAt) return cached.deals;

  const blocked = forbidden.get(store);
  if (blocked && now < blocked.retryAt) {
    const fallback = getFallbackDeals(store, cached, now);
    if (fallback?.length) return fallback;
    throw blocked.error;
  }

  const request = pending.get(store);
  if (request) return request;

  const { url, parse, loadPage = loadStorePage } = extraDealSources[store];
  async function refresh() {
    const page = await loadPage(url);
    const unique = new Map();
    const checkedAt = new Date().toISOString();
    for (const entry of parse(page)) {
      if (unique.has(entry.product_id)) continue;
      unique.set(entry.product_id, { ...entry, checked_at: checkedAt });
      if (unique.size === resultLimit) break;
    }

    const deals = [...unique.values()];
    cache.set(store, { deals, checkedAt, expiresAt: Date.now() + cacheDuration });
    return deals;
  }

  const result = refresh().catch((error) => {
    if (error.status !== 403) throw error;

    const checked = Date.now();
    const retryDelay = store === 'epic' || store === 'battle_net'
      ? fallbackLifetime
      : cacheDuration;
    forbidden.set(store, { error, retryAt: checked + retryDelay });
    console.warn(`${store} discounts lookup failed:`, error.message);
    const fallback = getFallbackDeals(store, cached, checked);
    if (fallback?.length) return fallback;
    throw error;
  }).finally(() => pending.delete(store));
  pending.set(store, result);
  return result;
}
