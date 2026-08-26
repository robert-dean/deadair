import { forward } from './socks.tmp.mjs';
import pg from 'pg';
const u = new URL(process.env.UNRAID_DATABASE_URL);
const server = await forward(54329, u.hostname, Number(u.port || 5432));
const c = new pg.Client({ host: '127.0.0.1', port: 54329, user: u.username, password: u.password, database: u.pathname.slice(1) });
await c.connect();
const zone = 'America/New_York';
console.log('--- what each script claimed vs its own airs_at, in ' + zone + ' ---');
const q = await c.query(`
  select h.created_at, h.kind, s.airs_at, left(regexp_replace(h.script, '\\s+', ' ', 'g'), 60) as script
  from deadair.script_history h join deadair.segments s on s.id = h.segment_id
  where h.persona_key='videoage' and s.airs_at > now() - interval '60 minutes' and h.script is not null
  order by s.airs_at`);
for (const r of q.rows) {
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(r.airs_at);
    console.log(`airs ${local.padEnd(9)} (wrote ${r.created_at.toISOString().slice(11,16)}Z)  ${String(r.kind).padEnd(9)} ${r.script}`);
}
console.log('\n--- the three news segments stamped 20:30:15 ---');
const n = await c.query(`
  select s.id, s.state, s.airs_at, s.created_at, e.event, e.created_at as at
  from deadair.segments s left join deadair.segment_events e on e.segment_id = s.id
  where s.kind='news' and s.airs_at between '2026-08-26T20:30:00Z' and '2026-08-26T20:31:00Z'
  order by s.created_at, e.created_at`);
let last = '';
for (const r of n.rows) {
    if (r.id !== last) { console.log(`\nsegment ${r.id.slice(0,8)} ${r.state} airs_at ${r.airs_at.toISOString()} made ${r.created_at.toISOString().slice(11,19)}`); last = r.id; }
    if (r.event) console.log(`   ${r.at.toISOString().slice(11,19)} ${r.event}`);
}
await c.end(); server.close();
