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

/**
 * Which RELEASE this station is, as one string, or nothing.
 *
 * The same shape as {@link buildRevision} and read from the same place — `ENV BUILD_VERSION`, set
 * from the `VERSION` build argument beside `REVISION` — for all the same reasons: absent is a real
 * answer, the empty string is folded into `undefined`, it is read once at boot, and it is a fact
 * about the binary rather than a setting an operator could edit.
 *
 * ## Absent is the COMMON answer here, not the edge case
 *
 * A revision is missing only for a hand-built image. A version is missing for every build that is
 * not a tagged release, which is every push to main — `latest` follows main, so the ordinary
 * station reports a commit and no version, and that is the honest reading rather than a gap. A page
 * showing both says "0.1.0, built from abc1234"; a page showing one says only what it knows.
 */
export function buildVersion(config: AppConfig): string | undefined {
    const version = String(config.get('BUILD_VERSION', '')).trim();
    return version === '' ? undefined : version;
}

/**
 * Both answers, as something a service can be handed.
 *
 * `HealthService` takes the bare string, because `HealthModule` is registered THIRD and must keep
 * depending on nothing — a token registered by a module further down the list would resolve fine
 * (resolution happens per request, long after every setup has run) and would still be exactly the
 * kind of edge that file's comment exists to forbid. Everything else injects this, which is why it
 * is registered in `DataModule` beside `Heartbeat` and `StationIdentity`: same argument, that the
 * chassis module is the one place in front of every reader.
 *
 * No `@Injectable()`, like `ArtStore`: it is never constructed by the container, only handed over
 * by the factory that read the config, and the class exists to be a DI token rather than a
 * behaviour.
 */
export class BuildRevision {
    constructor(
        readonly value?: string,
        readonly version?: string,
    ) {}
}
