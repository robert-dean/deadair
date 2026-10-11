import { describe, expect, it } from 'vitest';

import { isLoopback, partyLink } from '../../src/api/party.queries';

describe('the party link', () => {
    it('is the guest page on this console’s own origin, with the pass after #', () => {
        expect(partyLink('dp_abc', 'https://radio.example.com')).toBe('https://radio.example.com/party#dp_abc');
    });

    it('knows an address only this machine can reach', () => {
        expect(isLoopback('http://localhost:8080')).toBe(true);
        expect(isLoopback('http://127.0.0.1:3002')).toBe(true);
        expect(isLoopback('http://[::1]:8080')).toBe(true);
        expect(isLoopback('http://deadair.localhost')).toBe(true);
        expect(isLoopback('http://192.168.1.20:8080')).toBe(false);
        expect(isLoopback('https://radio.example.com')).toBe(false);
    });
});
