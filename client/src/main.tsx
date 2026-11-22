import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Deals } from './Deals';
import { IndustryNews } from './IndustryNews';
import { EsportsEvents } from './EsportsEvents';
import './style.css';

type Game = {
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

function GameRecommendations({ title, games }: { title: string; games: Game[] }) {
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {games.length === 0 ? <p>등록된 추천 게임이 없습니다.</p> : (
        <ul className="games">
          {games.map((game) => (
            <li key={game.slug} className="game">
              <h3>{game.title}</h3>
              {game.releases.length === 0 && <p>출시일 미정</p>}
              {game.releases.map((release) => (
                <p key={release.platform}>
                  {release.platform} · {release.release_date
                    ? <time dateTime={release.release_date}>{koreanDate.format(new Date(release.release_date))}</time>
                    : release.release_year ? `${release.release_year}년 예정` : '출시일 미정'}
                </p>
              ))}
              <a href={game.source_url} target="_blank" rel="noopener noreferrer">출처 보기</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function App() {
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
        <>
          <GameRecommendations title="글로벌 추천" games={list.games.filter((game) => game.audience === 'global')} />
          <GameRecommendations title="국내 추천" games={list.games.filter((game) => game.audience === 'kr')} />
        </>
      )}
      <Deals />
      <EsportsEvents />
      <IndustryNews />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
