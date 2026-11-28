import { useEffect, useState, useRef } from 'react';
import type { FormEvent } from 'react';

type EsportsEvent = {
  slug: string;
  game: string;
  title: string;
  starts_at: string;
  event_url: string | null;
  broadcast_available?: boolean;
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

type BroadcastSource =
  | { platform: 'YouTube'; url: string; embed: string }
  | { platform: '치지직'; url: string; embed?: string };

function broadcastSource(watchUrl: string | null): BroadcastSource | null {
  if (!watchUrl) return null;
  const url = URL.canParse(watchUrl) ? new URL(watchUrl) : null;
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;

  const youtubeId = url.hostname === 'youtu.be'
    ? url.pathname.match(/^\/([^/]+)\/?$/)?.[1]
    : ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)
      ? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)\/?$/)?.[1]
      : null;
  if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
    return {
      platform: 'YouTube',
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      embed: `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`,
    };
  }
  if (url.hostname === 'chzzk.naver.com') {
    const clipId = url.pathname.match(/^\/(?:clips|embed\/clip)\/([\w-]+)\/?$/)?.[1];
    if (clipId) {
      return {
        platform: '치지직',
        url: `https://chzzk.naver.com/clips/${clipId}`,
        embed: `https://chzzk.naver.com/embed/clip/${clipId}`,
      };
    }
    if (/^\/(?:live\/[a-f0-9]{32}|video\/\d+)\/?$/i.test(url.pathname)) {
      return { platform: '치지직', url: `https://chzzk.naver.com${url.pathname}` };
    }
  }
  return null;
}

function eventSources(event: EsportsEvent) {
  const sources = new Map<string, BroadcastSource>();
  for (const url of [...(event.streams ?? []), event.watch_url]) {
    const source = broadcastSource(url);
    if (source) sources.set(source.url, source);
  }
  return [...sources.values()].sort((a, b) => Number(b.platform === 'YouTube') - Number(a.platform === 'YouTube'));
}

function SourceLink({ source }: { source: BroadcastSource }) {
  return <a href={source.url} target="_blank" rel="noopener noreferrer">{source.platform}에서 시청 ↗</a>;
}

function Broadcast({ event, sources }: { event: EsportsEvent; sources: BroadcastSource[] }) {
  const [failed, setFailed] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const playable = sources.filter(item => item.embed && !failed.includes(item.url));
  const current = playable[0];
  const source = current?.url;
  const embed = current?.embed;
  useEffect(() => {
    if (!source || !embed?.startsWith('https://www.youtube-nocookie.com/')) return;
    const player = frame.current?.contentWindow;
    if (!player) return;
    const origin = new URL(embed).origin;
    const deadline = Date.now() + 15_000;
    let ready = false;
    let joinedLive = false;
    let telemetry: { duration?: number; currentTime?: number; playerState?: number; videoData?: { isLive?: boolean } } = {};
    function send(command: object) {
      player?.postMessage(JSON.stringify({ id: 'game-broadcast', channel: 'widget', ...command }), origin);
    }
    function receive(e: MessageEvent) {
      if (e.source !== player || e.origin !== origin) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!ready && (msg?.event === 'onReady' || msg?.event === 'initialDelivery')) {
        ready = true;
        send({ event: 'command', func: 'addEventListener', args: ['onError'] });
      }
      if (msg?.event === 'onError') setFailed(previous => [...previous, source!]);
      if (joinedLive || Date.now() >= deadline || !['initialDelivery', 'infoDelivery'].includes(msg?.event)) return;
      telemetry = { ...telemetry, ...msg.info };
      const { duration, currentTime, playerState, videoData } = telemetry;
      if (videoData?.isLive === true && playerState === 1 && typeof duration === 'number' &&
          typeof currentTime === 'number' && duration > 0) {
        joinedLive = true;
        // A fresh player normally starts near live. Correct a restored DVR position once.
        if (duration - currentTime > 15) send({ event: 'command', func: 'seekTo', args: [duration, true] });
      }
    }
    window.addEventListener('message',receive);
    const timer = setInterval(() => { if (!ready) send({ event: 'listening' }); },500);
    const timeout = setTimeout(() => { if (!ready) setFailed(previous => [...previous,source]); },15_000);
    return () => { clearInterval(timer); clearTimeout(timeout); window.removeEventListener('message',receive); };
  },[source,embed]);
  return <>
    {embed && <iframe ref={frame} id="game-broadcast" key={embed} className="esports-player" src={embed} title={event.title + ' 중계'} allow={current.platform === 'YouTube' ? 'autoplay; fullscreen' : 'fullscreen'} allowFullScreen />}
    {playable.length > 1 && <button onClick={() => setFailed(previous => [...previous,current.url])}>다른 중계로 전환</button>}
    {!embed && <p>페이지 안에서 재생할 수 있는 중계가 없습니다.</p>}
    {sources.map(item => <SourceLink key={item.url} source={item} />)}
    {!sources.length && event.event_url && <a href={event.event_url} target="_blank" rel="noopener noreferrer">공식 일정 보기 ↗</a>}
  </>;
}

function BroadcastPreview() {
  const [preview, setPreview] = useState<BroadcastSource | null>(null);
  const [error, setError] = useState(false);

  function play(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('broadcastUrl') ?? '').trim();
    const source = broadcastSource(url);
    setPreview(source);
    setError(!source);
  }

  return (
    <section className="game broadcast-preview" aria-labelledby="broadcast-preview-heading">
      <h3 id="broadcast-preview-heading">방송 재생 테스트</h3>
      <form onSubmit={play}>
        <label htmlFor="broadcast-preview-url">방송 URL</label>
        <p id="broadcast-preview-help">YouTube 영상·라이브 또는 치지직 방송·클립 링크를 입력하세요.</p>
        <div className="broadcast-preview-controls">
          <input id="broadcast-preview-url" name="broadcastUrl" type="url" placeholder="https://…" aria-describedby="broadcast-preview-help" required />
          <button type="submit">재생</button>
        </div>
      </form>
      {error && <p role="alert">지원하는 형식의 YouTube 또는 치지직 링크를 입력해 주세요.</p>}
      {preview && (
        <>
          {preview.embed
            ? <iframe key={preview.embed} className="esports-player" src={preview.embed} title="입력한 방송" allow={preview.platform === 'YouTube' ? 'autoplay; fullscreen' : 'fullscreen'} allowFullScreen />
            : <p>치지직에서 방송을 열어 시청할 수 있어요.</p>}
          <SourceLink source={preview} />
        </>
      )}
    </section>
  );
}

export function EsportsEvents({ member }: { member: string | null }) {
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
    ?? events?.find(match => match.live && eventSources(match).some(source => source.embed))
    ?? events?.find(match => match.live)
    ?? events?.find(match => match.broadcast_available)
    ?? events?.find(match => Date.parse(match.starts_at) >= Date.now())
    ?? events?.[0];
  const index = event && events ? events.indexOf(event) : 0;
  const todayMatch = event?.kind === 'match';
  const sources = event ? eventSources(event) : [];


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
            {event.live || event.broadcast_available
              ? <Broadcast key={event.slug} event={event} sources={sources} />
              : sources[0] ? <SourceLink source={sources[0]} />
              : event.event_url && <a href={event.event_url} target="_blank" rel="noopener noreferrer">공식 일정 보기 ↗</a>}
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
      {member && <BroadcastPreview key={member} />}
    </section>
  );
}
