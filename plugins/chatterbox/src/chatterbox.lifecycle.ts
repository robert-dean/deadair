/**
 * Getting a model into the GPU, and out of it again.
 *
 * The whole of what makes this plugin more than a second Kokoro, and every rule
 * here was paid for on a running station rather than reasoned out.
 *
 * ## The engine does not reload itself
 *
 * After `/api/unload`, synthesis answers 503 until something calls
 * `/restart_server` — which, despite the name, hot-swaps the engine to the model
 * named in the server's own config rather than killing the process. So whoever
 * unloads owes the load, and `ensureLoaded` runs before every synthesis rather
 * than once at startup: the previous render's unload may have emptied the server
 * since, and nothing else is going to notice.
 *
 * ## The endpoints are at the server ROOT
 *
 * Synthesis lives under `/v1` and model management does not, so {@link serverRoot}
 * strips a trailing `/vN` off the configured address. That is the only piece of
 * URL derivation in this plugin, and it is here rather than inlined so there is
 * one place to look when a build moves them.
 *
 * ## A failed load strands its own memory
 *
 * A load that dies on CUDA OOM leaves partial allocations behind — 3.5 GiB
 * observed on a 16 GiB card — so an immediate retry OOMs against your own leak.
 * The self-heal is unload-then-load-once, which is the common case of a GPU that
 * was briefly full and has since freed up.
 *
 * ## Unloading never throws and loading always does
 *
 * They are opposite obligations. Freeing memory is an optimization and must not
 * fail a render that already succeeded, nor mask the original error on the retry
 * path. A render cannot proceed without a model, so the load says so.
 *
 * ## Which model is loaded decides what a reading can ask for
 *
 * The server holds one of three builds and they are not three sizes of one thing.
 * `turbo` performs the paralinguistic tags the station calls cues and IGNORES the
 * expressiveness dials: upstream's `ChatterboxTurboTTS.generate` logs "CFG, min_p and
 * exaggeration are not supported by the Turbo version and will be ignored" and
 * drops them. `original` and `multilingual` are the other way round, honouring the
 * dials and performing no tags. So on this engine a station gets cues or dials and
 * never both, and which one is a fact about the model that is resident right now.
 * That is why {@link ensureLoaded} hands back the readout that proved residency
 * rather than making the caller ask the server a second time.
 */

import { PluginError, type HostFetchInit, type PluginLogger } from '@deadair/plugin-sdk';

/** How long each lifecycle call gets. Short: they answer or they do not. */
export const LIFECYCLE_TIMEOUT_MS = 10_000;

/**
 * How long to wait for a load to report resident, and how often to ask.
 *
 * Sixty seconds, which is deliberately half of what the previous station allowed
 * for the same wait. The whole invocation here is bounded at two minutes by
 * `SPEAK_TIMEOUT_MS` and the synthesis still has to happen inside it, so a load
 * permitted to eat the entire budget would turn a cold start into a break that
 * fails rather than one that is merely slow. A load that outlives this fails as
 * `unavailable`, which is the code that keeps the segment's words on the row.
 */
export const LOAD_TIMEOUT_MS = 60_000;
export const LOAD_POLL_MS = 2_000;

/**
 * What the server says about the model it is holding.
 *
 * There is no model to CHOOSE on this engine — one is resident at a time and the
 * server's own config names it — so this is a readout rather than a menu, and
 * everything past `loaded` is decoration on a sentence for an operator. All of it
 * optional, because a build that reports less should cost the message a clause
 * rather than the answer.
 */
export interface ModelInfo {
    loaded: boolean;
    /**
     * The build, as the server names it: `original`, `turbo` or `multilingual`.
     *
     * The one field here that changes what a request may carry rather than what a sentence says.
     * See {@link honoursExpressionDials}.
     */
    type?: string;
    /** The implementing class, which is the more specific of the two names. */
    className?: string;
    /** `cuda`, `cpu`. Worth saying, because a model that quietly landed on the CPU is a slow break. */
    device?: string;
    /**
     * Whether this build performs paralinguistic tags at all.
     *
     * A property of the LOADED model rather than of the server: the turbo build does them and the
     * others do not, so swapping the model takes them away with nothing else changing. That is why
     * nothing caches this into a manifest flag. The expressiveness dials are the mirror image of this
     * and belong to the other two builds; see {@link honoursExpressionDials}.
     */
    supportsCues: boolean;
    /**
     * The tags it names, verbatim and lowercased, as the ENGINE spells them.
     *
     * Its own vocabulary rather than the station's, and wider: it holds `cough`, `sniff` and
     * `clear throat` too. Narrowing to what a station will actually ask for happens where the two
     * meet, in `listCues`.
     */
    availableTags: readonly string[];
}

/**
 * The server's own configured values for the two expressiveness dials, as far as it reports them.
 *
 * An omitted field takes these, so they are what a voice with a blank cell actually sounds like at rest.
 */
export interface GenerationDefaults {
    exaggeration?: number;
    cfgWeight?: number;
}

/** What this plugin needs from the host to talk to the server. Narrow, so it can be faked whole. */
export interface LifecycleDeps {
    /** The configured address, `/v1` and all. */
    baseUrl: string;
    fetch: (url: string, init: HostFetchInit) => Promise<Response>;
    headers: () => Record<string, string>;
    logger: PluginLogger;
    /** Injected so a test does not wait in real time. */
    sleep?: (ms: number) => Promise<void>;
    /** Injected for the same reason: the poll needs a clock it does not own. */
    now?: () => number;
}

/**
 * The server's root, given the OpenAI-compatible base URL.
 *
 * Only a trailing version segment comes off, so an address that already IS the
 * root is left alone and one served under a path prefix keeps it.
 */
export function serverRoot(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
}

/**
 * The builds that honour `exaggeration` and `cfg_weight`, as `/api/model-info` names them.
 *
 * An ALLOWLIST rather than "anything but turbo", because the two failures are not the same size.
 * Withholding the dials from a build that would have honoured them costs the station a reading it
 * asked for, which the operator can hear and Test connection explains. Sending them to a build that
 * does not is either ignored (turbo) or, on a build nobody here has met, a change to the rendering
 * nobody predicted. The names are the server's own: `engine.py` maps every repo id it knows onto
 * exactly these three.
 */
const DIAL_BUILDS: ReadonlySet<string> = new Set(['original', 'multilingual']);

/**
 * Whether the loaded model reads `exaggeration` and `cfg_weight` rather than discarding them.
 *
 * A readout with no `type` answers no, which is today's behaviour exactly: nothing sent, and the
 * server's own configured defaults apply.
 */
export function honoursExpressionDials(info: ModelInfo | undefined): boolean {
    return info?.type !== undefined && DIAL_BUILDS.has(info.type.toLowerCase());
}

/** Model lifecycle for one configured server. */
export class ModelLifecycle {
    private readonly root: string;
    private defaults?: GenerationDefaults;

    constructor(private readonly deps: LifecycleDeps) {
        this.root = serverRoot(deps.baseUrl);
    }

    /**
     * Whether the server currently holds a model.
     *
     * Unreachable counts as NO, which is the safe direction in both places this
     * is read: before a synthesis it means try to load, and inside the load poll
     * it means keep waiting. Answering yes to a server that is not answering
     * would send a synthesis at nothing.
     */
    async loaded(): Promise<boolean> {
        return (await this.resident()) !== undefined;
    }

    /** The readout, when it says a model is resident, and nothing otherwise. {@link loaded} with the evidence kept. */
    private async resident(): Promise<ModelInfo | undefined> {
        const info = await this.info();
        return info?.loaded === true ? info : undefined;
    }

    /**
     * Everything the server will say about its model, or nothing if it would not say.
     *
     * `undefined` is "could not read" and is deliberately not a `ModelInfo` with
     * `loaded: false`: {@link loaded} folds the two together because for its two
     * callers they mean the same next step, and the console's connection message
     * must NOT — "no model is loaded" about a server that never answered is a
     * confident wrong sentence about the one thing an operator came here to check.
     */
    async info(): Promise<ModelInfo | undefined> {
        try {
            const response = await this.deps.fetch(`${this.root}/api/model-info`, {
                headers: this.deps.headers(),
                timeoutMs: LIFECYCLE_TIMEOUT_MS,
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                return undefined;
            }

            const body = (await response.json()) as Record<string, unknown>;
            return {
                loaded: body.loaded === true,
                type: said(body.type),
                className: said(body.class_name),
                device: said(body.device),
                // Both halves are read, and the pair is not redundant: the flag is the server's own
                // answer to "can this build do them at all" and the list is which. A build that says
                // yes and names nothing performs nothing, so the caller intersects rather than
                // trusting either alone.
                supportsCues: body.supports_paralinguistic_tags === true,
                availableTags: namedTags(body.available_paralinguistic_tags),
            };
        } catch {
            return undefined;
        }
    }

    /**
     * What the server does with a dial nobody sent, read once and then remembered.
     *
     * `/api/ui/initial-data` is the only place the server says, under `config.generation_defaults`,
     * and it is the operator's own config file rather than anything the model decides. So it is read
     * the first time a delivery needs it and kept for the life of this plugin instance: a change to the
     * server's config reaches the station when the plugin is reloaded, which a save of its settings
     * already does. A failed read is not remembered, so the next delivery asks again, and it answers
     * nothing rather than throwing, since the caller has a neutral fallback and a break must not fail
     * for want of a default.
     */
    async generationDefaults(): Promise<GenerationDefaults | undefined> {
        if (this.defaults !== undefined) return this.defaults;

        try {
            const response = await this.deps.fetch(`${this.root}/api/ui/initial-data`, {
                headers: this.deps.headers(),
                timeoutMs: LIFECYCLE_TIMEOUT_MS,
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                return undefined;
            }

            const body = (await response.json()) as { config?: { generation_defaults?: Record<string, unknown> } };
            const read = body.config?.generation_defaults;
            const exaggeration = finite(read?.exaggeration);
            const cfgWeight = finite(read?.cfg_weight);
            if (exaggeration === undefined && cfgWeight === undefined) return undefined;

            this.defaults = { ...(exaggeration === undefined ? {} : { exaggeration }), ...(cfgWeight === undefined ? {} : { cfgWeight }) };
            return this.defaults;
        } catch {
            return undefined;
        }
    }

    /**
     * Make sure there is a model to speak with, loading one if not.
     *
     * The self-heal is the whole of the interesting part: a first load that fails
     * has usually stranded memory of its own, so the retry unloads before trying
     * again rather than throwing itself at a GPU it just filled.
     *
     * Answers with the readout that proved a model is resident, whichever
     * question it was (the check before anything, or the last poll of a load),
     * because the synthesis that follows needs to know WHICH model it is talking
     * to and the server has just said. Asking again would be a second request
     * before every break for an answer already in hand.

     *
     * @throws {PluginError} `unavailable`, deliberately, and not `upstream`: the
     *   engine is fine and the station simply has nothing to speak with yet,
     *   which is the code that leaves a segment's words on the row for the next
     *   pass instead of writing the break off.
     */
    async ensureLoaded(): Promise<ModelInfo> {
        const already = await this.resident();
        if (already !== undefined) return already;

        try {
            return await this.load();
        } catch (error) {
            this.deps.logger.warn('model load failed; clearing stranded memory and trying once more', { error: messageOf(error) });
        }

        await this.unload();
        return await this.load();
    }

    /**
     * Ask for a model and wait until the server says it has one.
     *
     * Polled rather than trusted, because the load is synchronous on current
     * builds and an asynchronous one would otherwise be reported as ready the
     * moment the request was accepted. Answers with the poll that said yes.
     */
    async load(): Promise<ModelInfo> {
        const url = `${this.root}/restart_server`;
        const response = await this.deps
            .fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...this.deps.headers() },
                body: '{}',
                timeoutMs: LIFECYCLE_TIMEOUT_MS,
            })
            .catch((error: unknown) => {
                throw unavailable(`could not ask ${url} for a model: ${messageOf(error)}`);
            });

        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw unavailable(`the server refused to load a model (HTTP ${response.status})`);
        }

        const now = this.deps.now ?? (() => Date.now());
        const sleep = this.deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
        const giveUpAt = now() + LOAD_TIMEOUT_MS;

        // Asked once before any waiting, so a synchronous load costs no delay at all.
        while (now() < giveUpAt) {
            const info = await this.resident();
            if (info !== undefined) return info;
            await sleep(LOAD_POLL_MS);
        }

        throw unavailable(`the server still reports no model ${LOAD_TIMEOUT_MS / 1000}s after being asked for one`);
    }

    /**
     * Drop the model, freeing what it holds.
     *
     * Never throws. It is called on the way out of a render that already
     * succeeded, on the retry path where an exception would mask the load error
     * that mattered, and from the plugin's disposer, where throwing would cost
     * every teardown after it.
     */
    async unload(): Promise<void> {
        const url = `${this.root}/api/unload`;
        try {
            const response = await this.deps.fetch(url, { method: 'POST', headers: this.deps.headers(), timeoutMs: LIFECYCLE_TIMEOUT_MS });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                this.deps.logger.warn('the server would not unload its model, so it is still holding memory', { status: response.status });
                return;
            }

            await response.body?.cancel().catch(() => {});
            this.deps.logger.debug('asked the server to drop its model');
        } catch (error) {
            this.deps.logger.warn('could not ask the server to unload its model', { error: messageOf(error) });
        }
    }
}

/** A number off a server readout, if it is one. */
const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** A field of the model readout, if the server filled it in. Blank counts as absent. */

const said = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/**
 * The tag list off the readout, as lowercased names, and empty for anything else.
 *
 * Lowercased here rather than at the comparison because this is the boundary: a server that starts
 * answering `Laugh` should cost nothing downstream, and a case fold applied at every read is one
 * that eventually gets forgotten at one of them.
 */
const namedTags = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' && entry.trim().length > 0 ? [entry.trim().toLowerCase()] : [])) : [];

const unavailable = (message: string): PluginError => new PluginError(`chatterbox: ${message}`).withCode('unavailable');

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
