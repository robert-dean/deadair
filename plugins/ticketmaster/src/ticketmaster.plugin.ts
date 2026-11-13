import {
    configString,
    errorText,
    isPluginError,
    jsonBody,
    Plugin,
    PluginError,
    pluginCodeForStatus,
    retryAfterMs,
    upstreamDetail,
    type Concert,
    type ConcertQuery,
    type ConcertsPluginInstance,
    type FestivalListing,
    type FestivalQuery,
    type PluginConnectionResult,
    type PluginHost,
} from '@deadair/plugin-sdk';

import { concertsIn, festivalsIn } from './ticketmaster.events.js';
import {
    DEFAULT_CACHE_HOURS,
    DEFAULT_RADIUS_KM,
    FAILURE_HOLD_MS,
    MAX_CACHE_HOURS,
    MAX_FAILURE_HOLD_MS,
    MAX_RADIUS_KM,
    OPEN_METEO_GEOCODING_HOST,
    PAGE_SIZE,
    READ_BUDGET_MS,
    REQUEST_TIMEOUT_MS,
    TICKETMASTER_HOST,
} from './ticketmaster.manifest.js';

export { ticketmasterManifest } from './ticketmaster.manifest.js';

interface Point {
    latitude: number;
    longitude: number;
}

/**
 * When an artist is next playing near the station, out of Ticketmaster's listings.
 *
 * Thin, like `plugins/weather`: it fetches and filters, and what to SAY about a
 * show is decided in the API. It holds answers in memory, including the empty
 * ones that are most of what it is asked, because a station plays the same
 * artists all day. The host is captured before the first await, for the reason
 * `plugins/weather` gives.
 */
export class TicketmasterPlugin extends Plugin implements ConcertsPluginInstance {
    private apiKey = '';
    private cacheMs = DEFAULT_CACHE_HOURS * 3_600_000;
    private radiusKm = DEFAULT_RADIUS_KM;

    /** Where a place is. It does not move, so it is kept while the plugin is loaded. */
    private readonly places = new Map<string, Point>();

    /** What the service said about an artist in a place, and when. */
    private readonly answers = new Map<string, { at: number; concerts: Concert[] }>();

    /** Until when the service is not asked again, after failing. One hold, because the key is what failed. */
    private holdUntil = 0;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.apiKey = configString(await this.host.secrets.get('apiKey')) ?? '';
        this.cacheMs = clamp(positive(config.cacheHours) ?? DEFAULT_CACHE_HOURS, 1, MAX_CACHE_HOURS) * 3_600_000;
        this.radiusKm = clamp(positive(config.radiusKm) ?? DEFAULT_RADIUS_KM, 1, MAX_RADIUS_KM);

        this.register(() => {
            this.places.clear();
            this.answers.clear();
            this.holdUntil = 0;
        });

        this.host.logger.info('ticketmaster ready', { reuseHours: Math.round(this.cacheMs / 3_600_000), radiusKm: this.radiusKm });
    }

    protected async onUnload(): Promise<void> {
        this.apiKey = '';
    }

    /**
     * The shows near the place, soonest first.
     *
     * Answers from memory where it can. A failure throws to the caller that asked
     * and answers empty for a while after, because three failed invocations
     * quarantine a plugin and a dead service is one fault.
     */
    async getConcerts(query: ConcertQuery): Promise<Concert[]> {
        const host = this.host;
        const artist = query.artist.trim();
        const place = query.place.trim();
        if (artist.length === 0 || place.length === 0 || this.apiKey.length === 0) return [];

        const from = query.from ?? new Date().toISOString().slice(0, 10);
        const radiusKm = clamp(query.withinKm ?? this.radiusKm, 1, MAX_RADIUS_KM);
        const key = `${artist.toLowerCase()}|${place.toLowerCase()}|${radiusKm}`;

        const held = this.answers.get(key);
        if (held !== undefined && Date.now() - held.at <= this.cacheMs) return held.concerts.filter(concert => concert.startsOn >= from);

        if (Date.now() < this.holdUntil) return [];
        if (host.remainingMs() < READ_BUDGET_MS) return [];

        try {
            const point = await this.resolve(host, place);
            if (point === undefined) return [];

            const concerts = await this.search(host, artist, point, radiusKm, from);
            this.answers.set(key, { at: Date.now(), concerts });
            return concerts;
        } catch (error) {
            this.holdAfter(host, error);
            throw error;
        }
    }

    /**
     * Festivals by name, soonest first, for an operator about to add one. Never cached and never held
     * off after a failure: an operator asked, once, and a refusal is theirs to read.
     */
    async findFestivals(query: FestivalQuery): Promise<FestivalListing[]> {
        const host = this.host;
        const name = query.name.trim();
        if (name.length === 0 || this.apiKey.length === 0) return [];

        const from = query.from ?? new Date().toISOString().slice(0, 10);
        const body = await this.fetchEvents(
            host,
            new URLSearchParams({
                apikey: this.apiKey,
                keyword: name,
                classificationName: 'festival',
                startDateTime: `${from}T00:00:00Z`,
                sort: 'date,asc',
                size: String(PAGE_SIZE),
            }),
        );
        return festivalsIn(body);
    }

    /** Whether the key works: one real search, since a bad key fails nowhere else. */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        if (this.apiKey.length === 0) return { ok: false, message: 'There is no API key yet.' };

        try {
            await this.fetchEvents(host, new URLSearchParams({ apikey: this.apiKey, classificationName: 'music', size: '1' }));
            return { ok: true, message: 'Ticketmaster answered.' };
        } catch (error) {
            host.logger.debug('ticketmaster: the connection test failed', { error: errorText(error) });
            return { ok: false, message: errorText(error) };
        }
    }

    private async search(host: PluginHost, artist: string, point: Point, radiusKm: number, from: string): Promise<Concert[]> {
        const body = await this.fetchEvents(
            host,
            new URLSearchParams({
                apikey: this.apiKey,
                keyword: artist,
                classificationName: 'music',
                latlong: `${point.latitude},${point.longitude}`,
                radius: String(radiusKm),
                unit: 'km',
                startDateTime: `${from}T00:00:00Z`,
                sort: 'date,asc',
                size: String(PAGE_SIZE),
            }),
        );
        return concertsIn(body, artist);
    }

    private async fetchEvents(host: PluginHost, params: URLSearchParams): Promise<unknown> {
        const url = `https://${TICKETMASTER_HOST}/discovery/v2/events.json?${params.toString()}`;
        const response = await host.fetch(url, { timeoutMs: REQUEST_TIMEOUT_MS, headers: { Accept: 'application/json' } });

        if (!response.ok) {
            await response.body?.cancel();
            const error = new PluginError(`Ticketmaster answered ${upstreamDetail(response.status, response.statusText)}`).withCode(
                pluginCodeForStatus(response.status),
            );
            error.upstreamStatus = response.status;
            const advice = retryAfterMs(response.headers.get('retry-after'));
            if (advice !== undefined) error.withRetry(advice);
            throw error;
        }

        return await jsonBody<unknown>(response);
    }

    /** The place's coordinates. Only the part before the first comma is searched: the geocoder reads `Atlanta`, not `Atlanta, GA`. */
    private async resolve(host: PluginHost, place: string): Promise<Point | undefined> {
        const key = place.toLowerCase();
        const held = this.places.get(key);
        if (held !== undefined) return held;

        const name = encodeURIComponent(place.split(',')[0]!.trim());
        const response = await host.fetch(`https://${OPEN_METEO_GEOCODING_HOST}/v1/search?name=${name}&count=1`, { timeoutMs: REQUEST_TIMEOUT_MS });
        if (!response.ok) {
            await response.body?.cancel();
            throw new PluginError(`The geocoder answered ${upstreamDetail(response.status, response.statusText)}`).withCode(
                pluginCodeForStatus(response.status),
            );
        }

        const body = await jsonBody<{ results?: { latitude?: unknown; longitude?: unknown }[] }>(response);
        const first = body.results?.[0];
        if (typeof first?.latitude !== 'number' || typeof first.longitude !== 'number') return undefined;

        const point = { latitude: first.latitude, longitude: first.longitude };
        this.places.set(key, point);
        return point;
    }

    /** Leave the service alone for a while. Not when the CALLER ran out of time, which says nothing about the service. */
    private holdAfter(host: PluginHost, error: unknown): void {
        if (host.signal.aborted) return;
        const advice = isPluginError(error) && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : 0;
        this.holdUntil = Date.now() + Math.min(MAX_FAILURE_HOLD_MS, Math.max(FAILURE_HOLD_MS, advice));
    }
}

const positive = (value: unknown): number | undefined => {
    const number = typeof value === 'string' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
};

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
