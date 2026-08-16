import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { isPrivateAddress, PLUGIN_NETWORK_KEYS, PluginNetworkPolicy } from '../../../src/modules/plugins/plugin.network.policy.js';

/** `AppConfig` as a live view over one key, which is all this reads. */
const configHolding = (value: unknown): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key === PLUGIN_NETWORK_KEYS.unrestricted ? value : fallback) }) as unknown as AppConfig;

const policy = (value: unknown): PluginNetworkPolicy => new PluginNetworkPolicy(configHolding(value));

describe('PluginNetworkPolicy', () => {
    it('is off when nobody has said anything', () => {
        expect(policy('').isUnrestricted('deadair.rss')).toBe(false);
        expect(policy('   \n  ').isUnrestricted('deadair.rss')).toBe(false);
        expect(policy(undefined).isUnrestricted('deadair.rss')).toBe(false);
    });

    it('lists one plugin per line', () => {
        const listed = policy('deadair.rss\ndeadair.wikipedia');

        expect(listed.isUnrestricted('deadair.rss')).toBe(true);
        expect(listed.isUnrestricted('deadair.wikipedia')).toBe(true);
        expect(listed.isUnrestricted('deadair.spotify')).toBe(false);
    });

    // The same shape as every other multi-line setting, so an operator who has
    // met one has met this.
    it('ignores blank lines and commented ones', () => {
        const listed = policy('\n# deadair.spotify\n  deadair.rss  \n\n');

        expect(listed.isUnrestricted('deadair.rss')).toBe(true);
        expect(listed.isUnrestricted('deadair.spotify')).toBe(false);
    });

    // A whole line, never a prefix: `deadair.rss` must not admit
    // `deadair.rss.evil`, and the id is what the operator sees on the plugin's
    // own page.
    it('matches a whole id and not part of one', () => {
        const listed = policy('deadair.rss');

        expect(listed.isUnrestricted('deadair.rss.other')).toBe(false);
        expect(listed.isUnrestricted('rss')).toBe(false);
        expect(listed.isUnrestricted('DEADAIR.RSS')).toBe(true);
    });

    it('reads the setting on every question, so a change needs no plugin reload', () => {
        let listed = '';
        const live = new PluginNetworkPolicy({ get: () => listed } as unknown as AppConfig);

        expect(live.isUnrestricted('deadair.rss')).toBe(false);
        listed = 'deadair.rss';
        expect(live.isUnrestricted('deadair.rss')).toBe(true);
    });
});

describe('isPrivateAddress', () => {
    it.each([
        '127.0.0.1',
        '10.4.4.4',
        '172.16.0.1',
        '172.31.255.254',
        '192.168.0.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        'localhost',
        'printer.local',
        'db.internal',
        '::1',
        '[::1]',
        'fd00::1',
        'fe80::1',
        '::ffff:127.0.0.1',
    ])('refuses %s', address => {
        expect(isPrivateAddress(address)).toBe(true);
    });

    it.each(['www.npr.org', 'feeds.example.org', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.128.0.1', '2606:4700::1111', 'localhost.example.com'])(
        'allows %s',
        address => {
            expect(isPrivateAddress(address)).toBe(false);
        },
    );
});
