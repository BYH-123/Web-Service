export function GameCover({url}:{url:string}) {
  const id = /^https:\/\/store\.steampowered\.com\/app\/(\d+)(?:[/?#]|$)/i.exec(url)?.[1];
  if (!id) return null;
  return <img className="cover" key={id} alt="" loading="lazy"
    src={`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`}
    onError={event=>{event.currentTarget.hidden=true;}} />;
}
