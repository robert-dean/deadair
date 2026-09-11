## What this changes, and why

<!-- The why is the part worth writing. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass locally
- [ ] Tests are in the package's top-level `tests/`, mirroring `src/`
- [ ] Generated output is regenerated and committed beside its input, never hand-edited
      (`.ck` files: `pnpm build:contracts`; `.perm` files: `pnpm build:permissions`)
- [ ] A change somebody running or listening to the station would notice has a changeset
      (`pnpm changeset`)
- [ ] I read the scoped `CLAUDE.md` or `docs/internals/*.md` covering what I changed

<!--
CI on a pull request from a fork waits for a maintainer to approve each run. That is the
repository's setting for every outside contributor, not a judgement on this change.
-->
