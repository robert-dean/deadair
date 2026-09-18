import { useEffect, useState } from 'react';

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

const origin = 'https://robert-dean.github.io/deadair-community';

export const CATALOG_URL = `${origin}/catalog.json`;
export const STATUS_URL = `${origin}/status.json`;
/** Where a relative path inside the catalogue, such as a persona's download, is served from. */
export const catalogFile = (path: string) => `${origin}/${path}`;

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

/** The body at a URL as JSON, or undefined for any failure at all. */
async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
    try {
        const response = await fetcher(url, { headers: { accept: 'application/json' } });
        return response.ok ? await response.json() : undefined;
    } catch {
        return undefined;
    }
}

export interface CommunityData {
    catalog: Catalog;
    status: Record<string, StationStatus>;
}

/** Both documents, fetched side by side. Never rejects. */
export async function loadCommunity(fetcher: typeof fetch = fetch): Promise<CommunityData> {
    const [catalog, status] = await Promise.all([fetchJson(CATALOG_URL, fetcher), fetchJson(STATUS_URL, fetcher)]);
    return { catalog: parseCatalog(catalog), status: parseStatus(status) };
}

let loading: Promise<CommunityData> | undefined;

/**
 * The catalogue for a page, fetched once per visit however many pages ask. `undefined` until it
 * arrives, which is also what the static build renders, since effects do not run there.
 */
export function useCommunity(): CommunityData | undefined {
    const [data, setData] = useState<CommunityData>();
    useEffect(() => {
        let current = true;
        loading ??= loadCommunity();
        void loading.then(result => {
            if (current) setData(result);
        });
        return () => {
            current = false;
        };
    }, []);
    return data;
}

/** A listing's date as a card prints it: `18 Sep 2026`. */
export const formatDate = (date: string) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isNaN(parsed.getTime())
        ? date
        : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
