import { describe, expect, it } from 'vitest';

import { en } from '../../src/i18n/en/en.catalog';

// `<Trans>` reads a catalog string with an HTML parser, which knows these as void elements: a
// `<link>…</link>` in a catalog closes itself and drops the text between, so the link it was meant
// to wrap renders empty. Name the tag after what it is in the console (`<anchor>`) instead.
const VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

function* strings(node: unknown, path: string): Generator<[string, string]> {
    if (typeof node === 'string') yield [path, node];
    else if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) yield* strings(value, path === '' ? key : `${path}.${key}`);
    }
}

describe('the English catalog', () => {
    it('wraps no copy in a tag the markup parser treats as void', () => {
        const pattern = new RegExp(`<(${VOID.join('|')})>`);
        const found = [...strings(en, '')].filter(([, text]) => pattern.test(text)).map(([path]) => path);
        expect(found).toEqual([]);
    });
});
