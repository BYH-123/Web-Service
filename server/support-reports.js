import express from 'express';

export function mountReports(app, pool) {
  // Retry requests keep their original receipt, including after a lost response.
  app.post('/api/reports', express.json({limit:'16kb'}), async (req,res) => {
    const {requestId,category,section,itemId,itemTitle,message} = req.body ?? {};
    if (typeof requestId !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestId) ||
        !['image','issue','question'].includes(category) || !['general','upcoming','deals','esports','news'].includes(section) ||
        (itemId !== null && (typeof itemId !== 'string' || !/^[a-f0-9]{64}$/.test(itemId) || !['upcoming','deals'].includes(section))) ||
        typeof itemTitle !== 'string' || itemTitle.length>250 || typeof message !== 'string' || !message.trim() || message.length>2000) return res.sendStatus(400);
    const result = await pool.query(`insert into game_auth.support_reports (request_id,category,section,item_id,item_title,message)
      values ($1,$2,$3,$4,$5,$6) on conflict(request_id) do nothing`,[requestId,category,section,itemId,itemTitle.trim(),message.trim()]);
    res.sendStatus(result.rowCount ? 201 : 200);
  });
  // /api/admin is protected by the existing session and administrator middleware.
  app.get('/api/admin/reports', async (req,res) => {
    const before = req.query.before ?? null;
    if (before !== null && (typeof before !== 'string' || !/^[1-9]\d{0,17}$/.test(before))) return res.sendStatus(400);
    const {rows} = await pool.query(`select id,category,section,item_id,item_title,message,status,created_at
      from game_auth.support_reports where ($1::bigint is null or id<$1) order by id desc limit 31`,[before]);
    res.json({reports:rows.slice(0,30), more:rows.length>30});
  });
  app.patch('/api/admin/reports/:id',express.json({limit:'1kb'}),async (req,res) => {
    const status = req.body?.status;
    if (!['open','working','done'].includes(status) || !/^[1-9]\d{0,17}$/.test(req.params.id)) return res.sendStatus(400);
    const result = await pool.query('update game_auth.support_reports set status=$1 where id=$2',[status,req.params.id]);
    res.sendStatus(result.rowCount ? 204 : 404);
  });
}