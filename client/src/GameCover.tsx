import { useContext, useState } from 'react';
import { ReportContext } from './Reports';

type Props = {url:string; section:'upcoming'|'deals'; item:{title:string; admin_id?:string; image_url?:string|null}};
export function GameCover({url,section,item}:Props) {
  const report = useContext(ReportContext);
  const [failed,setFailed] = useState('');
  const id = /^https:\/\/store\.steampowered\.com\/app\/(\d+)(?:[/?#]|$)/i.exec(url)?.[1];
  const src = item.image_url || (id && `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`);
  if (!src) return null;
  if (failed === src) return <div className="cover-error">이미지를 불러오지 못했습니다. <button onClick={()=>report({section,itemId:item.admin_id??null,itemTitle:item.title})}>이미지 신고</button></div>;
  return <img className="cover" key={src} alt="" loading="lazy" src={src} onError={()=>setFailed(src)}/>;
}