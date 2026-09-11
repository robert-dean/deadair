# Changesets

A changeset is a file here that names the packages a change touches, how far it bumps each, and a
paragraph for the changelog. `pnpm changeset` writes one. Four things are released from this tree,
and a changeset can name any of them:

- **The station**: every `@deadair/*` package under `apps/api`, `apps/web`, `packages/` and
  `plugins/`. They ship in one image and share one version, so naming any one of them bumps them
  all. Name the one you changed.
- **`@deadair/android`**, the Android listener.
- **`@deadair/desktop`**, the desktop listener and desk.
- **`@deadair/ios`**, the iOS listener.

The paragraph becomes a bullet in that unit's changelog, word for word, so write it for whoever runs
the station or listens to it. `@deadair/site` and the `@repo/*` configs are not versioned, and a
changeset cannot name one of them beside a package that is.

How a release is cut from these files is in `CONTRIBUTING.md`, under "Releasing".
