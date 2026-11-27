import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Deals } from './Deals';
import { IndustryNews } from './IndustryNews';
import { EsportsEvents } from './EsportsEvents';
import { Account } from './Account';
import './style.css';

type Game = {
  slot: number;
  slug: string;
  title: string;
  audience: 'global' | 'kr';
  releases: {
    platform: string;
    release_date: string | null;
    release_year: number | null;
  }[];
  source_url: string;
};

type GameList =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; games: Game[] };

const koreanDate = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

type Choice = { title: string; date: string; link: string };

function MyUpcomingGames() {
  const [cards, setCards] = useState<Record<string, Choice>>({});
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/me/upcoming-games', {signal: controller.signal}).then(async res => {
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!controller.signal.aborted) { setCards(data); setReady(true); }
    }).catch(() => { if (!controller.signal.aborted) setMessage('내 게임을 불러오지 못했습니다. 새로고침해 주세요.'); });
    return () => controller.abort();
  }, []);

  async function save(key: string, choice: Choice | null) {
    setSaving(true); setMessage('');
    try {
      const res = await fetch('/api/me/upcoming-games/' + key, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(choice ?? {reset:true})});
      if (!res.ok) {
        setMessage(res.status === 409 ? '관심작은 최대 5칸까지 저장할 수 있습니다. 기존 게임을 삭제한 후 추가해 주세요.' : res.status === 401 ? '다시 로그인해 주세요.' : '저장하지 못했습니다. 입력한 정보를 확인해 주세요.');
        return;
      }
      setCards(previous => {
        const next = {...previous};
        if (choice) next[key] = choice; else delete next[key];
        return next;
      });
      setEditing('');
    } catch { setMessage('서버에 연결하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  const entries = Object.entries(cards);
  return <section aria-label="내가 기대하는 출시 예정 게임">
    <h2>내가 기대하는 출시 예정 게임</h2>
    {message && <p role="alert">{message}</p>}
    {ready && <>
      <p>{entries.length} / 5개 등록</p>
      <ul className="games">{entries.map(([key, game]) => <li className="game" key={key}>
        <h3>{game.title}</h3>
        <p>{game.date || '출시일 미정'}</p>
        {game.link && <a href={game.link} target="_blank" rel="noopener noreferrer">공식 링크</a>}
        <div className="deal-controls">
          <button disabled={!!editing || saving} onClick={() => setEditing(key)}>수정</button>
          <button disabled={!!editing || saving} onClick={() => save(key, null)}>삭제</button>
        </div>
      </li>)}</ul>
      {editing ? <div key={editing} className="account">
        <h3>{cards[editing] ? '게임 수정' : '게임 추가'}</h3>
        <form onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void save(editing,{title:String(data.get('title')).trim(),date:String(data.get('date')),link:String(data.get('link')).trim()});
          }}>
            <label>게임 이름 <input name="title" required maxLength={120} defaultValue={cards[editing]?.title} autoFocus /></label>
            <label>출시일 (선택) <input name="date" type="date" defaultValue={cards[editing]?.date} /></label>
            <label>공식 링크 (선택) <input name="link" type="url" pattern="https://.+" placeholder="https://" defaultValue={cards[editing]?.link} /></label>
            <button disabled={saving}>저장</button>
            <button type="button" disabled={saving} onClick={() => setEditing('')}>취소</button>
          </form>
      </div> : <button disabled={saving || entries.length >= 5} onClick={() => setEditing(crypto.randomUUID())}>게임 추가</button>}
    </>}
  </section>;
}

function Recommendations({ games }: { games: Game[] }) {
  return <>{(['global','kr'] as const).map(area => {
    const group = games.filter(game => game.audience === area);
    return <section key={area}>
      <h2>{area === 'global' ? '글로벌 추천' : '국내 추천'}</h2>
      {!group.length && <p>등록된 추천 게임이 없습니다.</p>}
      <ul className="games">{group.map(game => <li className="game" key={game.slot}>
        <h3>{game.title}</h3>
        {!game.releases.length && <p>출시일 미정</p>}
        {game.releases.map(r => <p key={r.platform}>{r.platform} · {r.release_date ? koreanDate.format(new Date(r.release_date)) : r.release_year ? r.release_year + '년 예정' : '출시일 미정'}</p>)}
        <a href={game.source_url} target="_blank" rel="noopener noreferrer">출처 보기</a>
      </li>)}</ul>
    </section>;
  })}</>;
}

function App() {
  const [member,setMember] = useState<string | null>(null);
  const [list, setList] = useState<GameList>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadGames() {
      try {
        const response = await fetch('/api/upcoming-games', { signal: controller.signal });
        if (!response.ok) throw new Error('Game list request failed');
        const games: Game[] = await response.json();
        if (!controller.signal.aborted) setList({ status: 'ready', games });
      } catch {
        if (!controller.signal.aborted) setList({ status: 'error' });
      }
    }

    void loadGames();
    return () => controller.abort();
  }, [attempt]);

  return (
    <main>
      <Account onMember={setMember} />
      <h1>출시 예정 게임</h1>
      {list.status === 'loading' && <p role="status">게임 목록을 불러오는 중입니다.</p>}
      {list.status === 'error' && (
        <div>
          <p role="alert">게임 목록을 불러오지 못했습니다.</p>
          <button onClick={() => {
            setList({ status: 'loading' });
            setAttempt(attempt + 1);
          }}>다시 시도</button>
        </div>
      )}
      {list.status === 'ready' && (
        <Recommendations games={list.games} />
      )}
      {member && <MyUpcomingGames key={member} />}
      <Deals />
      <EsportsEvents />
      <IndustryNews />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
