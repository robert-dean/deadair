import { describe, expect, it } from 'vitest';

import { configBaseUrl, configString } from '../src/plugin.config.read.js';

describe('configString', () => {
    it('trims a set value', () => {
        expect(configString('  gpt-oss  ')).toBe('gpt-oss');
    });

    it('treats blank and whitespace-only as unset, which is what a cleared text box stores', () => {
        expect(configString('')).toBeUndefined();
        expect(configString('   ')).toBeUndefined();
    });

    it('treats a non-string as unset rather than coercing it', () => {
        expect(configString(undefined)).toBeUndefined();
        expect(configString(null)).toBeUndefined();
        expect(configString(42)).toBeUndefined();
        expect(configString({})).toBeUndefined();
    });
});

describe('configBaseUrl', () => {
    it('strips every trailing slash so a path appends with exactly one', () => {
        expect(configBaseUrl('http://localhost:8880/')).toBe('http://localhost:8880');
        expect(configBaseUrl('http://localhost:8880///')).toBe('http://localhost:8880');
        expect(configBaseUrl('  http://localhost:8880/v1/  ')).toBe('http://localhost:8880/v1');
    });

    it('leaves a URL without one alone', () => {
        expect(configBaseUrl('http://localhost:8880')).toBe('http://localhost:8880');
    });

    it('answers an empty string for unset, which is how a plugin reports not-configured', () => {
        expect(configBaseUrl(undefined)).toBe('');
        expect(configBaseUrl('')).toBe('');
        expect(configBaseUrl('   ')).toBe('');
        expect(configBaseUrl(42)).toBe('');
    });
});
