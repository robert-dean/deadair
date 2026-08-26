import { forward } from './socks.tmp.mjs';
import pg from 'pg';
const u = new URL(process.env.UNRAID_DATABASE_URL);
const server = await forward(54329, u.hostname, Number(u.port || 5432));
const c = new pg.Client({ host: '127.0.0.1', port: 54329, user: u.username, password: u.password, database: u.pathname.slice(1) });
await c.connect();
const s = await c.query(`select key, value from deadair.settings where key in ('station.timezone','station.name') order by key`);
console.log('settings:', JSON.stringify(s.rows));
console.log('db now():', (await c.query('select now() as n')).rows[0].n.toISOString());

const q = await c.query(`
  select h.created_at, h.kind, h.writer, h.label, s.airs_at, s.state, s.id as segment_id, left(h.script, 90) as script
  from deadair.script_history h
  left join deadair.segments s on s.id = h.segment_id
  where h.persona_key = 'videoage' and h.created_at > now() - interval '90 minutes'
  order by h.created_at desc limit 14`);
for (const r of q.rows) {
    console.log(`${r.created_at.toISOString().slice(11,19)} write | airs_at ${r.airs_at ? r.airs_at.toISOString().slice(11,19) : '   none  '} | ${String(r.kind).padEnd(9)} ${String(r.state ?? '-').padEnd(8)} ${r.script?.replace(/\n/g,' ').slice(0,70)}`);
}
await c.end(); server.close();
