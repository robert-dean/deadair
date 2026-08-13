import { describe, expect, it } from 'vitest';

import { PluginError, errorText } from '../src/plugin.error.js';

describe('errorText', () => {
    it('takes an Error at its message', () => {
        expect(errorText(new Error('the upstream refused'))).toBe('the upstream refused');
    });

    it('reads a PluginError the same way, without its code', () => {
        expect(errorText(new PluginError('rate limited').withCode('rate_limited'))).toBe('rate limited');
    });

    it('stringifies what was never an Error, because plugins catch those too', () => {
        expect(errorText('a thrown string')).toBe('a thrown string');
        expect(errorText(undefined)).toBe('undefined');
        expect(errorText(404)).toBe('404');
    });
});
