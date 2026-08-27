import pg from 'pg';
for (const db of ['deadair','postgres']) {
  try {
    const c = new pg.Client({host:'localhost',port:55432,user:'postgres',password:'postgres',database:db});
    await c.connect();
    const r = await c.query("select key, dj_name, active, updated_at from deadair.personas where key in ('conspiracy','theorist')");
    console.log(db, r.rows);
    const s = await c.query("select persona_key, title, state, times_told from deadair.persona_stories where persona_key in ('conspiracy','theorist')");
    console.log(db, s.rows);
    await c.end();
  } catch (e) { console.log(db, 'FAILED', e.message); }
}
