import {
    ANALYSIS_SCHEMA_VERSION,
    configBaseUrl,
    Plugin,
    PluginError,
    tryJsonBody,
    type AnalysisProvider,
    type AnalysisRef,
    type AudioJoin,
    type JoinedAudio,
    type MixerProvider,
    type PluginConnectionResult,
    type TrackAnalysis,
} from '@deadair/plugin-sdk';
import { ANALYZE_TIMEOUT_MS, JOIN_TIMEOUT_MS, PROBE_TIMEOUT_MS, analyzerManifest } from './analyzer.manifest.js';

export { analyzerManifest };

/** What the sidecar answers with. Mirrors `analysis/README.md`, which is the contract. */
interface AnalyzeResponse {
    schemaVersion?: number;
    analyzer?: string;
    /** `/health` only: the most this analyzer will decode at once. See {@link AnalyzerPlugin.testConnection}. */
    maxConcurrent?: number;
    /** `/health` only: what that machine is holding right now, where it will say. Absent off Linux. */
    rssMb?: number;
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
 * Per-track audio measurement — and joining — through the bundled analysis
 * sidecar.
 *
 * ## This plugin does not measure anything
 *
 * It is an adapter, in the same relationship to its container that the speech
 * plugin has to its engine. Measuring needs decoded PCM, and decoding is the one
 * thing that does not happen in Node — so the work is a separate program and
 * this is the conversation with it.
 *
 * ## Why one plugin declares two capabilities
 *
 * Joining is the same requirement seen from the other end: a station wanting a
 * phone-in's turns as one file needs them decoded, and this is already the plugin
 * that talks to the thing that decodes. So it is one plugin, one `baseUrl`, one
 * sidecar — splitting it would be two config rows for one process, free to drift
 * apart with nothing saying which one a failure came from.
 *
 * They are two CAPABILITIES all the same, because the host picks one plugin per
 * capability: carried on `analysis` alone, the joiner would be whichever plugin
 * the operator chose to MEASURE with. Declaring both is ordinary here rather than
 * a compromise — the bundled music providers declare three and four.
 *
 * That indirection is what makes the analyzer swappable. `analysis/README.md` is
 * the contract rather than a description of the bundled image: anything answering
 * `/health` and `/analyze` is a valid analyzer, `/join` is what earns the second
 * capability, and moving to another sidecar is a `baseUrl` change here.
 *
 * ## What it deliberately does not interpret
 *
 * `data` is passed through untouched. The host stores it as an opaque blob under
 * the version the analyzer reported, which is what lets a later schema add a
 * tempo, a downbeat grid or a vocal curve without this file changing at all. A
 * plugin that unpacked the cue points to "validate" them would have to be
 * edited for every one of those, and would reject a payload newer than itself.
 */
export class AnalyzerPlugin extends Plugin implements AnalysisProvider, MixerProvider {
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

        // What the analyzer will allow at once, so that asking the station for more
        // than this is visible HERE rather than as a walk that got no faster with
        // nothing anywhere saying why. Reported and never enforced: the ceiling
        // belongs to that machine, and an analyzer that does not answer with one is
        // a valid analyzer — README.md is the contract and this field is new to it.
        const ceiling =
            typeof body?.maxConcurrent === 'number' && body.maxConcurrent > 0 ? ` It will measure up to ${body.maxConcurrent} at once.` : '';

        // What that machine is currently holding, which is the one figure here that
        // moves between two calls. Optional exactly as the ceiling is, and for a
        // second reason on top of its own: the analyzer omits it off Linux rather
        // than reporting a number that means something different per platform.
        //
        // Worth putting in front of an operator at all because the failure it
        // belongs to is invisible from the station's side — a decode-heavy process
        // grows resident memory the allocator never gives back, and the symptom is
        // a container that is killed hours later with nothing to attribute it to.
        const resident = typeof body?.rssMb === 'number' && body.rssMb > 0 ? ` Using ${body.rssMb} MB.` : '';

        // A version mismatch is reported here rather than at analysis time,
        // because this is the one moment an operator is looking at the answer. A
        // newer analyzer is not refused — the host stores what it is told and its
        // own staleness rule decides what to do — but silently writing rows
        // nothing can read is the outcome worth naming out loud.
        if (typeof version === 'number' && version !== ANALYSIS_SCHEMA_VERSION) {
            return {
                ok: true,
                message: `Connected to ${analyzer}, which measures schema v${version} where this station reads v${ANALYSIS_SCHEMA_VERSION}. Measurements may be stored and then ignored.${ceiling}${resident}`,
            };
        }

        return { ok: true, message: `Connected to ${analyzer}.${ceiling}${resident}` };
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

    async join(request: AudioJoin): Promise<JoinedAudio> {
        if (this.baseUrl.length === 0) {
            throw new PluginError('the analyzer has no URL configured').withCode('config');
        }

        const response = await this.host.fetch(`${this.baseUrl}/join`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                parts: request.parts.map(part => ({ url: part.url })),
                gapMs: request.gapMs,
                trim: request.trim ?? true,
                // Sent only when there are any, so a station that asks for an ordinary join puts
                // exactly the same body on the wire it did before overlays existed — and an older
                // sidecar, whose model would reject an unknown field, keeps working.
                ...(request.overlays === undefined || request.overlays.length === 0
                    ? {}
                    : {
                          overlays: request.overlays.map(overlay => ({
                              url: overlay.url,
                              afterIndex: overlay.afterIndex,
                              offsetMs: overlay.offsetMs ?? 0,
                              gainDb: overlay.gainDb ?? 0,
                              duckDb: overlay.duckDb ?? 0,
                          })),
                      }),
            }),
            timeoutMs: JOIN_TIMEOUT_MS,
        });

        // An analyzer that predates `/join`, or one that never had it. Its own
        // code, because a station reading `unsupported` has somewhere to go — the
        // production airs as a block of beats — where `upstream` reads as a fault
        // to fix.
        if (response.status === 404 || response.status === 405) {
            throw new PluginError('this analyzer cannot join audio').withCode('unsupported').withUpstreamStatus(response.status);
        }

        if (!response.ok) {
            throw await this.joinFailure(response);
        }

        const body = response.body;
        if (body === null) {
            throw new PluginError('the analyzer answered the join with no audio').withCode('upstream');
        }

        const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
        if (mime === undefined || mime.length === 0) {
            // Cancelled rather than left open: nothing is going to read a body
            // whose bytes the host cannot name.
            await body.cancel();
            throw new PluginError('the analyzer answered the join without saying what the audio is').withCode('upstream');
        }

        const declared = Number(response.headers.get('x-duration-ms'));

        this.host.logger.debug('joined audio', { parts: request.parts.length, gapMs: request.gapMs, mime });

        return {
            mime,
            audio: body,
            ...(Number.isFinite(declared) && declared > 0 ? { durationMs: Math.round(declared) } : {}),
        };
    }

    /**
     * A non-2xx from a join, as the error the station will log.
     *
     * The same shape as {@link upstreamFailure} without a track to name, and
     * separate rather than parameterised because the two failures are read in
     * different places: one is recorded against a record and re-read by the walk,
     * and this one costs a production its seam and nothing else.
     */
    private async joinFailure(response: Response): Promise<PluginError> {
        const body = await tryJsonBody<ErrorResponse>(response);
        const code = body?.error?.code;
        const detail = body?.error?.message;
        const described = code !== undefined && detail !== undefined ? `${code}: ${detail}` : (detail ?? `HTTP ${response.status}`);

        return new PluginError(`the analyzer could not join the audio (${described})`)
            .withCode(code !== undefined && UPSTREAM_CODES.has(code) ? 'upstream' : 'internal')
            .withUpstreamStatus(response.status);
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
