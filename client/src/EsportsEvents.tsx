import { useEffect, useState, useRef } from 'react';

type EsportsEvent = {
  slug: string;
  game: string;
  title: string;
  starts_at: string;
  event_url: string | null;
  streams?: string[];
  live?: boolean;
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
    : ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
      ? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:live|embed)\/([^/]+)$/)?.[1]
      : null;
  if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
    return `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  }
  if (['www.twitch.tv', 'twitch.tv'].includes(url.hostname)) {
    const channel = url.pathname.match(/^\/([a-z0-9_]+)\/?$/i)?.[1];
    if (channel) {
      const query = new URLSearchParams({ channel, parent: window.location.hostname, autoplay: 'true', muted: 'true' });
      return `https://player.twitch.tv/?${query}`;
    }
  }
  return null;
}

function Broadcast({event}: {event: EsportsEvent}) {
  const [failed, setFailed] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const urls = event.streams?.length ? event.streams : event.watch_url ? [event.watch_url] : [];
  const playable = urls.map(url => ({url, embed:streamEmbed(url)})).filter(item => item.embed && !failed.includes(item.url))
    .sort((a,b) => Number(b.embed!.includes('youtube-nocookie.com')) - Number(a.embed!.includes('youtube-nocookie.com')));
  const current = playable[0];
  const source = current?.url;
  const embed = current?.embed;
  useEffect(() => {
    if (!source || !embed?.startsWith('https://www.youtube-nocookie.com/')) return;
    const origin = new URL(embed).origin;
    let ready = false;
    function listen() {
      frame.current?.contentWindow?.postMessage(JSON.stringify({event:'listening',id:'game-broadcast',channel:'widget'}),origin);
    }
    function receive(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow || e.origin !== origin) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg?.event === 'onReady' || msg?.event === 'initialDelivery') {
        ready = true;
        frame.current?.contentWindow?.postMessage(JSON.stringify({event:'command',func:'addEventListener',args:['onError']}),origin);
      }
      if (msg?.event === 'onError') setFailed(previous => [...previous, source!]);
    }
    window.addEventListener('message',receive);
    const timer = setInterval(() => { if (!ready) listen(); },500);
    const timeout = setTimeout(() => { if (!ready) setFailed(previous => [...previous,source]); },15000);
    return () => { clearInterval(timer); clearTimeout(timeout); window.removeEventListener('message',receive); };
  },[source,embed]);
  return <>
    {embed && <iframe ref={frame} id="game-broadcast" key={embed} className="esports-player" src={embed} title={event.title + ' 중계'} allow="autoplay; fullscreen" allowFullScreen />}
    {playable.length > 1 && <button onClick={() => setFailed(previous => [...previous,current.url])}>다른 중계로 전환</button>}
    {!embed && <p>페이지 안에서 재생할 수 있는 중계가 없습니다.</p>}
    {urls.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}에서 시청 ↗</a>)}
    {!urls.length && event.event_url && <a href={event.event_url} target="_blank" rel="noopener noreferrer">공식 일정 보기 ↗</a>}
  </>;
}

export function EsportsEvents() {
  const [events, setEvents] = useState<EsportsEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
          setSelected(previous => result.some(match => match.slug === previous) ? previous : null);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          const currentTime = Date.now();
          const nextCheck = dayMs - (currentTime + koreaOffsetMs) % dayMs;
          timer = setTimeout(loadEvents, Math.min(60_000, nextCheck));
        }
      }
    }

    void loadEvents();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  const event = events?.find(match => match.slug === selected)
    ?? events?.find(match => match.live && (match.streams ?? [match.watch_url]).some(url => streamEmbed(url)))
    ?? events?.find(match => match.live)
    ?? events?.find(match => Date.parse(match.starts_at) >= Date.now())
    ?? events?.[0];
  const index = event && events ? events.indexOf(event) : 0;
  const todayMatch = event?.kind === 'match';


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
            <p>{event.live ? '진행 중 · ' : todayMatch ? '오늘 경기 · ' : ''}{event.game}</p>
            <h3>{event.title}</h3>
            <p>시작 <time dateTime={event.starts_at}>{dateTime.format(new Date(event.starts_at))}</time> (KST)</p>
            {event.live ? <Broadcast key={event.slug} event={event} /> :
              (event.watch_url ?? event.event_url) && <a href={(event.watch_url ?? event.event_url)!} target="_blank" rel="noopener noreferrer">공식 중계 안내 ↗</a>}
          </div>
          {events.length > 1 && (
            <div className="esports-controls">
              <button type="button" aria-label="이전 대회" onClick={() => setSelected(events[(index + events.length - 1) % events.length].slug)}>←</button>
              <select aria-label="시청할 경기" value={event.slug} onChange={e => setSelected(e.target.value)}>
                {events.map(match => <option key={match.slug} value={match.slug}>{match.live ? '진행 중 · ' : ''}{match.game} · {match.title}</option>)}
              </select>
              <button type="button" aria-label="다음 대회" onClick={() => setSelected(events[(index + 1) % events.length].slug)}>→</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
