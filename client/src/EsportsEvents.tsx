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
  series?: string | null;
  last_day?: string;
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
const scheduleRefreshMs = 30_000;
const broadcastLeadMs = 5 * 60_000;
const broadcastGraceMs = 15 * 60_000;
const matchTime = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul',
});

function canOpenBroadcast(event: EsportsEvent, now: number) {
  const untilStart = Date.parse(event.starts_at) - now;
  return event.live || event.broadcast_available ||
    (event.status === 'not_started' && untilStart >= -broadcastGraceMs && untilStart <= broadcastLeadMs &&
      eventSources(event).some(source => source.platform === 'YouTube' && source.embed));
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

type BroadcastSource = { platform: 'YouTube' | '치지직'; url: string; embed?: string };

function broadcastSource(watchUrl: string | null): BroadcastSource | null {
  if (!watchUrl) return null;
  const url = URL.canParse(watchUrl) ? new URL(watchUrl) : null;
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;

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
  const path = url.pathname.replace(/\/$/, '');
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) &&
      /^\/(?:@(?:[\w.-]|%[\da-f]{2})+|(?:channel|c|user)\/[\w.-]+)(?:\/(?:live|streams))?$/i.test(path)) {
    return { platform: 'YouTube', url: `https://www.youtube.com${path}` };
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
    const channel = path.match(/^\/(?:live\/)?([a-f0-9]{32})$/i)?.[1];
    if (channel || /^\/video\/\d+$/.test(path)) {
      return { platform: '치지직', url: `https://chzzk.naver.com${channel ? '/live/' + channel.toLowerCase() : path}` };
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
    {!embed && <p>{sources.length ? '방송은 플랫폼에서 열어 시청할 수 있어요.' : '등록된 중계가 없습니다.'}</p>}
    {sources.map(item => <SourceLink key={item.url} source={item} />)}
    {!sources.length && eventUrl && <a href={eventUrl} target="_blank" rel="noopener noreferrer">공식 일정 보기 ↗</a>}
  </>;
}

type CustomGame = { name: string; url: string };
type Settings = {
  games?: string[];
  slots?: (null | { match: string } | { title: string; url: string })[];
  customGames?: Record<string, CustomGame>;
};

type Schedule = { matches: EsportsEvent[]; scheduleAvailable: boolean; liveAvailable: boolean };

const games = ['CS2', '리그 오브 레전드', '발로란트', '배틀그라운드', '오버워치', '이터널 리턴', '도타 2', '로켓 리그'];
const guestGamesKey = 'esports-custom-games';
const officialChannels: Record<string, string> = {
  '오버워치': 'https://www.youtube.com/@ow_esports_kr/streams',
  '이터널 리턴': 'https://www.youtube.com/@EternalReturnKR/streams',
};

function gameKey(name: string) {
  return name.trim().normalize('NFKC').toLowerCase();
}

function readGuestGames(): Record<string, CustomGame> {
  try { return JSON.parse(localStorage.getItem(guestGamesKey) ?? '{}') ?? {}; }
  catch { return {}; }
}

function cleanTitle(title: string) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function featuredMatch(event: EsportsEvent, matches: EsportsEvent[], now: number) {
  const candidates = matches.filter(match => match.game === event.game && canOpenBroadcast(match, now) &&
    [match.league, match.series].some(title => title && cleanTitle(title) === cleanTitle(event.title)));
  return candidates.find(match => match.live && eventSources(match).some(source => source.embed))
    ?? candidates.find(match => match.live) ?? candidates[0];
}

function EventCard({ card, matches, now, fallback }: {
  card: EsportsEvent; matches: EsportsEvent[]; now: number; fallback: BroadcastSource | null;
}) {
  const match = card.kind === 'match' ? undefined : featuredMatch(card, matches, now);
  const event = match ?? card;
  const sources = eventSources(event);
  const mayPlay = canOpenBroadcast(event, now) ||
    ((event.kind !== 'match' || event.status === 'finished') && sources.some(source => source.embed));
  const today = new Date(now + koreaOffsetMs).toISOString().slice(0, 10);
  const status = event.live ? '진행 중' : event.status === 'finished' || (event.last_day && event.last_day < today) ? '종료'
    : Date.parse(event.starts_at) > now ? '예정' : event.kind === 'match' ? '시작 확인 중' : '대회 기간';
  return (
    <div className="game esports-event-card">
      <p>{event.game} · {status}</p>
      <h3>{card.title}</h3>
      {match ? <p>{match.title}</p> : event.kind === 'match' && (event.series || event.league) && <p>{event.series || event.league}</p>}
      <p>시작 <time dateTime={event.starts_at}>{dateTime.format(new Date(event.starts_at))}</time> (KST)</p>
      {!sources.length && fallback && <SourceLink source={fallback} />}
      {mayPlay && (sources.length > 0 || !fallback)
        ? <Broadcast key={event.slug} title={event.title + ' 중계'} sources={sources} eventUrl={event.event_url} />
        : sources[0] ? <SourceLink source={sources[0]} />
        : event.event_url && <a href={event.event_url} target="_blank" rel="noopener noreferrer">공식 일정 보기 ↗</a>}
    </div>
  );
}

export function EsportsEvents({ member }: { member: string | null }) {
  const [featured, setFeatured] = useState<EsportsEvent[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const matches = schedule?.matches ?? [];

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loadSchedule() {
      try {
        const response = await fetch('/api/esports-events?today=1&schedule=1', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result: Schedule = await response.json();
        if (!controller.signal.aborted) setSchedule(result);
      } catch {
        if (!controller.signal.aborted) setSchedule({ matches: [], scheduleAvailable: false, liveAvailable: false });
      } finally {
        if (!controller.signal.aborted) {
          const now = Date.now();
          setCheckedAt(now);
          const nextDay = dayMs - (now + koreaOffsetMs) % dayMs;
          timer = setTimeout(loadSchedule, Math.min(scheduleRefreshMs, nextDay));
        }
      }
    }

    void loadSchedule();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/esports-events', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const result: EsportsEvent[] = await response.json();
      if (!controller.signal.aborted) {
        setFeatured(result);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setFeatured([]);
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section className="esports" aria-labelledby="esports-heading">
      <h2 id="esports-heading">대회·방송</h2>
      <EsportsBoard key={member ?? 'guest'} member={member} featured={featured} matches={matches} now={checkedAt}
        schedule={schedule} refresh={() => setAttempt(current => current + 1)} />
    </section>
  );
}

function EsportsBoard({ member, featured, matches, now, schedule, refresh }: {
  member: string | null; featured: EsportsEvent[]; matches: EsportsEvent[]; now: number;
  schedule: Schedule | null; refresh: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(() => member ? null : { customGames: readGuestGames() });
  const [settingsError, setSettingsError] = useState(false);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [selectedGame, setSelectedGame] = useState('');
  const [selectedMatch, setSelectedMatch] = useState('');

  useEffect(() => {
    if (!member) return;
    const controller = new AbortController();
    fetch('/api/me/esports', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const result: Settings = await response.json();
      if (!controller.signal.aborted) {
        setSettings(result);
        setSettingsError(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSettingsError(true);
    });
    return () => controller.abort();
  }, [member, settingsAttempt]);

  const customGames = { ...settings?.customGames };
  // Older profiles can already have manually entered broadcasts.
  for (const slot of settings?.slots ?? []) {
    if (slot && 'url' in slot && !Object.hasOwn(customGames, gameKey(slot.title))) {
      Object.defineProperty(customGames, gameKey(slot.title), { value: { name: slot.title, url: slot.url }, enumerable: true });
    }
  }
  const favoriteGames = (settings?.games ?? []).filter(game => games.includes(game));
  const gameOptions = [...new Set([...favoriteGames, ...games])];

  function chooseGame(game: string) {
    setSelectedGame(game);
    setSelectedMatch('');
  }

  async function addGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddError('');
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('gameName') ?? '').trim();
    const source = broadcastSource(String(fields.get('gameUrl') ?? '').trim());
    const key = gameKey(name);
    if (!key || !source || source.url.length > 500) {
      setAddError('게임 이름과 YouTube 또는 치지직의 영상·방송·채널 주소를 입력해 주세요.');
      return;
    }
    if (Object.hasOwn(customGames, key) || games.some(game => gameKey(game) === key)) {
      setAddError('이미 관심 종목에 있는 게임입니다.');
      return;
    }
    const newGame = { name, url: source.url };
    setSaving(true);
    try {
      let next = { ...settings?.customGames, [key]: newGame };
      if (member) {
        const response = await fetch('/api/me/esports/games', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newGame),
        });
        if (response.status === 409) {
          setAddError('이미 관심 종목에 있는 게임입니다.');
          return;
        }
        if (!response.ok) throw new Error();
        next = await response.json();
      } else {
        localStorage.setItem(guestGamesKey, JSON.stringify(next));
      }
      setSettings(previous => ({ ...previous, customGames: next }));
      chooseGame('custom:' + key);
      setAdding(false);
    } catch {
      setAddError('관심 종목을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  const custom = selectedGame.startsWith('custom:') ? customGames[selectedGame.slice(7)] : undefined;
  const dayStart = Math.floor((now + koreaOffsetMs) / dayMs) * dayMs - koreaOffsetMs;
  const listedMatches = custom ? [] : matches.filter(match => !selectedGame || match.game === selectedGame);
  function isToday(match: EsportsEvent) {
    const start = Date.parse(match.starts_at);
    return start >= dayStart && start < dayStart + dayMs;
  }
  const today = listedMatches.filter(isToday);
  const tournaments = selectedGame && !custom ? featured.filter(event => event.game === selectedGame) : [];
  const events = [...tournaments, ...listedMatches.filter(match => match.live || isToday(match))];
  const featuredWithStream = tournaments.find(event => featuredMatch(event, matches, now));
  const card = selectedGame && !custom ? events.find(event => event.slug === selectedMatch)
    ?? (featuredWithStream || events.find(event => event.live && eventSources(event).some(source => source.embed))
      || events.find(event => event.live) || events.find(event => canOpenBroadcast(event, now))
      || today.find(event => Date.parse(event.starts_at) >= now) || events[0]) : undefined;
  const fallback = selectedGame && Object.hasOwn(officialChannels, selectedGame)
    ? broadcastSource(officialChannels[selectedGame]) : null;
  const customSource = custom ? broadcastSource(custom.url) : null;

  return (
    <>
      <h3>관심 종목</h3>
      <div className="esports-controls esports-game-picker" role="group" aria-label="관심 종목 선택">
        {gameOptions.map(game => (
          <button type="button" key={game} aria-pressed={selectedGame === game} onClick={() => chooseGame(game)}>{game}</button>
        ))}
        {Object.entries(customGames).map(([key, game]) => (
          <button type="button" key={'custom:' + key} aria-pressed={selectedGame === 'custom:' + key}
            onClick={() => chooseGame('custom:' + key)}>{game.name}</button>
        ))}
        <button type="button" disabled={!settings} aria-expanded={adding} onClick={() => {
          setAddError('');
          setAdding(current => !current);
        }}>+ 관심 종목 추가</button>
      </div>
      {settingsError && <p role="alert">관심 종목을 불러오지 못했습니다.{' '}
        <button type="button" onClick={() => setSettingsAttempt(current => current + 1)}>다시 시도</button></p>}
      {adding && (
        <form className="esports-settings" aria-label="관심 종목 추가" onSubmit={addGame}>
          <label>게임 이름 <input name="gameName" required maxLength={80} disabled={saving} /></label>
          <label>방송 주소 <input name="gameUrl" type="url" required maxLength={500} disabled={saving}
            placeholder="https://…" aria-describedby="esports-url-help" /></label>
          <p id="esports-url-help">YouTube 또는 치지직 주소를 입력하세요.</p>
          {addError && <p role="alert">{addError}</p>}
          <div className="deal-controls">
            <button type="submit" disabled={saving}>추가</button>
            <button type="button" disabled={saving} onClick={() => setAdding(false)}>취소</button>
          </div>
        </form>
      )}
      {card && events.length > 1 && (
        <div className="esports-controls">
          <button type="button" aria-label="이전 경기" onClick={() => setSelectedMatch(events[(events.indexOf(card) + events.length - 1) % events.length].slug)}>←</button>
          <select aria-label="대회 또는 경기 선택" value={card.slug} onChange={event => setSelectedMatch(event.target.value)}>
            {events.map(event => <option key={event.slug} value={event.slug}>{event.title}{event.live ? ' · 진행 중' : ''}</option>)}
          </select>
          <button type="button" aria-label="다음 경기" onClick={() => setSelectedMatch(events[(events.indexOf(card) + 1) % events.length].slug)}>→</button>
        </div>
      )}
      {card && <EventCard key={card.slug} card={card} matches={matches} now={now} fallback={fallback} />}
      {custom && <div className="game esports-event-card">
        <h3>{custom.name}</h3>
        {customSource && <Broadcast key={selectedGame} title={custom.name + ' 중계'} sources={[customSource]} />}
      </div>}
      {!card && !custom && fallback && <div className="game esports-event-card">
        <h3>{selectedGame}</h3>
        <SourceLink source={fallback} />
      </div>}
      {!custom && <section className="esports-schedule" aria-labelledby="esports-schedule-heading">
        <div className="esports-schedule-header">
          <h3 id="esports-schedule-heading">오늘의 경기 일정 <span>(한국 시간)</span></h3>
          <div className="esports-schedule-actions">
            {selectedGame && <button type="button" onClick={() => chooseGame('')}>전체 경기 보기</button>}
            <button type="button" onClick={refresh}>경기 새로고침</button>
          </div>
        </div>
        {!schedule && <p role="status">경기 일정을 확인하고 있습니다.</p>}
        {schedule && !schedule.scheduleAvailable && <p role="status">오늘 경기 일정을 확인하지 못했습니다.</p>}
        {schedule?.scheduleAvailable && !schedule.liveAvailable && <p role="status">실시간 진행 상태를 확인하지 못했습니다.</p>}
        {schedule?.scheduleAvailable && !today.length && <p>{selectedGame ? `오늘 예정된 ${selectedGame} 경기가 없습니다.` : '오늘 예정된 경기가 없습니다.'}</p>}
        {!!today.length && (
          <ul className="esports-schedule-list" role="list" tabIndex={0} aria-labelledby="esports-schedule-heading">
            {today.map(match => {
              const status = match.live ? '진행 중' : match.status === 'finished' ? '종료'
                : Date.parse(match.starts_at) > now ? '예정' : null;
              return (
                <li key={match.slug}>
                  <button className="esports-schedule-row" type="button"
                    aria-pressed={card?.slug === match.slug} onClick={() => { setSelectedGame(match.game); setSelectedMatch(match.slug); }}>
                    <time dateTime={match.starts_at}>{matchTime.format(new Date(match.starts_at))}</time>
                    <span className="esports-schedule-match">
                      <strong>{match.title}</strong>
                      <span>{match.game}{match.league && ` · ${match.league}`}</span>
                    </span>
                    {status && <span className={match.live ? 'esports-schedule-status is-live' : 'esports-schedule-status'}>{status}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>}
    </>
  );
}
