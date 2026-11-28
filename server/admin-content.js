import express from 'express';
import { createHash } from 'node:crypto';

const fields = {
  upcoming: { title:'text', source_url:'url', releases:'releases' },
  deals: { title:'text', product_url:'url', original_price:'price', sale_price:'price', discount_percent:'percent', price_note:'optional', ends_at:'optionalTime' },
  esports: { title:'text', game:'text', watch_url:'optionalUrl', event_url:'optionalUrl', starts_at:'time' },
  news: { title:'text', summary:'optional', category:'text', source_name:'text', source_url:'url' },
};
const identity = {
  upcoming: r => [r.audience, r.slot, r.slug],
  deals: r => [r.store, r.product_id, r.offer_type],
  esports: r => r.slug,
  news: r => r.source_url,
};
function validDate(v) {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().startsWith(v);
}
function valid(type, v) {
  switch (type) {
    case 'text': return typeof v === 'string' && !!v.trim() && v.length <= 250;
    case 'optional': return typeof v === 'string' && v.length <= 3000;
    case 'optionalUrl': if (v === null) return true;
    case 'url': return typeof v === 'string' && v.length <= 2048 && URL.canParse(v) && new URL(v).protocol === 'https:';
    case 'price': return v === null || Number.isSafeInteger(v) && v >= 0;
    case 'percent': return v === null || Number.isInteger(v) && v >= 0 && v <= 100;
    case 'optionalTime': if (v === null) return true;
    case 'time': return typeof v === 'string' && validDate(v.slice(0,10)) && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
    case 'releases': return Array.isArray(v) && v.length <= 24 && v.every(r => r && valid('text',r.platform) &&
      (r.release_date === null || validDate(r.release_date)) && (r.release_year == null || Number.isInteger(r.release_year) && r.release_year >= 1970 && r.release_year <= 9999) &&
      typeof r.confirmed_released === 'boolean' && Object.keys(r).every(k => ['platform','release_year','release_date','confirmed_released'].includes(k)));
    default: return false;
  }
}
export function mountAdmin(app, pool, requireMember) {
  const adminId = process.env.GAME_ADMIN_USER_ID?.trim();
  const isAdmin = res => !!adminId && res.locals.member === adminId;
  app.get('/api/me/admin', requireMember, (_req,res) => res.json({ admin:isAdmin(res) }));
  app.use('/api/admin/content', requireMember, (_req,res,next) => isAdmin(res) ? next() : res.sendStatus(403));
  const path = '/api/admin/content/:section/:id';
  app.use(path, (req,res,next) => Object.hasOwn(fields,req.params.section) && /^[a-f0-9]{64}$/.test(req.params.id) ? next() : res.sendStatus(400));
  app.put(path, express.json({limit:'24kb'}), async (req,res) => {
    const {section,id} = req.params;
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length ||
      !Object.entries(patch).every(([k,v]) => Object.hasOwn(fields[section],k) && valid(fields[section][k],v))) return res.sendStatus(400);
    await pool.query(`insert into game_auth.content_edits as e (section,item_id,patch) values ($1,$2,$3)
      on conflict(section,item_id) do update set patch=e.patch || excluded.patch`,[section,id,JSON.stringify(patch)]);
    res.sendStatus(204);
  });
  app.delete(path, async (req,res) => {
    await pool.query('delete from game_auth.content_edits where section=$1 and item_id=$2',[req.params.section,req.params.id]);
    res.sendStatus(204);
  });
  return async function applyEdits(section, rows) {
    if (!rows.length) return rows;
    const ids = rows.map(row => createHash('sha256').update(JSON.stringify(identity[section](row))).digest('hex'));
    let edits;
    try {
      edits = await pool.query('select item_id,patch from game_auth.content_edits where section=$1 and item_id=any($2::text[])',[section,ids]);
    } catch (error) {
      if (error.code === '42P01') return rows;
      throw error;
    }
    const patches = new Map(edits.rows.map(r => [r.item_id,r.patch]));
    return rows.map((row,i) => {
      const patch = patches.get(ids[i]);
      const edited = {...row,...patch,admin_id:ids[i],admin_edited:!!patch};
      if (section === 'upcoming' && patch?.releases) edited.manual_releases = true;
      if (section === 'esports' && patch && 'watch_url' in patch) edited.streams = patch.watch_url ? [patch.watch_url] : [];
      return edited;
    });
  };
}