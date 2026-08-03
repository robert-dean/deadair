/**
 * The version of the deadair plugin API that this SDK implements.
 *
 * A plugin declares the range of API versions it is compatible with in its
 * manifest's `apiVersion` field (a semver range, e.g. `^1.0.0`). The host
 * refuses to load a plugin whose declared range does not satisfy this value.
 */
export const PLUGIN_API_VERSION = '1.0.0';
