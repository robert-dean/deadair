/**
 * The community catalogue, read in the browser from the deadair-community repository's Pages site.
 *
 * Fetched at runtime rather than at build so that an entry merged there is on this site within a
 * page load, with no deploy here, and so that this site's build never depends on that one being up.
 * Anything that goes wrong (the fetch, the format, one malformed entry) degrades to less on the page
 * and never to an error: the catalogue is a directory, and a directory that is briefly empty is
 * better than a page that throws.
 *
 * The types mirror the JSON Schemas under `schemas/` in that repository, which are what its builder
 * validates against. Only the fields the pages use are named.
 */

/**
 * Where the catalogue is published. A build can point somewhere else with `DEADAIR_COMMUNITY_ORIGIN`
 * (see `customFields` in docusaurus.config.ts): a fork of the catalogue, or its `dist/` served locally
 * while working on both at once.
 */
export const DEFAULT_ORIGIN = 'https://robert-dean.github.io/deadair-community';

const CATALOG_FORMAT = 'deadair.catalog/1';
const STATUS_FORMAT = 'deadair.status/1';

export const communityRepository = 'https://github.com/robert-dean/deadair-community';
/** The issue form that submits a kind of entry. */
export const submitUrl = (form: 'add-station' | 'add-persona' | 'add-plugin' | 'add-app') => `${communityRepository}/issues/new?template=${form}.yml`;
export const takedownUrl = `${communityRepository}/blob/main/TAKEDOWN.md`;

/** Who put an entry in the catalogue, and when. */
export interface Listing {
    submittedBy: string;
    dateAdded: string;
    dateModified?: string;
}

export interface CatalogStation {
    slug: string;
    name: string;
    url: string;
    location?: string;
    genres?: string[];
    language?: string;
    description: string;
    listing: Listing;
}

export interface CatalogPlugin {
    slug: string;
    id: string;
    name: string;
    description: string;
    author: string;
    repository: string;
    license: string;
    version: string;
    apiVersion: string;
    capabilities: string[];
    hosts: string[];
    hostsFromConfig?: boolean;
    package?: { tarball: string; sha256: string };
    listing: Listing;
}

export interface CatalogApp {
    slug: string;
    name: string;
    kind: 'player' | 'remote' | 'integration' | 'library';
    platforms: string[];
    description: string;
    author: string;
    url: string;
    repository?: string;
    license?: string;
    firstParty?: boolean;
    listing: Listing;
}

/** The character in a persona entry: a `PersonaFilePersona`, as the station's persona contract defines it. */
export interface CatalogCharacter {
    key: string;
    kind?: 'host' | 'caller';
    label: string;
    style: string;
    djName?: string;
    background?: string;
    brevity?: string;
    latitude?: string;
    chattiness?: string;
    storytelling?: string;
    quirks?: string[];
    catchphrases?: string[];
    samples?: string[];
    stories: { title: string }[];
}

export interface CatalogPersona {
    slug: string;
    summary: string;
    author: string;
    /** Relative to the catalogue: see {@link catalogFile}. */
    download: string;
    persona: CatalogCharacter;
    listing: Listing;
}

export interface Catalog {
    stations: CatalogStation[];
    plugins: CatalogPlugin[];
    apps: CatalogApp[];
    personas: CatalogPersona[];
}

/** What a station answered the last time it was asked. */
export interface StationStatus {
    state: 'on-air' | 'off-air' | 'unreachable';
    checkedAt: string;
    lastAnsweredAt?: string;
    name?: string;
    /** Paths on the station's own address, as it listed them. */
    mounts?: { format: 'mp3' | 'aac' | 'opus' | 'flac' | 'hls'; path: string }[];
    show?: { name: string; host?: string };
    track?: { kind: 'record' | 'break'; artist?: string; title: string };
}

export const EMPTY_CATALOG: Catalog = { stations: [], plugins: [], apps: [], personas: [] };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isListing = (value: unknown): value is Listing => isObject(value) && isString(value.submittedBy) && isString(value.dateAdded);

/** The entries of one kind that have what a card cannot do without. The rest are dropped rather than failing the page. */
function entries<T>(value: unknown, required: readonly string[], extra?: (entry: Json) => boolean): T[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (entry): entry is Json =>
            isObject(entry) &&
            isString(entry.slug) &&
            isListing(entry.listing) &&
            required.every(field => isString(entry[field])) &&
            (extra?.(entry) ?? true),
    ) as T[];
}

const stringArray = (value: unknown) => Array.isArray(value) && value.every(isString);

/** A catalog.json body as the pages use it, or {@link EMPTY_CATALOG} when it is not one. */
export function parseCatalog(body: unknown): Catalog {
    if (!isObject(body) || body.format !== CATALOG_FORMAT) return EMPTY_CATALOG;
    return {
        stations: entries<CatalogStation>(body.stations, ['name', 'url', 'description']),
        plugins: entries<CatalogPlugin>(
            body.plugins,
            ['id', 'name', 'description', 'author', 'repository', 'license', 'version', 'apiVersion'],
            entry => stringArray(entry.capabilities) && stringArray(entry.hosts),
        ),
        apps: entries<CatalogApp>(body.apps, ['name', 'kind', 'description', 'author', 'url'], entry => stringArray(entry.platforms)),
        personas: entries<CatalogPersona>(
            body.personas,
            ['summary', 'author', 'download'],
            entry => isObject(entry.persona) && isString(entry.persona.key) && isString(entry.persona.label) && isString(entry.persona.style),
        ),
    };
}

/** A status.json body as slug to status, or nothing when it is not one. */
export function parseStatus(body: unknown): Record<string, StationStatus> {
    if (!isObject(body) || body.format !== STATUS_FORMAT || !isObject(body.stations)) return {};
    const statuses: Record<string, StationStatus> = {};
    for (const [slug, status] of Object.entries(body.stations)) {
        if (isObject(status) && ['on-air', 'off-air', 'unreachable'].includes(status.state as string) && isString(status.checkedAt)) {
            statuses[slug] = status as unknown as StationStatus;
        }
    }
    return statuses;
}

const MOUNT_PATH = /^\/[A-Za-z0-9._-]{1,60}$/;
const MOUNT_FORMATS = ['mp3', 'aac', 'opus', 'flac', 'hls'];

const text = (value: unknown, max: number) => (isString(value) && value.trim() !== '' ? value.trim().slice(0, max) : undefined);

/**
 * A station's own `GET /api/nowplaying` answer as a card's status, or undefined when it is not one.
 *
 * The same reading the catalogue's probe does before it writes status.json (stations.status.mjs in
 * that repository): only the fields a card shows, each checked and cut to length, and a mount only as
 * a path on the station itself, because this is somebody else's server answering.
 */
export function readNowPlaying(body: unknown, checkedAt: string): StationStatus | undefined {
    if (!isObject(body) || typeof body.onAir !== 'boolean') return undefined;
    const status: StationStatus = { state: body.onAir ? 'on-air' : 'off-air', checkedAt, lastAnsweredAt: checkedAt };

    const name = text(body.station, 80);
    if (name !== undefined) status.name = name;

    if (Array.isArray(body.mounts)) {
        const mounts = body.mounts
            .filter(isObject)
            .filter(mount => isString(mount.path) && MOUNT_PATH.test(mount.path) && MOUNT_FORMATS.includes(mount.format as string))
            .slice(0, 8)
            .map(mount => ({ format: mount.format, path: mount.path }) as NonNullable<StationStatus['mounts']>[number]);
        if (mounts.length > 0) status.mounts = mounts;
    }

    if (isObject(body.show)) {
        const show = text(body.show.name, 120);
        const host = text(body.show.host, 80);
        if (show !== undefined) status.show = host === undefined ? { name: show } : { name: show, host };
    }

    if (isObject(body.track) && (body.track.kind === 'record' || body.track.kind === 'break')) {
        const artist = text(body.track.artist, 200);
        const title = text(body.track.title, 200);
        if (title !== undefined) status.track = artist === undefined ? { kind: body.track.kind, title } : { kind: body.track.kind, artist, title };
    }
    return status;
}

/**
 * What a station says is on air right now, asked directly, or undefined when it will not say.
 *
 * A station answers another origin's browser since it began sending an open CORS header on this one
 * route. One on an older version answers too, but the browser refuses to hand the answer over, which
 * lands here as a failed fetch and leaves the card on the catalogue's last check.
 */
export async function fetchNowPlaying(
    stationUrl: string,
    fetcher: typeof fetch = fetch,
    now: () => Date = () => new Date(),
): Promise<StationStatus | undefined> {
    const body = await fetchJson(`${stationUrl}/api/nowplaying`, fetcher);
    return body === undefined ? undefined : readNowPlaying(body, now().toISOString());
}

/** The body at a URL as JSON, or undefined for any failure at all. */
async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
    try {
        const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
        return response.ok ? await response.json() : undefined;
    } catch {
        return undefined;
    }
}

export interface CommunityData {
    catalog: Catalog;
    status: Record<string, StationStatus>;
    /** Where it came from, which is where a relative path in it, such as a persona's download, is served. */
    origin: string;
}

/** Both documents, fetched side by side. Never rejects. */
export async function loadCommunity(origin: string = DEFAULT_ORIGIN, fetcher: typeof fetch = fetch): Promise<CommunityData> {
    const [catalog, status] = await Promise.all([fetchJson(`${origin}/catalog.json`, fetcher), fetchJson(`${origin}/status.json`, fetcher)]);
    return { catalog: parseCatalog(catalog), status: parseStatus(status), origin };
}

/** A listing's date as a card prints it: `18 Sep 2026`. */
export const formatDate = (date: string) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isNaN(parsed.getTime())
        ? date
        : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** How long ago an ISO-8601 moment was, as a card says it: `4 minutes ago`. */
export function timeAgo(moment: string, now: number = Date.now()): string | undefined {
    const then = Date.parse(moment);
    if (Number.isNaN(then)) return undefined;
    const seconds = Math.round((then - now) / 1000);
    const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['day', 86_400],
        ['hour', 3_600],
        ['minute', 60],
    ];
    for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
    return 'just now';
}

/**
 * Where a listener tunes in: the station's MP3 mount when it lists one, since every browser plays
 * it, then whatever it does list, and `/live.mp3` when it has not answered, which every station
 * serves unless its operator turned it off.
 */
export function listenUrl(station: CatalogStation, status: StationStatus | undefined): string {
    const mounts = status?.mounts ?? [];
    const mount = mounts.find(entry => entry.format === 'mp3') ?? mounts.find(entry => entry.format !== 'hls') ?? mounts[0];
    return `${station.url}${mount?.path ?? '/live.mp3'}`;
}

/** A BCP 47 tag as a reader says it: `en-GB` is `British English`. The tag itself when the browser cannot name it. */
export function languageName(tag: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
    } catch {
        return tag;
    }
}
