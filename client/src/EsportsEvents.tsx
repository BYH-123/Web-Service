import { AdminEdit } from './AdminEdit';
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
      return { platform: '치지직', url: `https://chzzk.naver.com${url.pathname.replace(/\/$/, '')}` };
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

type Settings = {
  games: string[];
  slots: (null | { match: string } | { title: string; url: string })[];
};

type Schedule = { matches: EsportsEvent[]; scheduleAvailable: boolean; liveAvailable: boolean };
type Card = EsportsEvent | { slug: string; title: string; url: string };

const defaultSettings: Settings = { games: [], slots: [null, null, null] };
const games = ['CS2', '리그 오브 레전드', '발로란트', '배틀그라운드'];

function SettingsForm({ settings, matches, save, close }: {
  settings: Settings; matches: EsportsEvent[]; save: (settings: Settings) => Promise<void>; close: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function update(index: number, slot: Settings['slots'][number]) {
    setDraft(previous => ({ ...previous, slots: previous.slots.map((item, i) => i === index ? slot : item) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const slots: Settings['slots'] = [];
    const used = new Set<string>();
    for (const slot of draft.slots) {
      if (slot === null) {
        slots.push(null);
        continue;
      }
      const source = 'url' in slot ? broadcastSource(slot.url.trim()) : null;
      const key = 'match' in slot ? slot.match : source?.url;
      if (!key || ('url' in slot && !slot.title.trim())) {
        setError('경기를 선택하거나 방송 이름과 YouTube·치지직 링크를 입력해 주세요.');
        return;
      }
      if (used.has(key)) {
        setError('같은 경기나 방송은 한 번만 등록할 수 있어요.');
        return;
      }
      used.add(key);
      slots.push('match' in slot ? slot : { title: slot.title.trim(), url: key });
    }
    setSaving(true);
    try { await save({ games: draft.games, slots }); }
    catch { setError('대회 설정을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }

  return (
    <form className="esports-settings" aria-label="대회 설정" onSubmit={submit}>
      <fieldset disabled={saving}>
        <legend>관심 종목</legend>
        {games.map(game => (
          <label key={game}>
            <input type="checkbox" checked={draft.games.includes(game)} onChange={event => {
              const checked = event.target.checked;
              setDraft(previous => ({ ...previous, games: checked
                ? [...previous.games, game] : previous.games.filter(item => item !== game) }));
            }} /> {game}
          </label>
        ))}
      </fieldset>
      {draft.slots.map((slot, index) => (
        <fieldset key={index} disabled={saving}>
          <legend>대회 {index + 1}</legend>
          <label>표시 방식
            <select value={slot === null ? 'auto' : 'match' in slot ? 'match' : 'url'}
              onChange={event => update(index, event.target.value === 'match' ? { match: '' }
                : event.target.value === 'url' ? { title: '', url: '' } : null)}>
              <option value="auto">자동 추천</option>
              <option value="match">경기 선택</option>
              <option value="url">방송 링크 직접 입력</option>
            </select>
          </label>
          {slot && ('match' in slot ? (
            <label>경기
              <select required value={slot.match} onChange={event => update(index, { match: event.target.value })}>
                <option value="">경기를 선택하세요</option>
                {slot.match && !matches.some(match => match.slug === slot.match) &&
                  <option value={slot.match}>이전에 선택한 경기</option>}
                {matches.map(match => <option key={match.slug} value={match.slug}>{match.game} · {match.title}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label>방송 이름 <input required maxLength={120} value={slot.title} onChange={event => update(index, { ...slot, title: event.target.value })} /></label>
              <label>방송 URL <input required type="url" maxLength={500} value={slot.url} onChange={event => update(index, { ...slot, url: event.target.value })} /></label>
            </>
          ))}
        </fieldset>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className="deal-controls">
        <button disabled={saving} type="submit">저장</button>
        <button disabled={saving} type="button" onClick={close}>취소</button>
      </div>
    </form>
  );
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

function EventCard({ card, matches, now }: { card: Card; matches: EsportsEvent[]; now: number }) {
  if ('url' in card) {
    const source = broadcastSource(card.url);
    return (
      <div className="game">
        <h3>{card.title}</h3>
        {source && <Broadcast key={source.url} title={card.title + ' 중계'} sources={[source]} />}
      </div>
    );
  }
  const match = card.kind === 'match' ? undefined : featuredMatch(card, matches, now);
  const event = match ?? card;
  const sources = eventSources(event);
  const today = new Date(now + koreaOffsetMs).toISOString().slice(0, 10);
  const status = event.live ? '진행 중' : event.status === 'finished' || (event.last_day && event.last_day < today) ? '종료'
    : Date.parse(event.starts_at) > now ? '예정' : event.kind === 'match' ? '시작 확인 중' : '대회 기간';
  return (
    <div className="game">
      <p>{event.game} · {status}</p>
      <h3>{card.title}</h3>
      {match && <p>{match.title}</p>}
        <AdminEdit section="esports" row={card} />
      <p>시작 <time dateTime={event.starts_at}>{dateTime.format(new Date(event.starts_at))}</time> (KST)</p>
      {canOpenBroadcast(event, now)
        ? <Broadcast key={event.slug} title={event.title + ' 중계'} sources={sources} eventUrl={event.event_url} />
        : sources[0] ? <SourceLink source={sources[0]} />
        : event.event_url && <a href={event.event_url} target="_blank" rel="noopener noreferrer">공식 일정 보기 ↗</a>}
    </div>
  );
}

export function EsportsEvents({ member }: { member: string | null }) {
  const [featured, setFeatured] = useState<EsportsEvent[] | null>(null);
  const [featuredError, setFeaturedError] = useState(false);
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
        setFeaturedError(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setFeaturedError(true);
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section className="esports" aria-labelledby="esports-heading">
      <h2 id="esports-heading">대회·방송</h2>
      {featuredError && <p role="alert">국내 주목대회를 불러오지 못했습니다.</p>}
      {!featured && !featuredError && <p role="status">국내 주목대회를 확인하고 있습니다.</p>}
      <EsportsBoard key={member ?? 'guest'} member={member} featured={featured ?? []} matches={matches} now={checkedAt}
        schedule={schedule} refresh={() => setAttempt(current => current + 1)} />
    </section>
  );
}

function EsportsBoard({ member, featured, matches, now, schedule, refresh }: {
  member: string | null; featured: EsportsEvent[]; matches: EsportsEvent[]; now: number;
  schedule: Schedule | null; refresh: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [slotIndex, setSlotIndex] = useState<number | null>(null);
  const [selectedMatch, setSelectedMatch] = useState('');
  const [showAll, setShowAll] = useState(false);

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

  async function save(next: Settings) {
    const response = await fetch('/api/me/esports', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    if (!response.ok) throw new Error();
    setSettings(await response.json());
    setSelectedMatch('');
    setSlotIndex(null);
    setShowAll(false);
    setEditing(false);
  }

  const { games: interests, slots } = settings ?? defaultSettings;
  const dayStart = Math.floor((now + koreaOffsetMs) / dayMs) * dayMs - koreaOffsetMs;
  const today = matches.filter(match => {
    const start = Date.parse(match.starts_at);
    return start >= dayStart && start < dayStart + dayMs;
  });
  const interested = matches.filter(match => interests.includes(match.game) &&
    (match.live || (match.status !== 'finished' && Date.parse(match.starts_at) >= dayStart)));
  const preferred = [...interested].sort((a, b) => Number(!!b.live) - Number(!!a.live));
  const cards: (Card | undefined)[] = slots.map((slot, i) => {
    if (!slot) return undefined;
    if ('match' in slot) return matches.find(match => match.slug === slot.match);
    return { slug: `custom-${i}`, title: slot.title, url: slot.url };
  });
  const used = new Set(cards.map(card => card?.slug));
  const candidates = [...preferred, ...featured].filter(card => !used.has(card.slug));
  const available = cards.map(card => card ?? candidates.shift());
  const index = slotIndex ?? Math.max(0, available.findIndex(card => {
    if (!card) return false;
    return 'url' in card || canOpenBroadcast(card, now) || !!featuredMatch(card, matches, now);
  }));
  const chosenMatch = matches.find(match => match.slug === selectedMatch);
  const card = chosenMatch ?? available[index];
  const displayedMatches = showAll || !interests.length ? today : today.filter(match => interests.includes(match.game));

  function selectSlot(next: number) {
    setSelectedMatch('');
    setSlotIndex(next);
  }

  return (
    <>
      <h3>{settings && (interests.length || slots.some(Boolean)) ? '내 주목대회' : '국내 주목대회'}</h3>
      {member && settings && <button type="button" onClick={() => setEditing(current => !current)}>대회 설정 변경</button>}
      {settingsError && <p role="alert">대회 설정을 불러오지 못했습니다.{' '}
        <button type="button" onClick={() => setSettingsAttempt(current => current + 1)}>다시 시도</button></p>}
      {editing && settings && <SettingsForm settings={settings} matches={matches} save={save} close={() => setEditing(false)} />}
      <div className="esports-controls" aria-label="주목대회 선택">
        <button type="button" aria-label="이전 대회" onClick={() => selectSlot((index + 2) % 3)}>←</button>
        {available.map((item, i) => (
          <button type="button" key={i} aria-pressed={!chosenMatch && i === index} onClick={() => selectSlot(i)}>
            {item?.title ?? `주목대회 ${i + 1}`}
          </button>
        ))}
        <button type="button" aria-label="다음 대회" onClick={() => selectSlot((index + 1) % 3)}>→</button>
      </div>
      {card ? <EventCard key={card.slug} card={card} matches={matches} now={now} />
        : <p>등록된 주목대회 정보가 없습니다.</p>}
      <section className="esports-schedule" aria-labelledby="esports-schedule-heading">
        <div className="esports-schedule-header">
          <h3 id="esports-schedule-heading">오늘의 경기 일정 <span>(한국 시간)</span></h3>
          <div className="esports-schedule-actions">
            {!!interests.length && <button type="button" onClick={() => setShowAll(current => !current)}>
              {showAll ? '관심 종목 보기' : '전체 대회 보기'}
            </button>}
            <button type="button" onClick={refresh}>경기 새로고침</button>
          </div>
        </div>
        {!schedule && <p role="status">경기 일정을 확인하고 있습니다.</p>}
        {schedule && !schedule.scheduleAvailable && <p role="status">오늘 경기 일정을 확인하지 못했습니다.</p>}
        {schedule?.scheduleAvailable && !schedule.liveAvailable && <p role="status">실시간 진행 상태를 확인하지 못했습니다.</p>}
        {schedule?.scheduleAvailable && !today.length && <p>오늘 예정된 경기가 없습니다.</p>}
        {schedule?.scheduleAvailable && !!today.length && !displayedMatches.length && <p>오늘 관심 종목의 경기가 없습니다.</p>}
        {!!displayedMatches.length && (
          <ul className="esports-schedule-list" role="list">
            {displayedMatches.map(match => {
              const status = match.live ? '진행 중' : match.status === 'finished' ? '종료'
                : Date.parse(match.starts_at) > now ? '예정' : null;
              return (
                <li key={match.slug}>
                  <button className="esports-schedule-row" type="button"
                    aria-pressed={card?.slug === match.slug} onClick={() => setSelectedMatch(match.slug)}>
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
      </section>
    </>
  );
}