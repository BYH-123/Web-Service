import { useId, useState } from 'react';
import type { FormEvent } from 'react';

const forms = {
  upcoming:['title','source_url'],
  news:['title','summary','category','source_name','source_url'],
  esports:['title','game','starts_at','watch_url','event_url'],
  deals:['title','product_url','original_price','sale_price','discount_percent','price_note','ends_at'],
} as const;
const labels:Record<string,string> = {title:'제목',source_url:'출처 링크',summary:'요약',category:'분류',source_name:'매체',game:'종목',starts_at:'시작 시각 (한국 시간)',watch_url:'중계 링크',event_url:'공식 일정 링크',product_url:'스토어 링크',original_price:'정가 (원)',sale_price:'할인가 (원)',discount_percent:'할인율 (%)',price_note:'가격 안내',ends_at:'종료 시각 (한국 시간)'};
type Release = {platform:string; release_date:string|null; release_year:number|null; confirmed_released:boolean};
function releases(row:Record<string,unknown>):Release[] {
  return Array.isArray(row.releases) ? row.releases.map(r => ({platform:r.platform, release_date:r.release_date ?? null,release_year:r.release_year ?? null,confirmed_released:!!r.confirmed_released})) : [];
}
function fieldType(k:string) {
  if (k.endsWith('_url')) return 'url';
  if (k.endsWith('_at')) return 'datetime-local';
  if (k.endsWith('_price') || k === 'discount_percent') return 'number';
  return 'text';
}
function display(k:string,v:unknown) {
  if (v == null) return '';
  if (fieldType(k) === 'datetime-local') return new Date(Date.parse(String(v))+9*3600000).toISOString().slice(0,16);
  return String(v);
}
export function AdminEdit({section,row,onSaved}:{onSaved:()=>void; section:keyof typeof forms; row:Record<string,unknown>}) {
  const id = useId();
  const [original,setOriginal] = useState<typeof row|null>(null);
  const [dates,setDates] = useState<Release[]>([]);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  if (!row.admin_id) return null;
  async function write(patch:Record<string,unknown>|null) {
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/admin/content/'+section+'/'+row.admin_id,{method:patch?'PUT':'DELETE',headers:{'Content-Type':'application/json'},body:patch?JSON.stringify(patch):undefined});
      if (!r.ok) throw Error(r.status === 403 || r.status === 401 ? '관리자 로그인을 확인해 주세요.' : r.status === 400 ? '입력값과 HTTPS 링크를 확인해 주세요.' : '저장하지 못했습니다. 서버 DB 설정을 확인해 주세요.');
      setOriginal(null); setBusy(false); onSaved();
    } catch(e) {setMessage(e instanceof Error ? e.message : '저장하지 못했습니다.');setBusy(false);}
  }
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!original) return;
    const data = new FormData(e.currentTarget);
    const patch:Record<string,unknown> = {};
    for (const k of forms[section]) {
      const v = String(data.get(k) ?? '').trim();
      if (v === display(k,original[k])) continue;
      const t = fieldType(k);
      patch[k] = t === 'number' ? (v ? Number(v) : null) : t === 'datetime-local' ? (v ? new Date(v+':00+09:00').toISOString() : null) : t === 'url' && !v ? null : v;
    }
    if (section === 'upcoming' && JSON.stringify(dates) !== JSON.stringify(releases(original))) patch.releases = dates;
    if (Object.keys(patch).length) void write(patch); else setOriginal(null);
  }
  return original ? <form className="account" aria-labelledby={id} onSubmit={submit}>
    <fieldset disabled={busy}><legend id={id}>{String(original.title)} 공개 정보 수정</legend>
    {forms[section].map(k => <label key={k}>{labels[k]} <input name={k} type={fieldType(k)} defaultValue={display(k,original[k])} min={fieldType(k)==='number'?0:undefined} max={k==='discount_percent'?100:undefined} required={['title','source_url','product_url','category','source_name','game','starts_at'].includes(k)}/></label>)}
    {section === 'upcoming' && <div>{dates.map((r,i) => <fieldset key={i}><legend>플랫폼 {i+1}</legend>
      <label>플랫폼 <input required value={r.platform} onChange={e=>setDates(dates.map((v,n)=>n===i?{...v,platform:e.target.value}:v))}/></label>
      <label>출시일 <input type="date" value={r.release_date??''} onChange={e=>setDates(dates.map((v,n)=>n===i?{...v,release_date:e.target.value||null}:v))}/></label>
      <label>출시 예정 연도 <input type="number" min="1970" max="9999" value={r.release_year??''} onChange={e=>setDates(dates.map((v,n)=>n===i?{...v,release_year:Number(e.target.value)||null}:v))}/></label>
      <label><input type="checkbox" checked={r.confirmed_released} onChange={e=>setDates(dates.map((v,n)=>n===i?{...v,confirmed_released:e.target.checked}:v))}/> 출시 완료</label>
      <button type="button" onClick={()=>setDates(dates.filter((_,n)=>n!==i))}>플랫폼 삭제</button></fieldset>)}
      <button type="button" onClick={()=>setDates([...dates,{platform:'',release_date:null,release_year:null,confirmed_released:false}])}>플랫폼 추가</button></div>}
    <button>공개 정보 저장</button> <button type="button" onClick={()=>setOriginal(null)}>취소</button>
    {row.admin_edited === true && <button type="button" onClick={()=>{if(window.confirm('이 항목의 관리자 수정을 모두 지우고 수집한 정보로 복원할까요?')) void write(null);}}>수집 정보로 복원</button>}
    {message && <p role="alert">{message}</p>}</fieldset></form> :
    <button type="button" onClick={()=>{setOriginal(row);setDates(releases(row));setMessage('');}}>관리자 수정</button>;
}