import { z } from 'zod';
import { configFieldSchema, type ConfigField } from './plugin.config.fields.js';
import { pluginPermissionsSchema, type PluginPermissions } from './plugin.permissions.js';

/** Plugin kinds this version of the host knows how to wire up. */
export const PLUGIN_KIND_MUSIC_PROVIDER = 'music-provider';
export const PLUGIN_KIND_ENRICHMENT = 'enrichment';

export const KNOWN_PLUGIN_KINDS = [PLUGIN_KIND_MUSIC_PROVIDER, PLUGIN_KIND_ENRICHMENT] as const;

export type KnownPluginKind = (typeof KNOWN_PLUGIN_KINDS)[number];

/**
 * The kind of thing a plugin is. Known kinds get autocomplete; the type stays
 * open so a plugin built against a newer host can declare a kind this SDK has
 * never heard of without failing manifest validation.
 */
export type PluginKind = KnownPluginKind | (string & Record<never, never>);

/** Capability names understood by the built-in kinds. */
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

export const KNOWN_PLUGIN_CAPABILITIES = [
    PLUGIN_CAPABILITY_CATALOG,
    PLUGIN_CAPABILITY_STREAM,
    PLUGIN_CAPABILITY_STEER,
    PLUGIN_CAPABILITY_OAUTH,
    PLUGIN_CAPABILITY_ENRICHMENT,
] as const;

export type KnownPluginCapability = (typeof KNOWN_PLUGIN_CAPABILITIES)[number];

/** Same open-union treatment as {@link PluginKind}. */
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

    kind: PluginKind;

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
    kind: z.string().min(1),
    capabilities: z.array(z.string().min(1)),
    apiVersion: z.string().min(1),
    description: z.string().optional(),
    homepage: z.string().optional(),
    icon: z.string().optional(),
    permissions: pluginPermissionsSchema,
    configFields: z.array(configFieldSchema),
    configSchema: z.custom<PluginConfigSchema>(isZodSchema, { message: 'configSchema must be a zod schema' }),
});
