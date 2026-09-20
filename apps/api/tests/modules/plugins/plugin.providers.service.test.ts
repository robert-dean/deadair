// What the console is told about who does a job. The point of the endpoint is that it answers from
// the same table and the same two helpers the station's own services call, so what is pinned here
// is agreement with them: the order really is the asking order, the chosen plugin really is
// `selectPlugin`'s, and the state where a named plugin is not running is reported rather than
// looking like an ordinary default.

import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '@deadair/plugin-sdk';

import { PluginProvidersService } from '../../../src/modules/plugins/plugin.providers.service.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord, PluginStatus } from '../../../src/modules/plugins/types/plugin.record.js';
import type { ProviderCapabilityState } from '../../../src/modules/plugins/types/plugins.types.js';
import type { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import type { PluginConfigRepository } from '../../../src/modules/plugins/plugin.config.repository.js';
import { SPEECH_PLUGIN_KEY } from '../../../src/modules/render/speech.settings.js';
import { SIMILARITY_ORDER_KEY } from '../../../src/modules/similarity/similarity.settings.js';
import { ENRICHMENT_KEYS } from '../../../src/modules/enrichment/enrichment.keys.js';
import { settingsConfig } from '../../utils/settings.config.js';

/** The value the console writes for an ordered capability. */
const order = (...ids: string[]): string => JSON.stringify(ids.map(source => ({ source })));

interface RecordOptions {
    status?: PluginStatus;
    enabled?: boolean;
    instance?: Record<string, unknown>;
}

const SPEAKS = { speak: () => undefined, voices: () => [] };
const RESEMBLES = { similarArtists: () => [] };
const ENRICHES = { enrichTrack: () => ({}), matchKeys: ['artist-title'] };

function record(id: string, capability: string, options: RecordOptions = {}): PluginRecord {
    const manifest = { id, name: `The ${id}`, version: '1.0.0', capabilities: [capability] } as unknown as PluginManifest;
    return {
        id,
        dir: `/plugins/${id}`,
        origin: 'bundled',
        status: options.status ?? 'active',
        manifest,
        instance: options.instance as never,
    } as PluginRecord;
}

/**
 * The service over a registry, a settings config and an actor who may see everything.
 *
 * `enabledIds` stands in for the `plugin_configs` rows: the endpoint reports `enabled` from the
 * table, because the registry's `status` says whether a plugin is RUNNING and those are different
 * questions for a plugin that is switched on and misconfigured.
 */
function build(records: PluginRecord[], rows: Record<string, string> = {}, enabledIds: string[] = records.map(one => one.id)): PluginProvidersService {
    const registry = new PluginRegistry();
    registry.setAll(records);

    const repository = { list: vi.fn(async () => enabledIds.map(pluginId => ({ pluginId, enabled: true }))) } as unknown as PluginConfigRepository;
    const accessControl = { listVisibleIds: vi.fn(async () => ({ all: true as const })) } as unknown as AccessControlService;

    return new PluginProvidersService(registry, repository, settingsConfig(rows).config, accessControl);
}

/** One capability's block, which is what every assertion here is about. */
async function stateOf(service: PluginProvidersService, capability: string): Promise<ProviderCapabilityState> {
    const found = (await service.listProviders()).capabilities.find(one => one.capability === capability);
    if (!found) throw new Error(`no state for ${capability}`);
    return found;
}

describe('which capabilities are reported at all', () => {
    it('leaves out a capability nothing installed can answer', async () => {
        // A station with no charts plugin has no question to answer about chart plugins.
        const catalogue = await build([record('acme.speech', 'speech', { instance: SPEAKS })]).listProviders();

        expect(catalogue.capabilities.map(one => one.capability)).toEqual(['speech']);
    });

    it('reports a capability whose only plugin is not running, so the page can say why', async () => {
        const catalogue = await build([record('acme.speech', 'speech', { status: 'disabled' })]).listProviders();

        expect(catalogue.capabilities.map(one => one.capability)).toEqual(['speech']);
    });
});

describe('a capability with one answer', () => {
    const records = [record('zeta.speech', 'speech', { instance: SPEAKS }), record('acme.speech', 'speech', { instance: SPEAKS })];

    it('marks the first by id as in use when nothing is named', async () => {
        // `selectPlugin`'s default, which the console used to reimplement.
        const state = await stateOf(build(records), 'speech');

        expect(state.candidates.map(one => one.pluginId)).toEqual(['acme.speech', 'zeta.speech']);
        expect(state.candidates.filter(one => one.inUse).map(one => one.pluginId)).toEqual(['acme.speech']);
        expect(state.configured).toBe('');
        expect(state.unanswered).toBe(false);
    });

    it('marks the named plugin as in use, and says the operator named it', async () => {
        const state = await stateOf(build(records, { [SPEECH_PLUGIN_KEY]: 'zeta.speech' }), 'speech');

        expect(state.candidates.filter(one => one.inUse).map(one => one.pluginId)).toEqual(['zeta.speech']);
        expect(state.candidates.find(one => one.pluginId === 'zeta.speech')?.listed).toBe(true);
        expect(state.candidates.find(one => one.pluginId === 'acme.speech')?.listed).toBe(false);
    });

    it('reports the station having NO provider when the named plugin cannot answer', async () => {
        // The dangerous state: naming a plugin is an instruction and never falls back, so this is
        // a station that cannot speak at all. It must not look like an ordinary default.
        const state = await stateOf(build(records, { [SPEECH_PLUGIN_KEY]: 'deadair.gone' }), 'speech');

        expect(state.unanswered).toBe(true);
        expect(state.stale).toEqual(['deadair.gone']);
        expect(state.candidates.some(one => one.inUse)).toBe(false);
    });

    it('does not call it unanswered when nothing is named, which is a default and not a hole', async () => {
        expect((await stateOf(build(records), 'speech')).unanswered).toBe(false);
    });

    it('does not call it unanswered when a named plugin is simply not enabled yet', async () => {
        // Still a hole in the station, and still reported as one: the setting is an instruction
        // either way, so a plugin named and switched off leaves nothing speaking.
        const state = await stateOf(build([record('acme.speech', 'speech', { status: 'disabled' })], { [SPEECH_PLUGIN_KEY]: 'acme.speech' }), 'speech');

        expect(state.unanswered).toBe(true);
        expect(state.stale).toEqual(['acme.speech']);
    });
});

describe('a capability everything is asked for', () => {
    const records = [
        record('deadair.musicbrainz', 'similarity', { instance: RESEMBLES }),
        record('deadair.deezer', 'similarity', { instance: RESEMBLES }),
    ];

    it('numbers the candidates in the order the station asks them', async () => {
        const state = await stateOf(build(records, { [SIMILARITY_ORDER_KEY]: order('deadair.musicbrainz') }), 'similarity');

        expect(state.candidates.map(one => [one.pluginId, one.position])).toEqual([
            ['deadair.musicbrainz', 1],
            ['deadair.deezer', 2],
        ]);
    });

    it('marks every active candidate in use, because an ordered capability asks them all', async () => {
        const state = await stateOf(build(records), 'similarity');

        expect(state.candidates.every(one => one.inUse)).toBe(true);
        expect(state.mode).toBe('ordered');
    });

    it('reports a listed id nothing answers to, though it costs the station nothing', async () => {
        // Harmless and silent is still a row in a table that does nothing, and an operator cannot
        // tell it from one that works.
        const state = await stateOf(build(records, { [SIMILARITY_ORDER_KEY]: order('deadair.gone', 'deadair.deezer') }), 'similarity');

        expect(state.stale).toEqual(['deadair.gone']);
        expect(state.unanswered).toBe(false);
        expect(state.candidates[0]?.pluginId).toBe('deadair.deezer');
    });

    it('hands back the raw stored value, so the console can tell a default order from a set one', async () => {
        const state = await stateOf(build(records, { [SIMILARITY_ORDER_KEY]: order('deadair.deezer') }), 'similarity');

        expect(state.configured).toBe(order('deadair.deezer'));
        expect(state.settingKey).toBe(SIMILARITY_ORDER_KEY);
    });
});

describe('a plugin that cannot currently answer', () => {
    it('is listed without a position, since it is in no asking order', async () => {
        const state = await stateOf(
            build([
                record('acme.speech', 'speech', { instance: SPEAKS }),
                record('zeta.speech', 'speech', { status: 'misconfigured', enabled: true }),
            ]),
            'speech',
        );

        const idle = state.candidates.find(one => one.pluginId === 'zeta.speech');
        expect(idle?.position).toBeUndefined();
        expect(idle?.status).toBe('misconfigured');
        expect(idle?.inUse).toBe(false);
    });

    it('reports enabled from the table rather than from whether it is running', async () => {
        // A plugin switched on and failing is enabled and not active, and the page has to be able
        // to say so: "you turned this on and it is not answering" is a different sentence from
        // "you have not turned this on".
        // `misconfigured` rather than `failed` because a quarantined plugin has no manifest at
        // all, so nothing knows which capability it claimed and it appears under none of them.
        const state = await stateOf(
            build([record('acme.speech', 'speech', { status: 'misconfigured' }), record('zeta.speech', 'speech', { instance: SPEAKS })], {}, [
                'zeta.speech',
            ]),
            'speech',
        );

        expect(state.candidates.find(one => one.pluginId === 'acme.speech')?.enabled).toBe(false);
        expect(state.candidates.find(one => one.pluginId === 'zeta.speech')?.enabled).toBe(true);
    });
});

describe('enrichment, whose order overrides a number the author chose', () => {
    const records = [
        record('deadair.canonical', 'enrichment', { instance: { ...ENRICHES, priority: 100 } }),
        record('deadair.guess', 'enrichment', { instance: { ...ENRICHES, priority: 900 } }),
    ];

    it('orders by the declared priority when the operator has said nothing', async () => {
        const state = await stateOf(build(records), 'enrichment');

        expect(state.candidates.map(one => one.pluginId)).toEqual(['deadair.canonical', 'deadair.guess']);
    });

    it('carries the declared priority, so the page can show what it is overriding', async () => {
        const state = await stateOf(build(records), 'enrichment');

        expect(state.candidates.map(one => one.declaredPriority)).toEqual([100, 900]);
    });

    it('puts the operator’s choice first and says so', async () => {
        const state = await stateOf(build(records, { [ENRICHMENT_KEYS.providerOrder]: order('deadair.guess') }), 'enrichment');

        expect(state.candidates.map(one => one.pluginId)).toEqual(['deadair.guess', 'deadair.canonical']);
        expect(state.candidates[0]?.listed).toBe(true);
    });

    it('reports no priority for a capability that has none, rather than inventing one', async () => {
        const state = await stateOf(build([record('acme.speech', 'speech', { instance: SPEAKS })]), 'speech');

        expect(state.candidates[0]?.declaredPriority).toBeUndefined();
    });
});

describe('what an actor may see', () => {
    it('leaves out a plugin this actor cannot view', async () => {
        const registry = new PluginRegistry();
        registry.setAll([record('acme.speech', 'speech', { instance: SPEAKS }), record('zeta.speech', 'speech', { instance: SPEAKS })]);

        const repository = { list: vi.fn(async () => []) } as unknown as PluginConfigRepository;
        const accessControl = { listVisibleIds: vi.fn(async () => ({ ids: ['zeta.speech'] })) } as unknown as AccessControlService;
        const service = new PluginProvidersService(registry, repository, settingsConfig().config, accessControl);

        const state = await stateOf(service, 'speech');

        expect(state.candidates.map(one => one.pluginId)).toEqual(['zeta.speech']);
    });
});
