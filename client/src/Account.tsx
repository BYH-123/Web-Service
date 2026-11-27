import { useEffect, useState, type FormEvent } from 'react';

type Member = { id: string; name: string };

async function authRequest(path: string, body?: object) {
  const res = await fetch('/api/auth/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : { cache: 'no-store' });
  if (!res.ok) throw new Error('회원 요청을 처리하지 못했습니다.');
  return res.json();
}

export function Account() {
  const [session, setSession] = useState<{ user: Member; session: { expiresAt: string } } | null>(null);
  const user = session?.user;
  const [mode, setMode] = useState<'closed' | 'login' | 'signup'>('closed');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    authRequest('get-session').then(session => {
      if (active) setSession(session);
    }).catch(() => { if (active) setMessage('로그인 서버에 연결할 수 없습니다.'); })
      .finally(() => { if (active) setBusy(false); });
    if (new URLSearchParams(location.search).has('authError')) {
      setMessage('소셜 로그인이 완료되지 않았습니다. 계정 선택과 정보 제공 동의를 확인해 주세요.');
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    const deadline = Date.parse(session.session.expiresAt);
    const expire = () => {
      if (Date.now() < deadline) return;
      setSession(null);
      setMode('login');
      setMessage('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
    };
    const timer = window.setTimeout(expire, Math.max(0, deadline - Date.now()));
    window.addEventListener('focus', expire);
    document.addEventListener('visibilitychange', expire);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', expire);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [session]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const fields = Object.fromEntries(data);
      await authRequest(mode === 'signup' ? 'sign-up/email' : 'sign-in/email', fields);
      const current = await authRequest('get-session');
      if (!current?.session) throw new Error('세션을 확인하지 못했습니다.');
      setSession(current);
      setMode('closed');
    } catch {
      setMessage(mode === 'signup' ? '가입하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.' : '로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.');
    } finally { setBusy(false); }
  }

  async function social(provider: 'google' | 'naver') {
    setBusy(true);
    setMessage('');
    try {
      const { url } = await authRequest('sign-in/social', { provider, callbackURL: '/', errorCallbackURL: '/?authError=1' });
      if (!url) throw new Error();
      location.assign(url);
    } catch { setMessage('소셜 로그인을 시작하지 못했습니다.'); setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try { await authRequest('sign-out', {}); setSession(null); setMessage(''); }
    catch { setMessage('로그아웃하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }

  return <section aria-label="회원 계정" className="account">
    {user ? <><strong>{user.name}님</strong> <button disabled={busy} onClick={logout}>로그아웃</button></>
      : mode === 'closed' ? <button disabled={busy} onClick={() => setMode('login')}>로그인</button>
      : <>
        <h2>{mode === 'signup' ? '회원가입' : '로그인'}</h2>
        <form key={mode} onSubmit={submit}>
          {mode === 'signup' && <label>닉네임 <input name="name" required maxLength={60} autoComplete="nickname" /></label>}
          <label>이메일 <input type="email" name="email" required autoComplete="email" /></label>
          <label>비밀번호 <input type="password" name="password" required minLength={mode === 'signup' ? 12 : undefined}
            maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
          {mode === 'signup' && <small>비밀번호는 12자 이상 입력해 주세요.</small>}
          <button disabled={busy}>{mode === 'signup' ? '가입하기' : '로그인하기'}</button>
        </form>
        <div className="deal-controls">
          <button disabled={busy} onClick={() => { setMessage(''); setMode(mode === 'signup' ? 'login' : 'signup'); }}>
            {mode === 'signup' ? '기존 계정으로 로그인' : '이메일로 회원가입'}</button>
          <button disabled={busy} onClick={() => social('google')}>구글로 로그인</button>
          <button disabled={busy} onClick={() => social('naver')}>네이버로 로그인</button>
          <button disabled={busy} onClick={() => setMode('closed')}>닫기</button>
        </div>
      </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
