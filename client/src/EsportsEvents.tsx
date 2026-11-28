import { useEffect, useId, useState, useRef } from 'react';
import type { FormEvent } from 'react';

type EsportsEvent = {
  slug: string;
  game: string;
  title: string;
  starts_at: string;
  event_url: string | null;
  broadcast_available?: boolean;
  league?: string | null;
  status?: string;
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
const scheduleRefreshMs = 20_000;
const broadcastLeadMs = 5 * 60_000;
const broadcastGraceMs = 15 * 60_000;
const matchTime = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul',
});

function canOpenBroadcast(event: EsportsEvent, now: number) {
  const untilStart = Date.parse(event.starts_at) - now;
  return event.live || event.broadcast_available ||
    (event.status === 'not_started' && untilStart >= -broadcastGraceMs && untilStart <= broadcastLeadMs &&
      eventSources(event).some(source => source.platform === 'YouTube'));
}

type VideoAudio = { volume: number; muted: boolean };
const defaultAudio: VideoAudio = { volume: 100, muted: true };
const audioByVideo = new Map<string, VideoAudio>();

function readVideoAudio(key: string): VideoAudio {
  const cached = audioByVideo.get(key);
  if (cached) return cached;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 100 &&
        typeof value.muted === 'boolean') return { volume: value.volume, muted: value.muted };
  } catch { /* Playback also works with storage disabled. */ }
  return defaultAudio;
}

function saveVideoAudio(key: string, audio: VideoAudio) {
  audioByVideo.set(key, audio);
  try { localStorage.setItem(key, JSON.stringify(audio)); }
  catch { /* Keep this setting in memory if storage is unavailable. */ }
}

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

function Broadcast({ title, sources, eventUrl }: { title: string; sources: BroadcastSource[]; eventUrl?: string | null }) {
  const [failed, setFailed] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const playerId = useId();
  const playable = sources.filter(item => item.embed && !failed.includes(item.url));
  const current = playable[0];
  const source = current?.url;
  const embed = current?.embed;
  useEffect(() => {
    if (!source || !embed?.startsWith('https://www.youtube-nocookie.com/')) return;
    const player = frame.current?.contentWindow;
    if (!player) return;
    const origin = new URL(embed).origin;
    const audioKey = 'esports-audio:' + source;
    let audio = readVideoAudio(audioKey);
    let restoredAudio = false;
    let pendingVolume: number | undefined;
    let pendingMute: boolean | undefined;
    let audioRestoreDeadline = 0;
    const deadline = Date.now() + 15_000;
    let ready = false;
    let joinedLive = false;
    let telemetry: { duration?: number; currentTime?: number; playerState?: number; videoData?: { isLive?: boolean }; volume?: number; muted?: boolean } = {};
    function send(command: object) {
      player?.postMessage(JSON.stringify({ id: playerId, channel: 'widget', ...command }), origin);
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
      if (!['initialDelivery', 'infoDelivery'].includes(msg?.event)) return;
      telemetry = { ...telemetry, ...msg.info };
      const { duration, currentTime, playerState, videoData } = telemetry;
      const reportedVolume = msg.info?.volume;
      const reportedMute = msg.info?.muted;
      if (!restoredAudio && playerState === 1) {
        // Start muted to allow autoplay, then apply the user's settings for this video.
        restoredAudio = true;
        audioRestoreDeadline = Date.now() + 1_000;
        if (telemetry.volume !== audio.volume) {
          pendingVolume = audio.volume;
          send({ event: 'command', func: 'setVolume', args: [audio.volume] });
        }
        if (telemetry.muted !== audio.muted) {
          pendingMute = audio.muted;
          send({ event: 'command', func: audio.muted ? 'mute' : 'unMute', args: [] });
        }
      } else if (restoredAudio) {
        let { volume, muted } = audio;
        if (Date.now() >= audioRestoreDeadline) {
          pendingVolume = undefined;
          pendingMute = undefined;
        }
        if (Number.isFinite(reportedVolume) && reportedVolume >= 0 && reportedVolume <= 100) {
          if (pendingVolume === undefined) volume = reportedVolume;
          else if (pendingVolume === reportedVolume) pendingVolume = undefined;
        }
        if (typeof reportedMute === 'boolean') {
          if (pendingMute === undefined) muted = reportedMute;
          else if (pendingMute === reportedMute) pendingMute = undefined;
        }
        if (volume !== audio.volume || muted !== audio.muted) {
          audio = { volume, muted };
          saveVideoAudio(audioKey, audio);
        }
      }
      if (joinedLive || Date.now() >= deadline) return;
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
  },[source,embed,playerId]);
  return <>
    {embed && <iframe ref={frame} id={playerId} key={embed} className="esports-player" src={embed} title={title} allow={current.platform === 'YouTube' ? 'autoplay; fullscreen' : 'fullscreen'} allowFullScreen />}
    {playable.length > 1 && <button onClick={() => setFailed(previous => [...previous,current.url])}>다른 중계로 전환</button>}
    {!embed && <p>페이지 안에서 재생할 수 있는 중계가 없습니다.</p>}
    {sources.map(item => <SourceLink key={item.url} source={item} />)}
    {!sources.length && eventUrl && <a href={eventUrl} target="_blank" rel="noopener noreferrer">공식 일정 보기 ↗</a>}
  </>;
}

function BroadcastPreview() {
  const [sources, setSources] = useState<BroadcastSource[]>([]);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [error, setError] = useState(false);
  const index = sources.findIndex(source => source.url === selectedUrl);
  const preview = sources[index];

  function play(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('broadcastUrl') ?? '').trim();
    const source = broadcastSource(url);
    setError(!source);
    if (!source) return;
    setSources(previous => previous.some(item => item.url === source.url) ? previous : [...previous, source]);
    setSelectedUrl(source.url);
    event.currentTarget.reset();
  }

  return (
    <section className="game broadcast-preview" aria-labelledby="broadcast-preview-heading">
      <h3 id="broadcast-preview-heading">방송 재생 테스트</h3>
      <form onSubmit={play}>
        <label htmlFor="broadcast-preview-url">방송 URL</label>
        <p id="broadcast-preview-help">YouTube 또는 치지직 링크를 추가하세요. 두 개 이상 추가하면 화살표로 방송을 바꿀 수 있어요.</p>
        <div className="broadcast-preview-controls">
          <input id="broadcast-preview-url" name="broadcastUrl" type="url" placeholder="https://…" aria-describedby="broadcast-preview-help" required />
          <button type="submit">추가 및 재생</button>
        </div>
      </form>
      {error && <p role="alert">지원하는 형식의 YouTube 또는 치지직 링크를 입력해 주세요.</p>}
      {preview && <Broadcast key={preview.url} title={`테스트 방송 ${index + 1}`} sources={[preview]} />}
      {sources.length > 1 && (
        <div className="esports-controls">
          <button type="button" aria-label="이전 테스트 방송" onClick={() => setSelectedUrl(sources[(index + sources.length - 1) % sources.length].url)}>←</button>
          <select aria-label="시청할 테스트 방송" value={selectedUrl} onChange={event => setSelectedUrl(event.target.value)}>
            {sources.map((source, i) => <option key={source.url} value={source.url}>테스트 방송 {i + 1} · {source.platform}</option>)}
          </select>
          <button type="button" aria-label="다음 테스트 방송" onClick={() => setSelectedUrl(sources[(index + 1) % sources.length].url)}>→</button>
        </div>
      )}
    </section>
  );
}

export function EsportsEvents({ member }: { member: string | null }) {
  const [events, setEvents] = useState<EsportsEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loadEvents() {
      try {
        const response = await fetch('/api/esports-events?today=1&game=cs2', { signal: controller.signal });
        if (!response.ok) throw new Error('Esports request failed');
        const result: EsportsEvent[] = await response.json();
        if (!controller.signal.aborted) {
          setEvents(result);
          setCheckedAt(Date.now());
          setSelected(previous => result.some(match => match.slug === previous) ? previous : null);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          const currentTime = Date.now();
          const nextCheck = dayMs - (currentTime + koreaOffsetMs) % dayMs;
          timer = setTimeout(loadEvents, Math.min(scheduleRefreshMs, nextCheck));
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
    ?? events?.find(match => canOpenBroadcast(match, checkedAt))
    ?? events?.find(match => Date.parse(match.starts_at) >= checkedAt)
    ?? events?.[0];
  const index = event && events ? events.indexOf(event) : 0;
  const sources = event ? eventSources(event) : [];
  const windowStart = Math.floor((checkedAt + koreaOffsetMs) / dayMs) * dayMs - koreaOffsetMs;
  const today = events?.filter(match => {
    const start = Date.parse(match.starts_at);
    return start >= windowStart && start < windowStart + dayMs;
  });


  return (
    <section className="esports" aria-labelledby="esports-heading">
      <h2 id="esports-heading">대회·방송</h2>
      <h3>오늘의 CS2 경기 일정 (한국 시간)</h3>
      <button type="button" onClick={() => {
        setFailed(false);
        setAttempt(current => current + 1);
      }}>경기 새로고침</button>
      {!events && !failed && <p role="status">CS2 경기 일정을 확인하고 있습니다.</p>}
      {failed && (
        <p role="alert">CS2 경기 일정을 확인하지 못했습니다.</p>
      )}
      {!failed && today?.length === 0 && <p>오늘 예정된 CS2 경기가 없습니다.</p>}
      {!!today?.length && (
        <ul>
          {today.map(match => (
            <li key={match.slug}>
              <button type="button" aria-pressed={event?.slug === match.slug} onClick={() => setSelected(match.slug)}>
                <time dateTime={match.starts_at}>{matchTime.format(new Date(match.starts_at))}</time>
                {' · '}{match.league ? `${match.league} · ` : ''}{match.title}
                {match.live ? ' · 진행 중' : match.status === 'finished' ? ' · 종료' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {event && events && (
        <>
          <div aria-live="polite" className="game">
            <p>{event.live ? '진행 중 · ' : event.status === 'finished' ? '종료 · ' : ''}{event.game}</p>
            <h3>{event.title}</h3>
            <p>시작 <time dateTime={event.starts_at}>{dateTime.format(new Date(event.starts_at))}</time> (KST)</p>
            {canOpenBroadcast(event, checkedAt)
              ? <Broadcast key={event.slug} title={event.title + ' 중계'} sources={sources} eventUrl={event.event_url} />
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
