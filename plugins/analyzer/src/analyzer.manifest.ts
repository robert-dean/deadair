import { PLUGIN_CAPABILITY_ANALYSIS, PLUGIN_CAPABILITY_MIXER, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.analyzer';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Where the bundled analysis sidecar answers.
 *
 * A placeholder in the form only, as it is for every service address here: the
 * same plugin has to reach `http://analysis:9321` from inside compose and
 * `http://localhost:9321` from a host `pnpm dev`, and an operator with a spare
 * machine will point it at neither.
 */
export const DEFAULT_BASE_URL = 'http://localhost:9321';

/**
 * How long one measurement may take.
 *
 * Minutes rather than seconds, and that is the whole reason this constant is
 * written down. A full decode of a five-minute record is a job, not a request,
 * and the host's own default for a call into plugin code is fifteen seconds —
 * so an analysis left on the default fails on every track at exactly the same
 * moment, which looks like a broken analyzer and is not.
 *
 * The host caps this at whatever the current invocation has left, so the job on
 * the other side has to allow at least as long or this number is decoration.
 */
export const ANALYZE_TIMEOUT_MS = 5 * 60_000;

/**
 * How long a join may take.
 *
 * On {@link ANALYZE_TIMEOUT_MS}'s argument, and for the same reason: joining a
 * production decodes every one of its beats, so it is several of those decodes
 * end to end rather than a request. Shorter than the analysis all the same,
 * because the parts are short — a turn is seconds where a record is minutes —
 * and because nothing downstream is lost when it gives up: the production airs
 * as a block of beats, which is what it did before this existed.
 */
export const JOIN_TIMEOUT_MS = 3 * 60_000;

/** A short call: it exists to answer "is anything there?", not to do work. */
export const PROBE_TIMEOUT_MS = 5_000;

export const configSchema = z.object({
    baseUrl: z.string().min(1),
});

export const analyzerManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Audio analyzer',
    version: PLUGIN_VERSION,
    // Two capabilities and one address, because the host picks one plugin per capability and both of
    // these are the same sidecar. See the plugin's own note: on `analysis` alone, the joiner would be
    // whichever plugin the operator chose to measure with.
    capabilities: [PLUGIN_CAPABILITY_ANALYSIS, PLUGIN_CAPABILITY_MIXER],
    apiVersion: '^1.0.0',
    description:
        'Measures where a record starts, is underway, begins ending and stops, so the station can trim dead air and time what it says, and joins several pieces of audio into one so a programme written turn by turn airs as a single item. Talks to the bundled analysis container.',
    permissions: {
        // The operator names the address, so there is no hostname to write down.
        // An unset or unparseable `baseUrl` contributes no entry at all, which
        // refuses the call exactly as an undeclared host would.
        network: [{ fromConfig: 'baseUrl' }],
        // Nothing is kept between calls. The measurement's home is the station's
        // own table, which already has a staleness rule; a copy here would be a
        // second one that can disagree with it.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'baseUrl',
            label: 'Analyzer URL',
            type: 'url',
            required: true,
            default: DEFAULT_BASE_URL,
            help: 'The bundled analysis container answers on http://analysis:9321, or http://localhost:9321 when the API runs on the host. Point it anywhere that serves the same two endpoints.',
        },
    ],
    configSchema,
};
