import { forward } from './socks.tmp.mjs';
import pg from 'pg';
const u = new URL(process.env.UNRAID_DATABASE_URL);
const server = await forward(54329, u.hostname, Number(u.port || 5432));
const c = new pg.Client({ host: '127.0.0.1', port: 54329, user: u.username, password: u.password, database: u.pathname.slice(1) });
await c.connect();
const q = await c.query(`
  select id, kind, state, airs_at, created_at, updated_at, claims_item_id is not null as claims, production_id is not null as inproduction
  from deadair.segments where airs_at is not null and airs_at > now() - interval '60 minutes' order by airs_at`);
for (const r of q.rows) console.log(`${r.airs_at.toISOString().slice(11,19)}  ${String(r.kind).padEnd(9)} ${String(r.state).padEnd(8)} claims=${r.claims} prod=${r.inproduction}  id=${r.id.slice(0,8)} made=${r.created_at.toISOString().slice(11,19)}`);
const dup = await c.query(`select airs_at, count(*) as n, array_agg(kind) as kinds from deadair.segments where airs_at is not null group by airs_at having count(*) > 1 order by airs_at desc limit 10`);
console.log('\nduplicate airs_at:', dup.rows.map(r => `${r.airs_at.toISOString().slice(11,19)} x${r.n} ${r.kinds}`).join('\n  '));
await c.end(); server.close();
