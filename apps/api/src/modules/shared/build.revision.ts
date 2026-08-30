import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * What this station was built from, as one string, or nothing.
 *
 * The Dockerfile takes a `REVISION` build argument, writes it into the image twice — as the
 * standard `org.opencontainers.image.revision` label and as `BUILD_REVISION` in the runtime
 * environment — and CI passes the commit sha. This is the reader of the second one. The label
 * answers `docker inspect`, which needs the daemon and a shell; this answers `/health` and the
 * check-up page, which is where an operator already is.
 *
 * ## Absent is a real answer, and the common one
 *
 * Nothing sets this in the dev tree, and a hand-built image was built from a working tree rather
 * than from a commit. Both are honestly "unknown", so both get `undefined` rather than a
 * placeholder: a page that says `unknown` is telling the truth, and a page showing a sha nobody
 * built is worse than one showing nothing. That is also why the empty string is folded into
 * `undefined` here rather than passed on — `ENV BUILD_REVISION=${REVISION}` with no argument given
 * puts an empty variable in the environment, so "set to nothing" and "never set" arrive as
 * different values for the same fact and the rest of the app should not have to know that.
 *
 * ## Read once, at boot
 *
 * Every caller resolves this at module setup and hands the value to the service, rather than
 * holding the `AppConfig` and reading it per request. `AppConfig` is a LIVE view over
 * `deadair.settings`, so a per-request read would suggest this can change while the process runs,
 * and it cannot: the process was built from what it was built from. A restart is the only thing
 * that moves it, and a restart re-reads this anyway.
 *
 * It is not a setting and must never become one. `settings.registry.ts` is for things an operator
 * chooses; this is a fact about the binary, and an operator who could edit it could make the
 * station lie about its own provenance — which is the single thing this value exists to prevent.
 */
export function buildRevision(config: AppConfig): string | undefined {
    const revision = String(config.get('BUILD_REVISION', '')).trim();
    return revision === '' ? undefined : revision;
}
