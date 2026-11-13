---
paths:
    - 'apps/api/data/migrations/**/*.sql'
    - 'apps/api/.kysely-codegenrc.json'
    - 'apps/api/scripts/sync.enum.overrides.ts'
---

# Migrations

dbmate SQL under `apps/api/data/migrations`, schema `deadair`, each file with a `-- migrate:up` and a `-- migrate:down` section and named `NNNN_snake_case.sql` with the next free number. `apps/api/tests/data/migrations.version.test.ts` fails on a shared number.

- Append only. Never edit a migration that has run: the live station applies each number once and skips it after that. A change to an existing table is a new file.
- Explain the why at the top of the up section, as the existing files do: what the column is for and what went wrong without it.
- After writing one, run `pnpm build:data` (migrate:up, then `sync:enum-overrides` and kysely-codegen) against a database migrated from this branch, and commit `apps/api/src/modules/data/db.ts` and `.kysely-codegenrc.json` with it. The `generated` CI job walks every migration from zero and fails on anything that moved.
- A worktree has no `apps/api/.env`. Migrate a scratch database, never the dev one, and probe the port before starting a throwaway container.
- An enum column (`ALTER TABLE ... ADD COLUMN x text not null default 'a' constraint ... check (x in (...))`) must appear in `.kysely-codegenrc.json` with its `Generated<>` wrapper when it has a default, or every insert has to name it. Check the key after `pnpm sync:enum-overrides`.
- A value list is written four times: the `.ck` contract, the CHECK constraint, the kysely override and `db.ts`. Widening one means widening all four; only the first two are type-checked against each other.
- The runtime role `app_user` has DML only. Grant what a new table needs the way the existing migrations do.
