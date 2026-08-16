import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Container } from 'injectkit';
import { NETWORK_OPEN } from '../../../src/modules/plugins/plugin.grants.js';
import { PluginGrantsRepository, type PluginGrantRecord } from '../../../src/modules/plugins/plugin.grants.repository.js';
import { PluginGrantsService } from '../../../src/modules/plugins/plugin.grants.service.js';

/**
 * The store, as the service reads it. `inScope` opens a scope and asks for the repository, so this
 * is the smallest thing that satisfies that: a container whose scope answers with one object.
 */
const containerServing = (repository: Partial<PluginGrantsRepository>): Container =>
    ({
        createScopedContainer: () => ({
            get: () => repository,
            disposeAsync: async () => {},
        }),
    }) as unknown as Container;

const record = (pluginId: string, capability: string, decision: 'allowed' | 'denied'): PluginGrantRecord => ({
    pluginId,
    capability,
    decision,
    decidedAt: DateTime.utc(),
});

let rows: PluginGrantRecord[];
let repository: { list: ReturnType<typeof vi.fn>; decide: ReturnType<typeof vi.fn>; forget: ReturnType<typeof vi.fn> };
let service: PluginGrantsService;

beforeEach(() => {
    rows = [];
    repository = {
        list: vi.fn(async () => rows),
        decide: vi.fn(async (pluginId: string, capability: string, decision: 'allowed' | 'denied') => {
            rows = [...rows.filter(row => !(row.pluginId === pluginId && row.capability === capability)), record(pluginId, capability, decision)];
            return rows.at(-1)!;
        }),
        forget: vi.fn(async (pluginId: string, capability: string) => {
            rows = rows.filter(row => !(row.pluginId === pluginId && row.capability === capability));
        }),
    };
    service = new PluginGrantsService(containerServing(repository as unknown as Partial<PluginGrantsRepository>));
});

describe('PluginGrantsService', () => {
    // The state the whole design turns on: no row is not the same as a refusal to a person, and is
    // exactly the same as a refusal to the host.
    it('refuses a capability nobody has answered for', async () => {
        await service.refresh();

        expect(service.holds('deadair.rss', NETWORK_OPEN)).toBe(false);
        expect(service.decisionFor('deadair.rss', NETWORK_OPEN)).toBeUndefined();
    });

    it('holds what was allowed and not what was denied', async () => {
        rows = [record('deadair.rss', NETWORK_OPEN, 'allowed'), record('deadair.wikipedia', NETWORK_OPEN, 'denied')];
        await service.refresh();

        expect(service.holds('deadair.rss', NETWORK_OPEN)).toBe(true);
        expect(service.holds('deadair.wikipedia', NETWORK_OPEN)).toBe(false);
        // The difference the table shows and the host does not care about.
        expect(service.decisionFor('deadair.wikipedia', NETWORK_OPEN)).toBe('denied');
    });

    // A retired capability leaves its rows behind, and none of them should be able to enable
    // anything by outliving the code that meant something by it.
    it('ignores a decision about a capability this host no longer publishes', async () => {
        rows = [record('deadair.rss', 'network.everything', 'allowed')];
        await service.refresh();

        expect(service.holds('deadair.rss', 'network.everything')).toBe(false);
    });

    // The gap between writing and re-reading is a window where the operator has clicked Allow and
    // the host still says no. Short, and long enough to be the thing somebody reports.
    it('applies a decision without waiting for anything else to refresh it', async () => {
        await service.refresh();
        expect(service.holds('deadair.rss', NETWORK_OPEN)).toBe(false);

        await service.decide('deadair.rss', NETWORK_OPEN, 'allowed', 'actor-1');

        expect(service.holds('deadair.rss', NETWORK_OPEN)).toBe(true);
        expect(repository.decide).toHaveBeenCalledWith('deadair.rss', NETWORK_OPEN, 'allowed', 'actor-1');
    });

    // Taking a decision back is not the same as denying: an operator who wants to think about it
    // should not have to leave a refusal on the record.
    it('returns a capability to unanswered rather than storing a third value', async () => {
        rows = [record('deadair.rss', NETWORK_OPEN, 'allowed')];
        await service.refresh();

        await service.forget('deadair.rss', NETWORK_OPEN);

        expect(service.decisionFor('deadair.rss', NETWORK_OPEN)).toBeUndefined();
        expect(service.holds('deadair.rss', NETWORK_OPEN)).toBe(false);
    });

    // A host that cannot read what it granted should not be granting: the map is rebuilt wholesale,
    // so a load that answers with nothing leaves nothing held.
    it('rebuilds the whole map rather than patching it, so a removed row stops holding', async () => {
        rows = [record('deadair.rss', NETWORK_OPEN, 'allowed')];
        await service.refresh();
        expect(service.holds('deadair.rss', NETWORK_OPEN)).toBe(true);

        rows = [];
        await service.refresh();

        expect(service.holds('deadair.rss', NETWORK_OPEN)).toBe(false);
    });
});
