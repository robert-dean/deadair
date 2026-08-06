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

/**
 * One plugin's answer, reduced to the fields this host understands, in the
 * types it promised them in.
 *
 * Everything else is dropped rather than corrected: a plugin that returns a
 * number for `artist` has a bug, and storing `"42"` would hide it while making
 * the catalog worse. Returning `{}` for a plugin that answered entirely in
 * nonsense is the honest outcome.
 */
export function sanitizeEnrichment(value: unknown): Partial<TrackEnrichment> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const clean: Partial<TrackEnrichment> = {};

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
 */
export function mergeEnrichment(parts: Partial<TrackEnrichment>[]): Partial<TrackEnrichment> {
    const merged: Partial<TrackEnrichment> = {};
    const lists = new Map<string, { seen: Set<string>; values: unknown[] }>();

    for (const part of parts) {
        for (const [key, value] of Object.entries(part)) {
            if (value === undefined) continue;

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
