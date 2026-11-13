---
paths:
    - 'apps/api/src/**/*.repository.ts'
    - 'apps/api/src/modules/data/**/*.ts'
    - 'apps/api/src/**/*.job.ts'
---

# Reading and writing the database

The reasoning is in `apps/api/CLAUDE.md` § "Reading and writing the database" and § "How work is dispatched".

- A SQL NULL reads back as `undefined` while `db.ts` types it `T | null`. Compare every optional column with `== null` / `!= null`, never `=== null`, which is always false.
- A repository's row mapper DROPS an absent optional, so the rest of the app sees `undefined` for "not set" and never `null`.
- There is no row-level security: no migration declares a policy and the `app.actor_*` settings are read by nothing. Do not rely on RLS for isolation, and do not delete the per-request transaction on the grounds that RLS was its reason. It still makes `AfterCommit` run on durable work and makes a job enqueued in a request commit with it.
- Work that must see its own row durable (a settings reload, a plugin reinit, anything that re-reads what the request wrote) goes through `AfterCommit`.
- Work that changes what airs is a director command on `DirectorMailbox`. Slow, outbound or retryable work nobody waits on is a pg-boss job. There is no general event bus; `StationBus` is only for a producer and subscriber on opposite sides of the module list.
- Sessions live in Redis and actors in Postgres. A schema reset without `pnpm flush:sessions` leaves tokens for users who no longer exist.
