# The database enforces no isolation, and several comments said it did

Status: **not built**, and deliberately not urgent. This records the design so the next pass does
not re-derive it, and so nobody trusts a control that does not exist.

**Written:** 2026-08-22, out of a review that went looking for the policies these claims referenced.
**State of the tree:** one station, one operator, no organizations, no tenants.

## What was claimed, and what is actually there

Nine places said or implied that row-level security enforces isolation here. The load-bearing
version, then in the root `CLAUDE.md` and now in `apps/api/CLAUDE.md`, read: *the runtime pool connects as the non-owner `app_user` role
so RLS actually enforces*. Three middleware comments went further and described an
`app.actor_org_id` GUC being pinned per request for org-isolation policies to read.

Measured against the tree:

- **No policies.** Across all 21 migrations there is not one `create policy` or
  `enable row level security`. Nothing is protected by RLS because no RLS exists.
- **No organizations.** There is no org or tenant table anywhere in the schema, so there is nothing
  for an isolation policy to isolate BY.
- **No `app.actor_org_id`.** `authorization.context.middleware.ts` sets no GUC at all — it has no
  `set_config`, no Kysely import and no `x-organization-id` handling. It resolves the actor, checks
  it still exists, and reads platform roles.
- **The GUCs that ARE set are read by nothing.** `audit.context.middleware.ts` and
  `TransactionalJob` both set `app.actor_type`, `app.actor_id`, `app.request_id` and `app.actor_ip`
  on their transaction. No trigger, policy or query anywhere calls `current_setting`.

## What IS real, and worth keeping

- `0000_initial.sql` creates `app_user` with `nologin nosuperuser noinherit nobypassrls` and grants
  it DML on tables plus usage on schemas and sequences. That is a genuine privilege split: the
  runtime path holds no DDL rights, so an injection on a runtime connection cannot alter the schema.
- `resolveOwnerConnection` / `resolveRuntimeConnection` keep the two roles apart in one place, and
  `DATABASE_APP_USER` falling back to the owner is what lets a one-credential development install
  work.
- The audit GUCs cost one statement on a connection already being set up, and a database-side audit
  trail is worth more the earlier it starts carrying real history.

So the seam is prepared and the enforcement is absent. The comments have been rewritten to say that.

## The one thing that must not happen

**Do not delete the per-request transaction on the grounds that the RLS reason was fiction.** It has
two other reasons and both are live:

1. `AfterCommit` means what it says — a deferred settings reload or plugin reinit runs when the
   request's work is durable.
2. A job enqueued during a request commits atomically with it, through the `PgBossConnectionProvider`
   override. Without the transaction, a worker can pick up a job describing work that then rolled
   back.

The exempt branch stands in for the first, which is why it runs `AfterCommit` itself.

## What building it would take

In rough order, and none of it is worth doing before there is a second tenant:

1. **An organization table and a membership table**, since a policy needs something to key on. This
   is the real work and the rest is mechanical.
2. **`app.actor_org_id` set per request**, in `authorization.context.middleware.ts` — validating any
   supplied org against the actor's actual memberships rather than trusting a header, which is what
   the old comment described and no code did. It must be `is_local` so it cannot leak between
   requests on a pooled connection, and `TransactionalJob` needs the same for the job path.
3. **`enable row level security` plus a policy per station-owned table**, reading
   `current_setting('app.actor_org_id')`. Decide deliberately whether to use `missing_ok`: without
   it a read outside a transaction RAISES, which is a loud failure and was the behaviour the old
   comments assumed.
4. **A third bar on `transaction.exemptions.ts`.** An exempt route has no transaction, so an
   `is_local` GUC does not survive its first statement — an exempt route would have to touch no
   protected table or open its own transaction. That list is no longer all one answer. Infra,
   streaming, art and now-playing touch nothing, and so does drafting a persona, which is why it
   could be exempted without thinking about this at all. The other three exempted for holding a
   model or an engine do READ station-owned tables with no transaction around the read: rehearsing a
   persona reads the persona, its notebook and its stories, and all three voice routes read the
   pronunciation lexicon. Not one of them writes a row, so they are not an isolation hole in the
   direction that matters most, but a policy that RAISES on a read with no GUC would break every one
   of them. That is an argument for `missing_ok` in step 3, or for those routes opening a short
   transaction of their own around the reads they make before the model call, which is where those
   reads already sit: they are deliberately made before the gate so the query is not held behind the
   one model or speech slot.
5. **Something that reads the audit GUCs**, if they are to be more than a seam: a trigger writing an
   audit row is the obvious one, and is a separate decision from isolation.

The order matters in one place only: policies before the GUC is set means every read fails, and the
GUC before policies exist is what the tree has now.
