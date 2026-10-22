import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { llmsLinks, SITE_ORIGIN, unservedLinks } from '../src/llms.links';

const llmsTxt = readFileSync(join(__dirname, '../static/llms.txt'), 'utf8');

describe('llmsLinks', () => {
    it('reads every markdown link target in order', () => {
        expect(llmsLinks('- [A](https://deadair.radio/docs/a): one\n- [B](https://example.com/b)')).toEqual([
            'https://deadair.radio/docs/a',
            'https://example.com/b',
        ]);
    });
});

describe('unservedLinks', () => {
    it('asks only about links on this site, by path', () => {
        const asked: string[] = [];
        const missing = unservedLinks([`${SITE_ORIGIN}/docs/a`, 'https://github.com/robert-dean/deadair', `${SITE_ORIGIN}/openapi.yaml`], path => {
            asked.push(path);
            return path === '/docs/a';
        });
        expect(asked).toEqual(['/docs/a', '/openapi.yaml']);
        expect(missing).toEqual(['/openapi.yaml']);
    });

    it('does not take a look-alike host for this site', () => {
        expect(unservedLinks(['https://deadair.radio.example.com/docs/a'], () => false)).toEqual([]);
    });
});

// The shape https://llmstxt.org asks for: a title, then a one-paragraph summary as a quote.
describe('static/llms.txt', () => {
    it('opens with the name and a summary', () => {
        const [title, blank, summary] = llmsTxt.split('\n');
        expect(title).toBe('# deadair');
        expect(blank).toBe('');
        expect(summary).toMatch(/^> \S/);
    });

    it('links only by absolute address', () => {
        const links = llmsLinks(llmsTxt);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) expect(link).toMatch(/^https:\/\//);
    });
});
