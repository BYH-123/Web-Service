import { useEffect, useState } from 'react';

const stores = {
  steam: 'Steam',
  epic: 'Epic Games Store',
  microsoft: 'Microsoft Store',
  battle_net: 'Battle.net',
  ea: 'EA',
};

type Store = keyof typeof stores;
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
};

type DealCatalog = {
  deals: Deal[];
  steamUnavailable: boolean;
  microsoftUnavailable?: boolean;
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
  const [catalog, setCatalog] = useState<DealCatalog & { batch: number } | null>(null);
  const [store, setStore] = useState<Store | 'all'>('all');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let advanceBatch = attempt > 0;

    async function loadDeals() {
      setNow(Date.now());

      try {
        const response = await fetch('/api/deals?catalog=1', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Deal request failed');
        const result: DealCatalog = await response.json();
        if (!controller.signal.aborted) {
          const batchStep = advanceBatch ? 1 : 0;
          advanceBatch = false;
          setNow(Date.now());
          setFailed(false);
          setCatalog((previous) => ({ ...result, batch: (previous?.batch ?? 0) + batchStep }));
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(loadDeals, refreshInterval);
          setLoading(false);
        }
      }
    }

    void loadDeals();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  const visibleStores = (Object.keys(stores) as Store[]).filter((key) => store === 'all' || key === store);

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
          setAttempt((current) => current + 1);
        }}>↻ 새로고침</button>
      </div>
      {loading && <p role="status">할인 목록을 불러오는 중입니다.</p>}
      {failed && <p role="alert">{catalog
        ? '새로고침에 실패했습니다. 마지막으로 불러온 목록을 표시합니다.'
        : '할인 목록을 불러오지 못했습니다.'}</p>}
      {catalog && visibleStores.map((key) => {
        const items = catalog.deals.filter((deal) =>
          deal.store === key && (!deal.ends_at || Date.parse(deal.ends_at) > now));
        const hasLiveCatalog = key === 'steam' || key === 'microsoft';
        const unavailable = key === 'steam' ? catalog.steamUnavailable
          : key === 'microsoft' && catalog.microsoftUnavailable;
        const size = hasLiveCatalog ? 20 : 5;
        const batchCount = Math.max(1, Math.ceil(items.length / size));
        const batch = catalog.batch % batchCount;
        const visible = items.slice(batch * size, (batch + 1) * size);

        return (
          <section className="deal-store" key={key} aria-labelledby={`deal-store-${key}`}>
            <h3 id={`deal-store-${key}`}>{stores[key]}</h3>
            {unavailable && (
              <p role="status">{stores[key]} 최신 할인 목록을 가져오지 못했습니다.</p>
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
                    <p>
                      {deal.original_price !== null && <><del>{won.format(deal.original_price)}원</del>{' '}</>}
                      <strong>{deal.sale_price === null ? '가격 미공개' : won.format(deal.sale_price) + '원'}</strong>
                      {deal.discount_percent !== null && ' · ' + deal.discount_percent + '% 할인'}
                    </p>
                    <p>{deal.ends_at
                      ? <>종료 <time dateTime={deal.ends_at}>{dateTime.format(new Date(deal.ends_at))}</time> (KST)</>
                      : '종료 시각 미확인'}</p>
                    <p>{deal.checked_at
                      ? <>가격 확인 <time dateTime={deal.checked_at}>{dateTime.format(new Date(deal.checked_at))}</time> (KST)</>
                      : '가격 확인 시각 미기록'}</p>
                    <a href={deal.product_url} target="_blank" rel="noopener noreferrer">스토어에서 보기 ↗</a>
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
