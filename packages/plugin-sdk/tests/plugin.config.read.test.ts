import { describe, expect, it } from 'vitest';

import { configBaseUrl, configFlag, configLines, configString } from '../src/plugin.config.read.js';

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

describe('configLines', () => {
    it('splits on newlines and commas, trimming each line and dropping blanks', () => {
        expect(configLines('  -100123 \n\n-100456, -100789 ,')).toEqual(['-100123', '-100456', '-100789']);
    });

    it('answers an empty list for a field that is not a string', () => {
        expect(configLines(undefined)).toEqual([]);
        expect(configLines(['a'])).toEqual([]);
        expect(configLines(42)).toEqual([]);
    });
});

describe('configFlag', () => {
    it('reads a real boolean', () => {
        expect(configFlag(true, false)).toBe(true);
        expect(configFlag(false, true)).toBe(false);
    });

    it('reads the text a hand-edited row holds, so "false" is off rather than truthy', () => {
        expect(configFlag('true', false)).toBe(true);
        expect(configFlag('false', true)).toBe(false);
    });

    it('takes the fallback for anything else, absent included', () => {
        expect(configFlag(undefined, true)).toBe(true);
        expect(configFlag(undefined, false)).toBe(false);
        expect(configFlag('yes', false)).toBe(false);
        expect(configFlag(1, true)).toBe(true);
    });
});
