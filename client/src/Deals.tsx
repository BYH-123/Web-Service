import { AdminEdit } from './AdminEdit';
import { useEffect, useState } from 'react';

const stores = {
  steam: 'Steam',
  epic: 'Epic Games Store',
  microsoft: 'Microsoft Store (Windows PC)',
  battle_net: 'Battle.net',
  ea: 'EA',
};

type Store = keyof typeof stores;
const storeKeys = Object.keys(stores) as Store[];
const storeLinks: Partial<Record<Store, string>> = {
  epic: 'https://store.epicgames.com/sales-and-specials/?lang=ko',
  battle_net: 'https://kr.shop.battle.net/ko-kr',
};
type Deal = {
  store: Store;
  product_id: string;
  title: string;
  offer_type: 'discount' | 'giveaway' | 'free_play';
  original_price: number | null;
  sale_price: number | null;
  discount_percent: number | null;
  ends_at: string | null;
  checked_at: string | null;
  product_url: string;
  price_note?: string;
  link_label?: string;
  previous_check?: boolean;
  fallback_until?: string;
};

type DealCatalog = {
  deals: Deal[];
  steamUnavailable: boolean;
  microsoftUnavailable?: boolean;
  unavailableStores?: Store[];
};

type StoreCatalog = {
  deals: Deal[];
  batch: number;
  unavailable: boolean;
  checkedAt: number;
};

const refreshInterval = 24 * 60 * 60 * 1000;

const won = new Intl.NumberFormat('ko-KR');
const dateTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});
const offerLabels = {
  discount: '유료 할인',
  giveaway: '무료 배포',
  free_play: '기간 한정 무료 플레이',
};

export function Deals() {
  const [catalog, setCatalog] = useState<Partial<Record<Store, StoreCatalog>> | null>(null);
  const [store, setStore] = useState<Store | 'all'>('all');
  const [refresh, setRefresh] = useState<{ store: Store | 'all' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function loadDeals(scope: Store | 'all', advanceBatch: boolean) {
      const params = new URLSearchParams({ catalog: '1' });
      if (scope !== 'all') params.set('store', scope);

      try {
        const response = await fetch(`/api/deals?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Deal request failed');
        const result: DealCatalog = await response.json();
        if (!controller.signal.aborted) {
          const checkedAt = Date.now();
          const refreshedStores = scope === 'all' ? storeKeys : [scope];
          setFailed(false);
          setCatalog((previous) => {
            const next = { ...previous };
            for (const key of refreshedStores) {
              const unavailable = result.unavailableStores?.includes(key) ??
                (key === 'steam' ? result.steamUnavailable
                  : key === 'microsoft' && result.microsoftUnavailable === true);
              next[key] = {
                deals: unavailable && !storeLinks[key] && previous?.[key]
                  ? previous[key].deals
                  : result.deals.filter((deal) => deal.store === key),
                batch: (previous?.[key]?.batch ?? 0) + (advanceBatch && !unavailable ? 1 : 0),
                unavailable,
                checkedAt,
              };
            }
            return next;
          });
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(() => { void loadDeals('all', false); }, refreshInterval);
          setLoading(false);
        }
      }
    }

    void loadDeals(refresh?.store ?? 'all', refresh !== null);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  const visibleStores = storeKeys.filter((key) => store === 'all' || key === store);

  return (
    <section className="deals" aria-labelledby="deals-heading">
      <h2 id="deals-heading">할인·프로모션</h2>
      <div className="deal-controls">
        <label>
          스토어{' '}
          <select value={store} onChange={(event) => setStore(event.target.value as Store | 'all')}>
            <option value="all">전체</option>
            {Object.entries(stores).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button disabled={loading} onClick={() => {
          setLoading(true);
          setFailed(false);
          setRefresh({ store });
        }}>↻ 새로고침</button>
      </div>
      {loading && <p role="status">할인 목록을 불러오는 중입니다.</p>}
      {failed && <p role="alert">{catalog
        ? '새로고침에 실패했습니다. 마지막으로 불러온 목록을 표시합니다.'
        : '할인 목록을 불러오지 못했습니다.'}</p>}
      {catalog && visibleStores.map((key) => {
        const current = catalog[key];
        if (!current) return null;
        const items = current.deals.filter((deal) =>
          (!deal.ends_at || Date.parse(deal.ends_at) > current.checkedAt) &&
          (!deal.fallback_until || Date.parse(deal.fallback_until) > current.checkedAt));
        const hasLiveCatalog = key === 'steam' || key === 'microsoft';
        const { unavailable } = current;
        const size = hasLiveCatalog ? 20 : 5;
        const batchCount = Math.max(1, Math.ceil(items.length / size));
        const batch = current.batch % batchCount;
        const visible = items.slice(batch * size, (batch + 1) * size);
        const showingPrevious = visible.some((deal) => deal.previous_check);

        return (
          <section className="deal-store" key={key} aria-labelledby={`deal-store-${key}`}>
            <h3 id={`deal-store-${key}`}>{stores[key]}</h3>
            {(unavailable || showingPrevious) && (
              <p role="status">
                {showingPrevious
                  ? '자동 조회가 차단되어 마지막으로 확인한 할인 목록을 표시합니다.'
                  : `${stores[key]} 최신 할인 목록을 가져오지 못했습니다.`}
                {storeLinks[key] && (
                  <> <a href={storeLinks[key]} target="_blank" rel="noopener noreferrer">공식 스토어에서 확인 ↗</a></>
                )}
              </p>
            )}
            {visible.length === 0 && !unavailable && (
              <p>{hasLiveCatalog ? '진행 중인 할인·프로모션이 없습니다.' : '등록된 할인·프로모션이 없습니다.'}</p>
            )}
            {visible.length > 0 && (
              <ul key={batch} className="deal-list" aria-label={`${stores[key]} 할인 상품`} tabIndex={0}>
                {visible.map((deal) => (
                  <li className="game" key={JSON.stringify([deal.store, deal.product_id, deal.offer_type])}>
                    <p>{offerLabels[deal.offer_type]}</p>
                    <h4>{deal.title}</h4>
        <AdminEdit section="deals" row={deal} />
                    <p>
                      {deal.original_price !== null && <><del>{won.format(deal.original_price)}원</del>{' '}</>}
                      {!deal.price_note && <strong>{deal.sale_price === null ? '가격 미공개' : won.format(deal.sale_price) + '원'}</strong>}
                      {deal.discount_percent !== null && (!deal.price_note ? ' · ' : '') + deal.discount_percent + '% 할인'}
                    </p>
                    {deal.price_note && <p>{deal.price_note}</p>}
                    <p>{deal.ends_at
                      ? <>종료 <time dateTime={deal.ends_at}>{dateTime.format(new Date(deal.ends_at))}</time> (KST)</>
                      : '종료 시각 미확인'}</p>
                    <p>{deal.checked_at
                      ? <>가격 확인 <time dateTime={deal.checked_at}>{dateTime.format(new Date(deal.checked_at))}</time> (KST)</>
                      : '가격 확인 시각 미기록'}</p>
                    <a href={deal.product_url} target="_blank" rel="noopener noreferrer">{deal.link_label ?? '스토어에서 보기'} ↗</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}