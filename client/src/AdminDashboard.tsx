import { ReportContext, ReportForm, ReportInbox } from './Reports';
import type { Target } from './Reports';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AdminEdit } from './AdminEdit';

const sections = {members:'회원 관리',upcoming:'출시 예정 게임',deals:'할인·프로모션',esports:'e스포츠 대회 중계',news:'게임 뉴스'};
type Section = keyof typeof sections;
type Row = Record<string,unknown>;
type Member = {id:string;name:string;email:string;createdAt:string;admin:boolean;providers:string[]};
const providerNames:Record<string,string> = {credential:'이메일',google:'구글',naver:'네이버'};

async function get(url:string, signal:AbortSignal) {
  const res = await fetch(url,{signal,cache:'no-store'});
  if (!res.ok) throw Error();
  return res.json();
}

function MemberRow({user,refresh}:{user:Member;refresh:()=>void}) {
  const [edit,setEdit] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  return <li><div><strong>{user.name}</strong> · {user.admin?'관리자':'회원'}<br/>{user.email}
    <small>{user.providers.map(p=>providerNames[p]??p).join(', ')} · 가입 {new Date(user.createdAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</small></div>
    {edit ? <form onSubmit={async e=>{
      e.preventDefault();
      const name = new FormData(e.currentTarget).get('name');
      setBusy(true); setError('');
      try {
        const res = await fetch('/api/admin/members/'+encodeURIComponent(user.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
        if (!res.ok) throw Error();
        setEdit(false); refresh();
      } catch {setError('닉네임을 저장하지 못했습니다.');}
      finally {setBusy(false);}
    }}><label>닉네임 <input name="name" required maxLength={60} defaultValue={user.name} autoFocus /></label>
    <button disabled={busy}>저장</button><button type="button" disabled={busy} onClick={()=>setEdit(false)}>취소</button>
    {error && <span role="alert">{error}</span>}</form> : <button onClick={()=>setEdit(true)}>닉네임 수정</button>}</li>;
}

function Manager({section,targetId}:{section:Section;targetId:string}) {
  const [text,setText] = useState('');
  const [query,setQuery] = useState('');
  const [offset,setOffset] = useState(0);
  const [revision,setRevision] = useState(0);
  const [rows,setRows] = useState<Row[]>([]);
  const [members,setMembers] = useState<Member[]>([]);
  const [more,setMore] = useState(false);
  const [status,setStatus] = useState('loading');
  const [selected,setSelected] = useState(targetId);
  const refresh = ()=>setRevision(n=>n+1);
  useEffect(()=>{
    const controller = new AbortController();
    const read = (path:string)=>get(path,controller.signal);
    async function load() {
      setStatus('loading');
      if (section === 'members') {
        const data = await read('/api/admin/members?'+new URLSearchParams({q:query,offset:String(offset)}));
        if (controller.signal.aborted) return;
        setMembers(data.members); setMore(data.more);
      } else {
        let result:Row[];
        if (section === 'esports') {
          const [featured,schedule] = await Promise.all([read('/api/esports-events'),read('/api/esports-events?today=1&schedule=1')]);
          result = [...featured,...schedule.matches];
        } else if (section === 'deals') result = (await read('/api/deals?catalog=1')).deals;
        else result = await read(section === 'news'?'/api/news':'/api/upcoming-games');
        if (controller.signal.aborted) return;
        setRows(result);
      }
      setStatus('ready');
    }
    load().catch(()=>{if (!controller.signal.aborted) setStatus('error');});
    return ()=>controller.abort();
  },[section,query,offset,revision]);
  const visible = rows.filter(r=>[r.title,r.game,r.store,r.source_name].some(v=>String(v??'').toLowerCase().includes(text.trim().toLowerCase())));
  const selectedMember = members.find(u=>u.id===selected) ?? members[0];
  const selectedRow = visible.find((r,i)=>String(r.admin_id??i)===selected) ?? (selected && selected===targetId ? undefined : visible[0]);
  return <section aria-label={sections[section]}><h2>{sections[section]}</h2>
    <form className="admin-search" onSubmit={e=>{e.preventDefault();setOffset(0);setQuery(text.trim());}}>
      <label>{section==='members'?'닉네임·이메일 검색':'항목 검색'} <input type="search" value={text} onChange={e=>setText(e.target.value)}/></label>
      {section==='members' && <button>검색</button>}
    </form>
    {status==='loading' ? <p role="status">불러오는 중입니다.</p> : status==='error' ?
      <p role="alert">목록을 불러오지 못했습니다. <button onClick={refresh}>다시 시도</button></p> :
      section==='members' ? <>
        {!members.length && <p>조회된 회원이 없습니다.</p>}
        <div className="management-grid"><ul className="admin-list">{members.map(u=><li key={u.id}><button aria-pressed={selectedMember?.id===u.id} onClick={()=>setSelected(u.id)}><strong>{u.name}</strong><span>{u.email}</span><small>{u.admin?'관리자':'회원'}</small></button></li>)}</ul>
        {selectedMember && <aside><h3>회원 정보 수정</h3><ul className="member-detail"><MemberRow key={selectedMember.id} user={selectedMember} refresh={refresh}/></ul></aside>}</div>
        {(offset>0 || more) && <div className="admin-tabs"><button disabled={!offset} onClick={()=>setOffset(offset-30)}>이전</button>
        <span>{Math.floor(offset/30)+1}페이지</span><button disabled={!more} onClick={()=>setOffset(offset+30)}>다음</button></div>}
      </> : <>
        {targetId && selected===targetId && !selectedRow && <p role="status">신고된 카드가 현재 목록에 없습니다.</p>}{!visible.length && <p>표시할 항목이 없습니다.</p>}
        <div className="management-grid"><ul className="admin-list">{visible.map((row,i)=><li key={String(row.admin_id??i)}>
          <button aria-pressed={row===selectedRow} onClick={()=>setSelected(String(row.admin_id??i))}><strong>{String(row.title)}</strong><small>{[row.store,row.game,row.source_name,row.audience==='global'?'글로벌 추천':row.audience==='kr'?'국내 추천':''].filter(Boolean).join(' · ')}</small></button>
        </li>)}</ul>{selectedRow && <aside><h3>{sections[section]} 정보 수정</h3><p>{String(selectedRow.title)}</p>
          {selectedRow.admin_id ? <AdminEdit key={String(selectedRow.admin_id)} section={section} row={selectedRow} onSaved={refresh}/> : <small>관리자 DB 설정 필요</small>}</aside>}</div>
      </>}
  </section>;
}

export function AdminDashboard() {
  const [section,setSection] = useState<Section|'reports'>('members');
  const [targetId,setTargetId] = useState('');
  return <section className="admin-dashboard"><h1>관리자 센터</h1>
    <nav aria-label="관리 항목" className="admin-tabs">{(Object.keys(sections) as Section[]).map(k=>
      <button key={k} aria-pressed={section===k} onClick={()=>{setTargetId('');setSection(k);}}>{sections[k]}</button>)}<button aria-pressed={section==='reports'} onClick={()=>setSection('reports')}>신고·문의함</button></nav>
    {section==='reports' ? <ReportInbox edit={(area,id)=>{setTargetId(id);setSection(area);}}/> :
      <Manager key={section} section={section} targetId={targetId}/>}
  </section>;
}

export function AdminAccess({member,children}:{member:string|null;children:ReactNode}) {
  const [management,setManagement] = useState(false);
  const [verified,setVerified] = useState<string|null>(null);
  useEffect(() => {
    setVerified(null);
    if (!member) return;
    const controller = new AbortController();
    fetch('/api/me/admin',{signal:controller.signal}).then(async r => {
      if (r.ok && (await r.json()).admin && !controller.signal.aborted) setVerified(member);
    }).catch(() => {});
    return () => controller.abort();
  },[member]);
  const active = !!member && verified === member;
  const [support,setSupport] = useState(false);
  const [target,setTarget] = useState<Target|null>(null);
  return <ReportContext.Provider value={item=>{setTarget(item);setSupport(true);}}>
    <nav className="admin-tabs" aria-label="화면 선택">
      <button aria-pressed={!support && !management} onClick={()=>{setSupport(false);setManagement(false);}}>게임 정보</button>
      <button aria-pressed={support} onClick={()=>{setTarget(null);setSupport(true);}}>신고·문의</button>
      {active && <button aria-pressed={!support && management} onClick={()=>{setSupport(false);setManagement(true);}}>관리자 센터</button>}
    </nav>
    {support ? <ReportForm key={target?.itemTitle??'general'} target={target}/> : active && management ? <AdminDashboard /> : children}
  </ReportContext.Provider>;
}