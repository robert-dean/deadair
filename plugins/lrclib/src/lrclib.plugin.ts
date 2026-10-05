import { configString, Plugin, type LyricsPluginInstance, type PluginConnectionResult, type TrackLyrics, type TrackRef } from '@deadair/plugin-sdk';

import { LrclibClient, LrclibRequestError } from './lrclib.client.js';
import { isInstrumentalBody, parseLrc } from './lrclib.lrc.js';
import { DEFAULT_BASE_URL, DURATION_TOLERANCE_MS, TEST_RECORD } from './lrclib.manifest.js';
import type { LrclibRecord } from './lrclib.types.js';

export { lrclibManifest } from './lrclib.manifest.js';

/**
 * What one LRCLIB record says about a record, in the station's terms.
 *
 * Exported for the tests. `{}` when the record holds nothing usable, which is the same answer as
 * LRCLIB not having it at all.
 */
export function mapRecord(record: LrclibRecord): TrackLyrics {
    const providerRef = record.id === undefined ? undefined : String(record.id);
    const ref = providerRef === undefined ? {} : { providerRef };

    const plain = record.plainLyrics?.trim() || undefined;
    const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];

    // LRCLIB's own flag, or a body that is nothing but an instrumental marker. Both are an answer
    // the station acts on, so both are reported as one.
    const bodies = plain ? plain.split(/\r?\n/) : synced.map(line => line.text);
    if (record.instrumental === true || isInstrumentalBody(bodies)) return { instrumental: true, ...ref };

    const hasSynced = synced.some(line => line.text.length > 0);
    if (!plain && !hasSynced) return {};

    return { ...(plain ? { plain } : {}), ...(hasSynced ? { synced } : {}), ...ref };
}

/**
 * Lyrics from LRCLIB, matched strictly: artist, title, album and length, with no looser second try.
 *
 * Measured against this station's own catalog before it was written: 59 of 60 records matched on
 * the first and strictest question, 52 of them with line timings. A looser fallback was built and
 * never reached, so there is none here; a near miss is somebody else's words.
 */
export class LrclibPlugin extends Plugin implements LyricsPluginInstance {
    /** A community source rather than a licensed one, so mid-scale, and an operator can put another first. */
    readonly priority = 500;

    private client?: LrclibClient;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.client = new LrclibClient(this.host, configString(config.baseUrl) ?? DEFAULT_BASE_URL);
    }

    async testConnection(): Promise<PluginConnectionResult> {
        const client = this.client;
        if (!client) return { ok: false, message: 'Not loaded yet.' };

        try {
            const record = await client.get({ ...TEST_RECORD });
            // A 404 still proves the address is an LRCLIB that answers; a copy built from an old dump
            // may not hold the test record.
            if (record === undefined) return { ok: true, message: 'Connected. This copy of LRCLIB does not hold the test record, which is fine.' };
            if (typeof record.trackName !== 'string') return { ok: false, message: 'That address answered, but not like LRCLIB. Check the address.' };
            return { ok: true, message: 'Connected to LRCLIB.' };
        } catch (error) {
            if (error instanceof LrclibRequestError) return { ok: false, message: `LRCLIB answered HTTP ${error.status}.` };
            throw error;
        }
    }

    async lyricsFor(ref: TrackRef): Promise<TrackLyrics> {
        const client = this.client;
        if (!client) return {};

        // No length, no question. LRCLIB keys on it, and without it the match is names alone, which
        // is exactly the near miss this plugin refuses to make.
        if (ref.durationMs === undefined || !Number.isFinite(ref.durationMs) || ref.durationMs <= 0) return {};

        const record = await client.get({
            artist: ref.artist,
            title: ref.title,
            album: ref.album,
            durationSeconds: Math.round(ref.durationMs / 1000),
        });
        if (record === undefined) return {};

        // Held to the server's own tolerance, plus rounding, in case a copy of it is looser.
        if (typeof record.duration === 'number' && Math.abs(record.duration * 1000 - ref.durationMs) > DURATION_TOLERANCE_MS) return {};

        return mapRecord(record);
    }
}
