import {
    ANALYSIS_SCHEMA_VERSION,
    configBaseUrl,
    Plugin,
    PluginError,
    tryJsonBody,
    type AnalysisProvider,
    type AnalysisRef,
    type PluginConnectionResult,
    type TrackAnalysis,
} from '@deadair/plugin-sdk';
import { ANALYZE_TIMEOUT_MS, PROBE_TIMEOUT_MS, analyzerManifest } from './analyzer.manifest.js';

export { analyzerManifest };

/** What the sidecar answers with. Mirrors `analysis/README.md`, which is the contract. */
interface AnalyzeResponse {
    schemaVersion?: number;
    analyzer?: string;
    complete?: boolean;
    durationMs?: number;
    data?: Record<string, unknown>;
}

interface ErrorResponse {
    error?: { code?: string; message?: string };
}

/**
 * The sidecar's own failure codes, as host error codes.
 *
 * All three are `upstream` rather than being told apart, and that is not
 * laziness: the host's codes describe whose fault a call was, and by that
 * measure a URL that would not serve and a file that would not decode are the
 * same answer — the plugin worked, the thing beyond it did not. The distinction
 * that matters is preserved where it is acted on, in the message the station
 * records against the track.
 */
const UPSTREAM_CODES = new Set(['unfetchable', 'undecodable', 'truncated']);

/**
 * Per-track audio measurement, through the bundled analysis sidecar.
 *
 * ## This plugin does not measure anything
 *
 * It is an adapter, in the same relationship to its container that the speech
 * plugin has to its engine. Measuring needs decoded PCM, and decoding is the one
 * thing that does not happen in Node — so the work is a separate program and
 * this is the two-endpoint conversation with it.
 *
 * That indirection is what makes the analyzer swappable. `analysis/README.md` is
 * the contract rather than a description of the bundled image: anything
 * answering `/health` and `/analyze` is a valid analyzer, and moving to one is a
 * `baseUrl` change here.
 *
 * ## What it deliberately does not interpret
 *
 * `data` is passed through untouched. The host stores it as an opaque blob under
 * the version the analyzer reported, which is what lets a later schema add a
 * tempo, a downbeat grid or a vocal curve without this file changing at all. A
 * plugin that unpacked the cue points to "validate" them would have to be
 * edited for every one of those, and would reject a payload newer than itself.
 */
export class AnalyzerPlugin extends Plugin implements AnalysisProvider {
    private baseUrl = '';

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = configBaseUrl(config.baseUrl);

        this.host.logger.info('analyzer ready', { baseUrl: this.baseUrl });
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (this.baseUrl.length === 0) return { ok: false, message: 'No analyzer URL set.' };

        const response = await this.host.fetch(`${this.baseUrl}/health`, { timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) return { ok: false, message: `Analyzer answered HTTP ${response.status}.` };

        const body = await tryJsonBody<AnalyzeResponse>(response);
        const version = body?.schemaVersion;
        const analyzer = typeof body?.analyzer === 'string' ? body.analyzer : 'an analyzer';

        // A version mismatch is reported here rather than at analysis time,
        // because this is the one moment an operator is looking at the answer. A
        // newer analyzer is not refused — the host stores what it is told and its
        // own staleness rule decides what to do — but silently writing rows
        // nothing can read is the outcome worth naming out loud.
        if (typeof version === 'number' && version !== ANALYSIS_SCHEMA_VERSION) {
            return {
                ok: true,
                message: `Connected to ${analyzer}, which measures schema v${version} where this station reads v${ANALYSIS_SCHEMA_VERSION}. Measurements may be stored and then ignored.`,
            };
        }

        return { ok: true, message: `Connected to ${analyzer}.` };
    }

    async analyzeTrack(ref: AnalysisRef): Promise<TrackAnalysis> {
        if (this.baseUrl.length === 0) {
            throw new PluginError('the analyzer has no URL configured').withCode('config');
        }

        const response = await this.host.fetch(`${this.baseUrl}/analyze`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: ref.audioUrl, durationMs: ref.durationMs }),
            // Minutes. A decode is a job rather than a request, and the host's own
            // default would abandon every track at fifteen seconds.
            timeoutMs: ANALYZE_TIMEOUT_MS,
        });

        if (!response.ok) {
            throw await this.upstreamFailure(response, ref);
        }

        const body = await tryJsonBody<AnalyzeResponse>(response);
        return this.toAnalysis(body, ref);
    }

    /**
     * A non-2xx from the analyzer, as the error the station will record.
     *
     * The sidecar's own code is preferred over the HTTP status because it says
     * something the status cannot: 502 covers both "that URL served nothing" and
     * "that URL served a web page", and the operator fixing it needs to know
     * which.
     */
    private async upstreamFailure(response: Response, ref: AnalysisRef): Promise<PluginError> {
        const body = await tryJsonBody<ErrorResponse>(response);
        const code = body?.error?.code;
        const detail = body?.error?.message;

        const described = code !== undefined && detail !== undefined ? `${code}: ${detail}` : (detail ?? `HTTP ${response.status}`);

        return new PluginError(`the analyzer could not measure track ${ref.trackId} (${described})`)
            .withCode(code !== undefined && UPSTREAM_CODES.has(code) ? 'upstream' : 'internal')
            .withUpstreamStatus(response.status);
    }

    /**
     * A 200 body, as a `TrackAnalysis`.
     *
     * Validated rather than trusted, because the two fields that are not
     * measurements are the ones a wrong answer is most costly on, and both have a
     * plausible-looking wrong value:
     *
     * - a missing `schemaVersion` would default to something, and whatever it
     *   defaulted to would make a payload of unknown shape read as a known one;
     * - a missing `complete` defaulting to `true` would assert that a truncated
     *   download was whole, which is the exact claim the flag exists to prevent
     *   anyone making. There is no safe default, so its absence is a fault.
     */
    private toAnalysis(body: AnalyzeResponse | undefined, ref: AnalysisRef): TrackAnalysis {
        if (body === undefined) {
            throw new PluginError(`the analyzer answered with something that was not JSON for track ${ref.trackId}`).withCode('upstream');
        }
        if (typeof body.schemaVersion !== 'number' || typeof body.complete !== 'boolean' || body.data === null || typeof body.data !== 'object') {
            throw new PluginError(
                `the analyzer's answer for track ${ref.trackId} is missing schemaVersion, complete or data; it may not be an analyzer`,
            ).withCode('upstream');
        }

        this.host.logger.debug('measured a track', {
            track: ref.trackId,
            schemaVersion: body.schemaVersion,
            complete: body.complete,
        });

        return {
            schemaVersion: body.schemaVersion,
            complete: body.complete,
            // Passed through unread. See the class comment.
            data: body.data as TrackAnalysis['data'],
            ...(typeof body.durationMs === 'number' ? { durationMs: body.durationMs } : {}),
            ...(typeof body.analyzer === 'string' ? { analyzer: body.analyzer } : {}),
        };
    }
}
