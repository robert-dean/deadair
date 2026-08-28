import { z } from 'zod';
import { configFieldSchema, type ConfigField } from './plugin.config.fields.js';
import { pluginPermissionsSchema, type PluginPermissions } from './plugin.permissions.js';

/**
 * What a plugin can do, and the only thing the host ever dispatches on.
 *
 * There is no second axis. A manifest used to also carry a `kind`
 * (`music-provider`, `enrichment`, `tts`) which nothing checked: every call
 * site asked the capability list, because a plugin that declares a kind and
 * forgets the method is a `TypeError` mid-request. So the label went and this
 * is what is left.
 */
export const PLUGIN_CAPABILITY_CATALOG = 'catalog';

/**
 * The plugin can get the station audio to play (`resolveStreamUrl`). Separate
 * from {@link PLUGIN_CAPABILITY_CATALOG} so a manifest can say it: "will fetch
 * audio from your server" is a thing an operator should read before installing,
 * and it used to be invisible.
 */
export const PLUGIN_CAPABILITY_STREAM = 'stream';

/**
 * The plugin owns its own audio output and deadair only tells it what to do.
 * The opposite of deadair's `playout` module, which is why it is not called
 * that.
 */
export const PLUGIN_CAPABILITY_STEER = 'steer';
export const PLUGIN_CAPABILITY_OAUTH = 'oauth';
export const PLUGIN_CAPABILITY_ENRICHMENT = 'enrichment';

/** The plugin can say something out loud: text in, audio out. */
export const PLUGIN_CAPABILITY_SPEECH = 'speech';

/**
 * The plugin can produce words: a conversation in, text out.
 *
 * A transport rather than a writer. What to say is the station's business, which
 * is why this capability knows nothing about breaks, shows or running orders.
 */
export const PLUGIN_CAPABILITY_LLM = 'llm';

/**
 * The plugin can measure a track's audio: bytes in, offsets out.
 *
 * Separate from {@link PLUGIN_CAPABILITY_ENRICHMENT} because the two answer
 * different kinds of question. Enrichment asks an upstream what it knows and
 * merges several answers; this computes one answer from the samples, and no
 * upstream sells it.
 */
export const PLUGIN_CAPABILITY_ANALYSIS = 'analysis';

/**
 * The plugin can make one piece of audio out of several: parts in, audio out.
 *
 * Separate from {@link PLUGIN_CAPABILITY_ANALYSIS}, and NOT because the work is
 * different: both need decoded PCM, and the bundled adapter serves both off one
 * sidecar. It is separate because **a capability is the unit of SELECTION**. The
 * host picks one plugin per capability, so a joiner carried as an optional method
 * on the analyzer is the analyzer the operator chose to MEASURE with — install
 * one that measures better and cannot join, name it, and joining stops with
 * nothing to do about it but choose a worse analyzer. Two keys is what lets a
 * station measure with one engine and mix with another.
 *
 * One plugin may of course declare both, and the bundled one does.
 */
export const PLUGIN_CAPABILITY_MIXER = 'mixer';

/**
 * The plugin can say what is popular: a chart id in, an ordered list of names
 * out.
 *
 * Separate from {@link PLUGIN_CAPABILITY_ENRICHMENT} because it is not a fact
 * about a record the station holds — it is an opinion about records in general,
 * most of which the library has never seen. And separate from
 * {@link PLUGIN_CAPABILITY_CATALOG} because a chart is not a source of audio:
 * naming a record is the whole of what it does.
 */
export const PLUGIN_CAPABILITY_CHARTS = 'charts';

/**
 * The plugin can say what happened outside the station: a feed in, published
 * entries out.
 *
 * Separate from {@link PLUGIN_CAPABILITY_CHARTS} even though both read somebody
 * else's document, because what comes back is not about records at all. A chart
 * entry is a name the pick path can turn into something that airs; a news item
 * is a fact, and the only thing that can be done with it is say it.
 */
export const PLUGIN_CAPABILITY_NEWS = 'news';

/**
 * The plugin can say who else sounds like this: an artist in, artists out.
 *
 * Separate from {@link PLUGIN_CAPABILITY_ENRICHMENT} for the reason
 * `capabilities/similarity.ts` gives at length: enrichment describes rows the
 * catalog holds, and the artists worth asking about here are the ones it does
 * not.
 */
export const PLUGIN_CAPABILITY_SIMILARITY = 'similarity';

/**
 * The plugin can ask the open web a question: words in, pages out.
 *
 * Separate from {@link PLUGIN_CAPABILITY_NEWS}, which is the other capability
 * that answers about the world, because the two are asked different things. News
 * serves a MENU an operator assembled and answers "what happened"; this is given
 * a subject the caller chose and answers "what does the web say about it", with
 * nothing stable to de-duplicate against because no two calls ask the same
 * question.
 *
 * And separate from {@link PLUGIN_CAPABILITY_CATALOG} for the reason
 * {@link PLUGIN_CAPABILITY_CHARTS} is: a result is a page, and a page cannot be
 * played. Looking for something to PLAY is `searchTracks` on the catalog.
 */
export const PLUGIN_CAPABILITY_SEARCH = 'search';

/**
 * The plugin can report what the station played to somebody else's service.
 *
 * The only capability that SENDS. Everything else here reads an upstream; this
 * publishes the operator's own listening to an account they hold, which is why
 * the SDK gives it a way to be declined per installation rather than assuming
 * that installing a plugin is consent to broadcast from it.
 */
export const PLUGIN_CAPABILITY_SCROBBLE = 'scrobble';

export const KNOWN_PLUGIN_CAPABILITIES = [
    PLUGIN_CAPABILITY_CATALOG,
    PLUGIN_CAPABILITY_STREAM,
    PLUGIN_CAPABILITY_STEER,
    PLUGIN_CAPABILITY_OAUTH,
    PLUGIN_CAPABILITY_ENRICHMENT,
    PLUGIN_CAPABILITY_SPEECH,
    PLUGIN_CAPABILITY_LLM,
    PLUGIN_CAPABILITY_ANALYSIS,
    PLUGIN_CAPABILITY_MIXER,
    PLUGIN_CAPABILITY_CHARTS,
    PLUGIN_CAPABILITY_NEWS,
    PLUGIN_CAPABILITY_SIMILARITY,
    PLUGIN_CAPABILITY_SEARCH,
    PLUGIN_CAPABILITY_SCROBBLE,
] as const;

export type KnownPluginCapability = (typeof KNOWN_PLUGIN_CAPABILITIES)[number];

/**
 * Known capabilities get autocomplete; the type stays open so a plugin built
 * against a newer host can declare one this SDK has never heard of without
 * failing manifest validation.
 */
export type PluginCapability = KnownPluginCapability | (string & Record<never, never>);

/**
 * A zod schema instance. Typed loosely so a plugin can hand over any schema
 * shape (object, union, refined object) without fighting the compiler.
 */
export type PluginConfigSchema = z.ZodType;

/**
 * Duck-typed "is this a zod schema?". Deliberately not a bare `instanceof`:
 * a plugin may resolve its own copy of zod, and `instanceof` fails across
 * module instances.
 */
export function isZodSchema(value: unknown): value is PluginConfigSchema {
    if (value instanceof z.ZodType) return true;
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { parse?: unknown; safeParse?: unknown };
    return typeof candidate.parse === 'function' && typeof candidate.safeParse === 'function';
}

/**
 * Everything the host needs to know about a plugin before it runs any of the
 * plugin's code: who it is, what it can do, what it needs permission for, and
 * what to ask the operator for.
 */
export interface PluginManifest {
    /** Reverse-DNS identifier, e.g. `deadair.spotify`. Globally unique, stable across versions. */
    id: string;

    /** Display name, e.g. `Spotify`. */
    name: string;

    /** Semver version of the plugin itself. */
    version: string;

    /** Which capability interfaces the factory result actually implements. */
    capabilities: PluginCapability[];

    /**
     * Semver RANGE of the plugin API this plugin works against, e.g. `^1.0.0`.
     * Compared against {@link PLUGIN_API_VERSION} at load time.
     */
    apiVersion: string;

    description?: string;

    homepage?: string;

    /** Data URI or absolute https URL of a small square icon. */
    icon?: string;

    permissions: PluginPermissions;

    /** Declarative settings form. */
    configFields: ConfigField[];

    /**
     * Server-side validation of the submitted config. The host parses the
     * operator's submission with this before storing it, so a plugin never
     * has to defend against malformed config at runtime.
     */
    configSchema: PluginConfigSchema;
}

/** Reverse-DNS: at least two lowercase dot-separated segments. */
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

/**
 * Validates everything in a manifest except the contents of `configSchema`,
 * which is only checked to be a zod schema instance.
 */
export const pluginManifestSchema = z.object({
    id: z.string().regex(PLUGIN_ID_PATTERN, 'plugin id must be reverse-DNS, e.g. "deadair.spotify"'),
    name: z.string().min(1),
    version: z.string().min(1),
    capabilities: z.array(z.string().min(1)),
    apiVersion: z.string().min(1),
    description: z.string().optional(),
    homepage: z.string().optional(),
    icon: z.string().optional(),
    permissions: pluginPermissionsSchema,
    configFields: z.array(configFieldSchema),
    configSchema: z.custom<PluginConfigSchema>(isZodSchema, { message: 'configSchema must be a zod schema' }),
});
