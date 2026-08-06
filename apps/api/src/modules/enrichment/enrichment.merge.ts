import type { ExternalId, ExternalLink, TrackEnrichment } from '@deadair/plugin-sdk';

/**
 * Taking several plugins' answers about one track and turning them into one
 * answer, plus the guard rail that decides what a plugin is allowed to have
 * said in the first place.
 *
 * Both halves are the host's policy, not a plugin's. A plugin says what it
 * found; what that is worth relative to another plugin, and whether it is
 * shaped like an enrichment at all, is decided here.
 */

/** Fields that accumulate across plugins rather than being decided by one of them. */
const LIST_FIELDS = ['genres', 'moods', 'facts', 'externalIds', 'links'] as const;

/** Fields that are one string each. */
const TEXT_FIELDS = ['artist', 'title', 'album', 'releaseDate', 'biography', 'musicalKey', 'label', 'isrc', 'artworkUrl'] as const;

/** Fields that are one number each. */
const NUMBER_FIELDS = ['year', 'bpm'] as const;

/**
 * Caps. A plugin is trusted code, but the upstream it read from is not, and
 * this payload goes into jsonb, onto a settings card, and eventually into a
 * DJ's mouth. None of these is a limit an honest plugin will ever reach.
 */
const MAX_TEXT = 2_000;
const MAX_BIOGRAPHY = 20_000;
const MAX_LIST = 50;

/** How deep a nested value in {@link StoredEnrichment.extra} may go before it is refused. */
const MAX_EXTRA_DEPTH = 5;

/** How large the whole `extra` object may serialize to. Refused whole rather than trimmed. */
const MAX_EXTRA_BYTES = 16_000;

/**
 * Keys that are never carried through to `extra`, whatever a plugin says.
 *
 * `__proto__` is the one that matters: an object parsed from an upstream's
 * JSON can carry it as an own property, and assigning it onto a plain object
 * sets the prototype instead of a key.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * What one plugin's answer looks like once it is ours: the fields this host
 * understands, plus whatever else that plugin said.
 *
 * `extra` is the deliberate hole in the type. A provider knows things the SDK
 * has no field for — a Discogs pressing note, a Last.fm listener count — and
 * `track_enrichment.data` is a jsonb column precisely so those survive. The
 * alternative is that every new kind of fact waits on an SDK release, which is
 * the coupling a plugin system exists to remove.
 *
 * Nothing reads `extra` as a known field. It does not merge across providers
 * (it does not have to: payloads are stored per provider, so two plugins'
 * unknown keys cannot collide) and it never promotes onto a canonical column.
 */
export type StoredEnrichment = Partial<TrackEnrichment> & { extra?: Record<string, unknown> };

const text = (value: unknown, max = MAX_TEXT): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const strings = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const list = value.map(entry => text(entry)).filter((entry): entry is string => entry !== undefined);
    return list.length > 0 ? list.slice(0, MAX_LIST) : undefined;
};

const externalIds = (value: unknown): ExternalId[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const list: ExternalId[] = [];
    for (const entry of value) {
        const source = text((entry as ExternalId | undefined)?.source, 200);
        const id = text((entry as ExternalId | undefined)?.id, 200);
        if (source && id) list.push({ source, id });
    }
    return list.length > 0 ? list.slice(0, MAX_LIST) : undefined;
};

/**
 * Links, narrowed to http(s).
 *
 * A `javascript:` or `data:` URL from an upstream would be rendered by the
 * console as something a human clicks, so the scheme check happens here rather
 * than being left to every consumer to remember.
 */
const links = (value: unknown): ExternalLink[] | undefined => {
    if (!Array.isArray(value)) return undefined;

    const list: ExternalLink[] = [];
    for (const entry of value) {
        const label = text((entry as ExternalLink | undefined)?.label, 200);
        const url = text((entry as ExternalLink | undefined)?.url);
        if (!label || !url) continue;

        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
        } catch {
            continue;
        }

        list.push({ label, url });
    }

    return list.length > 0 ? list.slice(0, MAX_LIST) : undefined;
};

/** Every key {@link sanitizeEnrichment} understands. Anything else is `extra`. */
const KNOWN_FIELDS = new Set<string>([...TEXT_FIELDS, ...NUMBER_FIELDS, ...LIST_FIELDS]);

/**
 * Whether a value can be stored as-is: JSON-safe, and not nested past
 * {@link MAX_EXTRA_DEPTH}.
 *
 * Narrower than "survives JSON.stringify" on purpose. A `Date` stringifies
 * happily and comes back a string, which is the silent type change the plugin
 * boundary rule exists to prevent.
 */
function isStorable(value: unknown, depth = 0): boolean {
    if (depth > MAX_EXTRA_DEPTH) return false;
    if (value === null) return true;

    const type = typeof value;
    if (type === 'string' || type === 'boolean') return true;
    if (type === 'number') return Number.isFinite(value as number);
    if (type !== 'object') return false;

    if (Array.isArray(value)) return value.every(entry => entry !== undefined && isStorable(entry, depth + 1));

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) return false;

    return Object.entries(value as Record<string, unknown>).every(
        ([key, entry]) => !FORBIDDEN_KEYS.has(key) && (entry === undefined || isStorable(entry, depth + 1)),
    );
}

/**
 * The facts a plugin returned that this host has no field for.
 *
 * Refused whole rather than trimmed when it is too large: a plugin handing over
 * a megabyte of upstream response has a bug, and half of that response stored
 * silently is a worse outcome than none of it and a log line.
 */
function extraFields(raw: Record<string, unknown>, onDrop?: (reason: string) => void): Record<string, unknown> | undefined {
    const entries: [string, unknown][] = [];

    for (const [key, value] of Object.entries(raw)) {
        if (KNOWN_FIELDS.has(key) || FORBIDDEN_KEYS.has(key) || value === undefined) continue;

        // A plugin that fills `extra` itself is saying the same thing the host
        // means by it, so its entries are folded in rather than nested.
        const pairs =
            key === 'extra' && isStorable(value) && value !== null && !Array.isArray(value) ? Object.entries(value) : [[key, value] as const];

        for (const [name, entry] of pairs) {
            if (KNOWN_FIELDS.has(name) || FORBIDDEN_KEYS.has(name) || entry === undefined) continue;
            if (!isStorable(entry)) {
                onDrop?.(`"${name}" is not storable`);
                continue;
            }
            entries.push([name, entry]);
        }
    }

    if (entries.length === 0) return undefined;

    const extra = Object.fromEntries(entries);
    if (JSON.stringify(extra).length > MAX_EXTRA_BYTES) {
        onDrop?.(`extra fields exceed ${MAX_EXTRA_BYTES} bytes`);
        return undefined;
    }

    return extra;
}

/**
 * One plugin's answer, with the fields this host understands checked against
 * the types they were promised in, and everything else kept under `extra`.
 *
 * A known field of the wrong type is dropped rather than corrected: a plugin
 * that returns a number for `artist` has a bug, and storing `"42"` would hide
 * it while making the catalog worse. An *unknown* field is a different thing
 * entirely — not a bug, just a fact the SDK has not named yet — so it is kept.
 * What both share is the validation: caps, finite numbers, and links narrowed
 * to http(s), because this payload reaches a settings card, the console and
 * eventually an LLM prompt no matter which half it came from.
 */
export function sanitizeEnrichment(value: unknown, onDrop?: (reason: string) => void): StoredEnrichment {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const clean: StoredEnrichment = {};

    for (const field of TEXT_FIELDS) {
        const parsed = text(raw[field], field === 'biography' ? MAX_BIOGRAPHY : MAX_TEXT);
        if (parsed !== undefined) clean[field] = parsed;
    }

    for (const field of NUMBER_FIELDS) {
        const parsed = finite(raw[field]);
        if (parsed !== undefined) clean[field] = parsed;
    }

    const genres = strings(raw.genres);
    if (genres) clean.genres = genres;
    const moods = strings(raw.moods);
    if (moods) clean.moods = moods;
    const facts = strings(raw.facts);
    if (facts) clean.facts = facts;

    const ids = externalIds(raw.externalIds);
    if (ids) clean.externalIds = ids;
    const linkList = links(raw.links);
    if (linkList) clean.links = linkList;

    const extra = extraFields(raw, onDrop);
    if (extra) clean.extra = extra;

    return clean;
}

/** How to tell two entries in a list field apart. */
const identity = (value: unknown): string => {
    if (typeof value === 'string') return value.toLowerCase();
    const record = value as { source?: string; id?: string; url?: string };
    if (record.url) return record.url;
    if (record.source && record.id) return `${record.source}:${record.id}`;
    return JSON.stringify(value);
};

/**
 * Merges contributions that arrive in priority order, lowest `priority` first.
 *
 * Scalars go to the first plugin that had an opinion, which is what `priority`
 * means: MusicBrainz at 100 decides the artist's spelling and a supplementary
 * source at 500 does not get to overwrite it, but it does get to fill in the
 * BPM MusicBrainz has never heard of. Lists accumulate across every plugin,
 * deduplicated, because two sources naming different genres is more knowledge
 * rather than a conflict.
 *
 * `extra` is skipped rather than merged. Two plugins' unknown keys mean
 * whatever each plugin meant by them, and the merged view is what gets promoted
 * onto canonical rows and read as a single answer — so an unnamed field has no
 * business in it. The per-provider payloads keep every one of them.
 */
export function mergeEnrichment(parts: StoredEnrichment[]): Partial<TrackEnrichment> {
    const merged: Partial<TrackEnrichment> = {};
    const lists = new Map<string, { seen: Set<string>; values: unknown[] }>();

    for (const part of parts) {
        for (const [key, value] of Object.entries(part)) {
            if (value === undefined || key === 'extra') continue;

            if ((LIST_FIELDS as readonly string[]).includes(key)) {
                const list = lists.get(key) ?? { seen: new Set<string>(), values: [] };
                for (const entry of value as unknown[]) {
                    const marker = identity(entry);
                    if (list.seen.has(marker)) continue;
                    list.seen.add(marker);
                    list.values.push(entry);
                }
                lists.set(key, list);
                continue;
            }

            if (!(key in merged)) Object.assign(merged, { [key]: value });
        }
    }

    for (const [key, list] of lists) {
        if (list.values.length > 0) Object.assign(merged, { [key]: list.values.slice(0, MAX_LIST) });
    }

    return merged;
}
