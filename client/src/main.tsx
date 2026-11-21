import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Game = {
  slug: string;
  title: string;
  platforms: string[];
  release_date: string | null;
  source_url: string;
};

type GameList =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; games: Game[] };

const koreanDate = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

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
        list.games.length === 0 ? <p>등록된 출시 예정 게임이 없습니다.</p> :
          <ul className="games">
            {list.games.map((game) => (
              <li key={game.slug} className="game">
                <h2>{game.title}</h2>
                <p>{game.release_date
                  ? <time dateTime={game.release_date}>{koreanDate.format(new Date(game.release_date))}</time>
                  : '출시일 미정'}</p>
                <p>{game.platforms.join(' · ')}</p>
                <a href={game.source_url} target="_blank" rel="noopener noreferrer">출처 보기</a>
              </li>
            ))}
          </ul>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
