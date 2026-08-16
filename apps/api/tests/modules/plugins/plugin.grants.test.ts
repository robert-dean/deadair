import { describe, expect, it } from 'vitest';
import { capabilityOf, HOST_CAPABILITIES, isPrivateAddress, NETWORK_OPEN } from '../../../src/modules/plugins/plugin.grants.js';

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
