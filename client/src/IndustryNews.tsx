import { AdminEdit } from './AdminEdit';
import { useEffect, useState } from 'react';

type Article = {
  title: string;
  summary: string;
  category: string;
  source_name: string;
  source_url: string;
  published_at: string;
};

const refreshInterval = 24 * 60 * 60 * 1000;

const publishedDate = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeZone: 'Asia/Seoul',
});

export function IndustryNews() {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loadNews() {
      try {
        const response = await fetch('/api/news', { signal: controller.signal });
        if (!response.ok) throw new Error('News request failed');
        const result: Article[] = await response.json();
        if (!controller.signal.aborted) {
          setArticles(result);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(loadNews, refreshInterval);
      }
    }

    void loadNews();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  return (
    <section className="industry-news" aria-labelledby="industry-news-heading">
      <h2 id="industry-news-heading">게임 뉴스</h2>
      {articles === null && !failed && <p role="status">뉴스를 불러오는 중입니다.</p>}
      {failed && (
        <div>
          <p role="alert">뉴스를 불러오지 못했습니다.</p>
          <button onClick={() => {
            setFailed(false);
            setAttempt((current) => current + 1);
          }}>다시 시도</button>
        </div>
      )}
      {articles?.length === 0 && <p>표시할 뉴스가 없습니다.</p>}
      {articles && articles.length > 0 && (
        <ul className="industry-news-list">
          {articles.map((article) => (
            <li key={article.source_url} className="game">
              <p>{article.category} · {article.source_name} ·{' '}
                <time dateTime={article.published_at}>{publishedDate.format(new Date(article.published_at))}</time>
              </p>
              <h3>{article.title}</h3>
        <AdminEdit section="news" row={article} />
              {article.summary && <p className="news-preview">{article.summary}</p>}
              <a href={article.source_url} target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}