import { useEffect, useState } from 'react';

type EsportsEvent = {
  slug: string;
  game: string;
  title: string;
  starts_at: string;
  event_url: string;
  watch_url: string | null;
};

const dateTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

export function EsportsEvents() {
  const [events, setEvents] = useState<EsportsEvent[] | null>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEvents() {
      try {
        const response = await fetch('/api/esports-events', { signal: controller.signal });
        if (!response.ok) throw new Error('Esports request failed');
        const result: EsportsEvent[] = await response.json();
        if (!controller.signal.aborted) {
          setEvents(result);
          setIndex(0);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }

    void loadEvents();
    return () => controller.abort();
  }, [attempt]);

  const event = events?.[index];

  return (
    <section className="esports" aria-labelledby="esports-heading">
      <h2 id="esports-heading">대회·방송</h2>
      {!events && !failed && <p role="status">대회를 불러오는 중입니다.</p>}
      {failed && (
        <div>
          <p role="alert">대회 목록을 불러오지 못했습니다.</p>
          <button onClick={() => {
            setFailed(false);
            setAttempt((current) => current + 1);
          }}>다시 시도</button>
        </div>
      )}
      {events?.length === 0 && <p>표시할 대회가 없습니다.</p>}
      {event && events && (
        <>
          <div aria-live="polite" className="game">
            <p>{event.game}</p>
            <h3>{event.title}</h3>
            <p>시작 <time dateTime={event.starts_at}>{dateTime.format(new Date(event.starts_at))}</time> (KST)</p>
            <a href={event.watch_url ?? event.event_url} target="_blank" rel="noopener noreferrer">
              {event.watch_url ? '공식 중계 안내' : '공식 대회 일정'} ↗
            </a>
          </div>
          {events.length > 1 && (
            <div className="esports-controls">
              <button type="button" aria-label="이전 대회" onClick={() => setIndex((current) => (current + events.length - 1) % events.length)}>←</button>
              <span aria-live="polite">{index + 1} / {events.length}</span>
              <button type="button" aria-label="다음 대회" onClick={() => setIndex((current) => (current + 1) % events.length)}>→</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
