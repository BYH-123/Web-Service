import { useEffect, useState } from 'react';

const stores = {
  steam: 'Steam',
  epic: 'Epic Games Store',
  battle_net: 'Battle.net',
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
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [store, setStore] = useState<Store | 'all'>('all');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDeals() {
      try {
        const response = await fetch('/api/deals', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Deal request failed');
        const result: Deal[] = await response.json();
        if (!controller.signal.aborted) setDeals(result);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadDeals();
    return () => controller.abort();
  }, [attempt]);

  const visible = (deals ?? []).filter((deal) => store === 'all' || deal.store === store);

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
      {failed && <p role="alert">{deals
        ? '새로고침에 실패했습니다. 마지막으로 불러온 목록을 표시합니다.'
        : '할인 목록을 불러오지 못했습니다.'}</p>}
      {!loading && !failed && visible.length === 0 && <p>진행 중인 할인·프로모션이 없습니다.</p>}
      {visible.length > 0 && (
        <ul className="deal-list" aria-label="할인 상품">
          {visible.map((deal) => (
            <li className="game" key={JSON.stringify([deal.store, deal.product_id, deal.offer_type])}>
              <p>{stores[deal.store]} · {offerLabels[deal.offer_type]}</p>
              <h3>{deal.title}</h3>
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
}
