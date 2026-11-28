import { useState } from 'react';

type Props = {url:string; imageUrl?:string|null};
export function GameCover({url,imageUrl}:Props) {
  const [failed,setFailed] = useState('');
  const id = /^https:\/\/store\.steampowered\.com\/app\/(\d+)(?:[/?#]|$)/i.exec(url)?.[1];
  const src = imageUrl || (id && `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`);
  if (!src || failed === src) return null;
  return <img className="cover" key={src} alt="" loading="lazy" src={src} onError={()=>setFailed(src)}/>;
}