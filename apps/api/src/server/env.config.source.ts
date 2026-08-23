import { nestKeys, type AppConfigSource } from '@maroonedsoftware/appconfig';

/**
 * The process environment, as a configuration layer.
 *
 * `AppConfigSourceDotenv` reads a FILE and populates `process.env` from it; nothing in the
 * pipeline reads the other way, so before this existed a variable set by the operator — the only
 * way anything is configured in a container, where there is no `.env` to write — reached dbmate
 * and the shell scripts around the app and then stopped. The app itself fell through to the
 * defaults in code, which is how a station handed a database on another host tried to open a
 * connection to itself.
 *
 * Two properties are load-bearing.
 *
 * The snapshot is taken ONCE, when this is constructed, and every later `load()` answers with the
 * same copy. That is not an optimization: `scrubProcessEnv()` deletes the secrets from
 * `process.env` after boot, and the store re-runs its sources on every settings change, so a
 * source reading `process.env` live would answer with the database password on the first pass and
 * with nothing at all on the second — losing the credentials at some arbitrary later moment,
 * silently, which is the same trap that keeps `${env:…}` templates out of the settings source.
 *
 * The nesting matches the dotenv layer's, so `A__B=1` means the same thing whichever of the two
 * it arrives through. Anything else would make the file and the environment two dialects of one
 * vocabulary.
 */
export class AppConfigSourceEnv implements AppConfigSource {
    private readonly snapshot: Record<string, unknown>;

    constructor(groupSeparator = '__', environment: NodeJS.ProcessEnv = process.env) {
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(environment)) {
            if (value !== undefined) flat[key] = value;
        }

        this.snapshot = groupSeparator ? nestKeys(flat, groupSeparator) : flat;
    }

    async load(): Promise<Record<string, unknown>> {
        return this.snapshot;
    }

    async get(key: string): Promise<unknown> {
        return this.snapshot[key];
    }

    /** Nothing to watch: this layer is what the process was started with and cannot change. */
    watch(): () => void {
        return () => {};
    }
}
