import { describe, expect, it } from 'vitest';

import { errorText, PluginError, scrubSecrets } from '../src/plugin.error.js';

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

describe('scrubSecrets', () => {
    it('replaces every occurrence of every secret', () => {
        expect(scrubSecrets('GET /bot123:abc/getMe failed for 123:abc', ['123:abc'])).toBe('GET /bot<token>/getMe failed for <token>');
        expect(scrubSecrets('xoxb-1 and xapp-2', ['xoxb-1', 'xapp-2'])).toBe('<token> and <token>');
    });

    it('skips a blank secret rather than scattering the placeholder', () => {
        expect(scrubSecrets('nothing to hide', [''])).toBe('nothing to hide');
    });
});
