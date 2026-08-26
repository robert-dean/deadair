import { forward } from './socks.tmp.mjs';
import pg from 'pg';
const u = new URL(process.env.UNRAID_DATABASE_URL);
const server = await forward(54329, u.hostname, Number(u.port || 5432));
const c = new pg.Client({ host: '127.0.0.1', port: 54329, user: u.username, password: u.password, database: u.pathname.slice(1) });
await c.connect();
console.log('segment_events cols:', (await c.query(`select column_name from information_schema.columns where table_schema='deadair' and table_name='segment_events' order by ordinal_position`)).rows.map(r=>r.column_name).join(' '));
const n = await c.query(`
  select id, kind, state, airs_at, created_at, context
  from deadair.segments
  where kind='news' and airs_at between '2026-08-26T20:30:00Z' and '2026-08-26T20:32:00Z' order by created_at`);
for (const r of n.rows) console.log(`${r.id.slice(0,8)} ${String(r.state).padEnd(7)} airs_at ${r.airs_at.toISOString()} made ${r.created_at.toISOString().slice(11,19)} ctx=${JSON.stringify(r.context)}`);
await c.end(); server.close();
