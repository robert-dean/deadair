import { describe, expect, it, vi } from 'vitest';
import { capabilityOf, HOST_CAPABILITIES, isPrivateAddress, NETWORK_OPEN, privateAddressBehind } from '../../../src/modules/plugins/plugin.grants.js';

/**
 * The capability vocabulary is the HOST's, and the tests that matter are about what it refuses to
 * be: extensible from data, and wider than the sentence it shows the operator.
 */
describe('HOST_CAPABILITIES', () => {
    it('answers about an id it publishes and about nothing else', () => {
        expect(capabilityOf(NETWORK_OPEN)?.id).toBe(NETWORK_OPEN);
        expect(capabilityOf('network.everything')).toBeUndefined();
        expect(capabilityOf('')).toBeUndefined();
    });

    // Not decoration. A capability with no guard behind it grants nothing and forbids nothing, and
    // nothing about the row on the settings page would say so.
    it('says of every capability what it opens up and where that is enforced', () => {
        for (const capability of HOST_CAPABILITIES) {
            expect(capability.label.length, capability.id).toBeGreaterThan(0);
            expect(capability.describes.length, capability.id).toBeGreaterThan(40);
            expect(capability.enforcedAt.length, capability.id).toBeGreaterThan(0);
        }
    });

    // The description is what an operator decides on, so the sentence and the code have to agree
    // about the one thing allowing this does NOT do.
    it('tells the operator that private addresses stay refused, because they do', () => {
        expect(capabilityOf(NETWORK_OPEN)?.describes).toMatch(/private/i);
        expect(isPrivateAddress('192.168.1.1')).toBe(true);
    });
});

/**
 * The guard that survives a grant. Redirects are chased by hand precisely so an allowlisted upstream
 * cannot bounce an honest plugin into the metadata service, and "the operator allowed the open web"
 * is not a reason to hand that back.
 */
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
        // The hex spelling of the same thing, which is how the URL parser serialises it.
        '::ffff:7f00:1',
        '[::ffff:7f00:1]',
        '::ffff:a00:1',
        '::ffff:c0a8:101',
        '0:0:0:0:0:ffff:7f00:1',
    ])('refuses %s', address => {
        expect(isPrivateAddress(address)).toBe(true);
    });

    it.each([
        'www.npr.org',
        'feeds.example.org',
        '8.8.8.8',
        '172.32.0.1',
        '172.15.0.1',
        '100.128.0.1',
        '2606:4700::1111',
        'localhost.example.com',
        '::ffff:808:808',
    ])('allows %s', address => {
        expect(isPrivateAddress(address)).toBe(false);
    });
});

/**
 * The half of the guard that reads what a NAME reaches. A public name is whatever its owner points it
 * at, and a feed item or a search result is exactly where such a name arrives from.
 */
describe('privateAddressBehind', () => {
    const resolving = (answers: Record<string, string[]>) => vi.fn(async (hostname: string) => answers[hostname] ?? []);

    it('names the private address a public name resolves to', async () => {
        const resolve = resolving({ 'innocent.example': ['127.0.0.1'] });

        await expect(privateAddressBehind('innocent.example', resolve)).resolves.toBe('127.0.0.1');
    });

    it('is satisfied by one private answer among several public ones', async () => {
        const resolve = resolving({ 'balanced.example': ['93.184.216.34', '10.0.0.7', '93.184.216.35'] });

        await expect(privateAddressBehind('balanced.example', resolve)).resolves.toBe('10.0.0.7');
    });

    it('reads a mapped IPv6 answer the way it reads the IPv4 inside it', async () => {
        const resolve = resolving({ 'mapped.example': ['::ffff:7f00:1'] });

        await expect(privateAddressBehind('mapped.example', resolve)).resolves.toBe('::ffff:7f00:1');
    });

    it('answers nothing for a name that is public all the way down', async () => {
        const resolve = resolving({ 'www.example.com': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] });

        await expect(privateAddressBehind('www.example.com', resolve)).resolves.toBeUndefined();
    });

    it('judges a literal address without looking anything up', async () => {
        const resolve = resolving({});

        await expect(privateAddressBehind('192.168.1.1', resolve)).resolves.toBe('192.168.1.1');
        await expect(privateAddressBehind('[::ffff:7f00:1]', resolve)).resolves.toBe('::ffff:7f00:1');
        await expect(privateAddressBehind('8.8.8.8', resolve)).resolves.toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('refuses a private name before asking the resolver about it', async () => {
        const resolve = resolving({});

        await expect(privateAddressBehind('printer.local', resolve)).resolves.toBe('printer.local');
        expect(resolve).not.toHaveBeenCalled();
    });

    it('lets a resolver failure through, so the caller fails closed rather than open', async () => {
        const resolve = vi.fn(async () => {
            throw new Error('ENOTFOUND');
        });

        await expect(privateAddressBehind('gone.example', resolve)).rejects.toThrow('ENOTFOUND');
    });
});
