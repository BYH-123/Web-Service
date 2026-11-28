import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const areas = {general:'사이트 전반',upcoming:'출시 예정 게임',deals:'할인·프로모션',esports:'대회·방송',news:'게임 뉴스'};
const categories = {image:'이미지 오류',issue:'이용 불편',question:'문의'};
const statuses = {open:'접수',working:'확인 중',done:'처리 완료'};
type ImageSection = 'upcoming'|'deals';

export function ReportForm() {
  const [requestId,setId] = useState(()=>crypto.randomUUID());
  const [busy,setBusy] = useState(false);
  const [sent,setSent] = useState(false);
  const [error,setError] = useState('');
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({requestId,category:data.get('category'),section:data.get('section'),
          itemId:null,itemTitle:data.get('itemTitle')??'',message:data.get('message')})});
      if (!res.ok) throw Error();
      setSent(true);
    } catch {setError('접수하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.');}
    finally {setBusy(false);}
  }
  return <section className="support-panel"><h1>신고·문의</h1>{sent ? <>
    <p role="status">접수됐습니다. 관리자 센터로 전달했습니다.</p>
    <button onClick={()=>{setId(crypto.randomUUID());setSent(false);}}>새 문의 작성</button></> :
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>문의 유형<select name="category" defaultValue="issue">{Object.entries(categories).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
        <label>관련 화면<select name="section">{Object.entries(areas).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
        <label>항목 이름 (선택)<input name="itemTitle" maxLength={250}/></label>
      <label>내용<textarea name="message" required maxLength={2000} rows={5}/></label>
      <button>{busy?'접수 중…':'관리자에게 보내기'}</button>
      {error && <p role="alert">{error}</p>}
    </fieldset></form>}</section>;
}

type Report = {id:string;category:keyof typeof categories;section:keyof typeof areas;item_id:string|null;item_title:string;message:string;status:keyof typeof statuses;created_at:string};
export function ReportInbox({edit}:{edit:(section:ImageSection,id:string)=>void}) {
  const [pages,setPages] = useState<string[]>(['']);
  const [revision,setRevision] = useState(0);
  const [rows,setRows] = useState<Report[]>([]);
  const [more,setMore] = useState(false);
  const [state,setState] = useState('loading');
  const [saving,setSaving] = useState('');
  const [error,setError] = useState('');
  const before = pages[pages.length-1];
  useEffect(()=>{
    const controller = new AbortController();
    setState('loading');setError('');
    fetch('/api/admin/reports'+(before?'?before='+before:''),{signal:controller.signal}).then(async r=>{
      if (!r.ok) throw Error();
      const data = await r.json();
      if (!controller.signal.aborted) {setRows(data.reports);setMore(data.more);setState('ready');}
    }).catch(()=>{if (!controller.signal.aborted) setState('error');});
    return ()=>controller.abort();
  },[before,revision]);
  async function update(id:string,status:Report['status']) {
    setSaving(id);setError('');
    try {
      const r = await fetch('/api/admin/reports/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
      if (!r.ok) throw Error();
      setRows(prev=>prev.map(row=>row.id===id?{...row,status}:row));
    } catch {setError('처리 상태를 저장하지 못했습니다. 다시 시도해 주세요.');}
    finally {setSaving('');}
  }
  return <section><h2>신고·문의함</h2><button onClick={()=>setRevision(n=>n+1)}>새로고침</button>
    {state==='loading'?<p role="status">불러오는 중입니다.</p>:state==='error'?<p role="alert">문의 목록을 불러오지 못했습니다.</p>:<>
    {!rows.length && <p>접수된 문의가 없습니다.</p>}
    {rows.map(r=><article className="support-ticket" key={r.id}><h3>#{r.id} · {categories[r.category]}</h3>
      <small>{new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (KST) · {areas[r.section]}</small>
      {r.item_title && <p><strong>{r.item_title}</strong></p>}<p className="report-body">{r.message}</p>
      <label>처리 상태 <select value={r.status} disabled={!!saving} onChange={e=>void update(r.id,e.target.value as Report['status'])}>
      {Object.entries(statuses).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      {r.item_id && (r.section==='upcoming'||r.section==='deals') && <button onClick={()=>edit(r.section as ImageSection,r.item_id!)}>해당 카드 이미지 수정</button>}
    </article>)}
    {error && <p role="alert">{error}</p>}
    {pages.length>1 && <button onClick={()=>setPages(p=>p.slice(0,-1))}>이전</button>}
    {more && <button onClick={()=>setPages(p=>[...p,rows[rows.length-1].id])}>다음</button>}</>}
    </section>;
}