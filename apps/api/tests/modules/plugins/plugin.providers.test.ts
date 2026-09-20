// The table pairing a capability with the setting that decides it. What is pinned here is the thing
// prose cannot pin: that each entry names the key its own service reads, and that the key is really
// declared, in the shape the entry's mode implies. A table that drifts from either is a console
// confidently naming a plugin the station does not reach.

import { describe, expect, it } from 'vitest';

import { ANALYSIS_PLUGIN_KEY } from '../../../src/modules/analysis/analysis.settings.js';
import { LLM_PLUGIN_KEY } from '../../../src/modules/llm/llm.settings.js';
import { MIXER_PLUGIN_KEY } from '../../../src/modules/render/mixer.settings.js';
import { SPEECH_PLUGIN_KEY } from '../../../src/modules/render/speech.settings.js';
import { SIMILARITY_ORDER_KEY } from '../../../src/modules/similarity/similarity.settings.js';
import { ORDER_SOURCE_COLUMN } from '../../../src/modules/plugins/plugin.order.js';
import { PROVIDER_CAPABILITIES, pluginInUse, pluginsInOrder, providerCapabilities } from '../../../src/modules/plugins/plugin.providers.js';
import { findDescriptor } from '../../../src/modules/settings/settings.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('the provider table', () => {
    it('names the key each capability’s own service reads', () => {
        // The pairing is the whole point of the table, so a rename that misses one of these is the
        // failure it exists to prevent rather than a tidy-up.
        expect(PROVIDER_CAPABILITIES.speech.settingKey).toBe(SPEECH_PLUGIN_KEY);
        expect(PROVIDER_CAPABILITIES.llm.settingKey).toBe(LLM_PLUGIN_KEY);
        expect(PROVIDER_CAPABILITIES.mixer.settingKey).toBe(MIXER_PLUGIN_KEY);
        expect(PROVIDER_CAPABILITIES.analysis.settingKey).toBe(ANALYSIS_PLUGIN_KEY);
        expect(PROVIDER_CAPABILITIES.similarity.settingKey).toBe(SIMILARITY_ORDER_KEY);
    });

    it('keys every entry by the capability it is about', () => {
        for (const [key, entry] of Object.entries(PROVIDER_CAPABILITIES)) {
            expect(entry.capability, key).toBe(key);
        }
    });

    it('declares every key it names, in the shape its mode implies', () => {
        for (const entry of providerCapabilities()) {
            const descriptor = findDescriptor(entry.settingKey);

            expect(descriptor, entry.capability).toBeDefined();
            // A `one` capability stores a plugin id and an `ordered` one stores rows. The console
            // writes what the mode says, so a mismatch here is a settings form writing a shape
            // nothing can read back.
            expect(descriptor?.type, entry.capability).toBe(entry.mode === 'one' ? 'string' : 'list');
        }
    });

    it('gives every ordered capability a single column the order helper reads', () => {
        for (const entry of providerCapabilities().filter(one => one.mode === 'ordered')) {
            const columns = findDescriptor(entry.settingKey)?.columns ?? [];

            expect(columns.map(column => column.key), entry.capability).toEqual([ORDER_SOURCE_COLUMN]);
        }
    });
});

/** A record the capability views accept: active, with a manifest declaring the capability. */
function record(id: string, capability: string, instance: Record<string, unknown>): PluginRecord {
    return {
        id,
        status: 'active',
        manifest: { id, name: id, version: '1.0.0', capabilities: [capability] },
        instance,
    } as unknown as PluginRecord;
}

const speaker = (id: string) => record(id, 'speech', { speak: () => undefined, voices: () => [] });

describe('reaching a capability through the table', () => {
    const records = [speaker('zeta.speech'), speaker('acme.speech')];

    it('orders candidates by id when no setting names one', () => {
        const { config } = settingsConfig();

        expect(pluginsInOrder(records, config, PROVIDER_CAPABILITIES.speech).map(one => one.record.id)).toEqual(['acme.speech', 'zeta.speech']);
    });

    it('takes the first candidate when the setting is empty, which is selectPlugin’s default', () => {
        const { config } = settingsConfig();

        expect(pluginInUse(records, config, PROVIDER_CAPABILITIES.speech)?.record.id).toBe('acme.speech');
    });

    it('takes the plugin the setting names', () => {
        const { config } = settingsConfig({ [SPEECH_PLUGIN_KEY]: 'zeta.speech' });

        expect(pluginInUse(records, config, PROVIDER_CAPABILITIES.speech)?.record.id).toBe('zeta.speech');
    });

    it('answers nothing for a named plugin that cannot do the job, rather than falling back', () => {
        // An instruction, not a default: quietly speaking in a different voice is how a station
        // ends up wrong with nothing in the log.
        const { config } = settingsConfig({ [SPEECH_PLUGIN_KEY]: 'deadair.gone' });

        expect(pluginInUse(records, config, PROVIDER_CAPABILITIES.speech)).toBeUndefined();
    });
});
