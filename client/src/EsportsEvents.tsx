import { useEffect, useState } from 'react';

type EsportsEvent = {
  slug: string;
  game: string;
  title: string;
  starts_at: string;
  event_url: string | null;
  kind?: 'match';
  watch_url: string | null;
};

const dateTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

const dayMs = 86_400_000;
const koreaOffsetMs = 9 * 60 * 60 * 1000;

function streamEmbed(watchUrl: string | null) {
  if (!watchUrl) return null;
  const url = new URL(watchUrl);
  const youtubeId = url.hostname === 'youtu.be'
    ? url.pathname.slice(1)
    : ['www.youtube.com', 'youtube.com'].includes(url.hostname)
      ? url.searchParams.get('v') ?? url.pathname.match(/^\/live\/([^/]+)$/)?.[1]
      : null;
  if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
    return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
  }
  if (['www.twitch.tv', 'twitch.tv'].includes(url.hostname)) {
    const channel = url.pathname.match(/^\/([a-z0-9_]+)\/?$/i)?.[1];
    if (channel) {
      const query = new URLSearchParams({ channel, parent: window.location.hostname, autoplay: 'false' });
      return `https://player.twitch.tv/?${query}`;
    }
  }
  return null;
}

export function EsportsEvents() {
  const [events, setEvents] = useState<EsportsEvent[] | null>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loadEvents() {
      try {
        const response = await fetch('/api/esports-events?today=1', { signal: controller.signal });
        if (!response.ok) throw new Error('Esports request failed');
        const result: EsportsEvent[] = await response.json();
        if (!controller.signal.aborted) {
          setEvents(result);
          const latestStarted = result.reduce((selected, match, position) =>
            match.kind === 'match' && Date.parse(match.starts_at) <= Date.now() ? position : selected, 0);
          setIndex(latestStarted);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          const currentTime = Date.now();
          const nextCheck = dayMs - (currentTime + koreaOffsetMs) % dayMs;
          timer = setTimeout(loadEvents, nextCheck);
        }
      }
    }

    void loadEvents();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  const event = events?.[index];
  const todayMatch = event?.kind === 'match';
  const player = todayMatch ? streamEmbed(event.watch_url) : null;

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
            <p>{todayMatch ? '오늘 경기 · ' : ''}{event.game}</p>
            <h3>{event.title}</h3>
            <p>시작 <time dateTime={event.starts_at}>{dateTime.format(new Date(event.starts_at))}</time> (KST)</p>
            {player && (
              <iframe className="esports-player" src={player} title={`${event.title} 중계`}
                loading="lazy" allowFullScreen />
            )}
            {(event.watch_url ?? event.event_url) && (
              <a href={event.watch_url ?? event.event_url ?? undefined} target="_blank" rel="noopener noreferrer">
                {event.watch_url ? (todayMatch ? '중계 채널 보기' : '공식 중계 안내') : '공식 대회 일정'} ↗
              </a>
            )}
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
