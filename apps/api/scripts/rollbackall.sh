#! /bin/bash
# Roll back every applied migration. dbmate has no native "down all", so we call
# `migrate:down` (one rollback each) once per migration file. Migrations live in
# ./data/migrations relative to apps/api (where this script runs via
# `pnpm migrate:down:all`).
set -euo pipefail

MIGRATIONS_DIR="./data/migrations"

echo "Rolling back all migrations"
for migration in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$migration" ] || continue
  echo "Rolling back one migration (for $(basename "$migration"))"
  pnpm run migrate:down
done
