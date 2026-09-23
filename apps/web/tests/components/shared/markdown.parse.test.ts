// The release-notes Markdown reader. The shapes pinned here are the ones the station's own changelog
// uses, because that file is what this has to draw; and the one safety property, that a link can only
// ever go to the web or to this repository, because the notes for a newer release come from GitHub.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown, safeHref } from '../../../src/components/shared/markdown.parse';

describe('parseMarkdown', () => {
    it('reads a list whose items wrap onto indented lines', () => {
        expect(parseMarkdown('- One item\n  that wraps.\n- Two.')).toEqual([
            {
                kind: 'list',
                items: [
                    [{ kind: 'paragraph', children: [{ kind: 'text', text: 'One item that wraps.' }] }],
                    [{ kind: 'paragraph', children: [{ kind: 'text', text: 'Two.' }] }],
                ],
            },
        ]);
    });

    it('keeps a second paragraph and a nested list inside the item they are indented under', () => {
        const [list] = parseMarkdown('- First.\n\n  More about it:\n\n  - **A.** One\n    wrapped.\n  - B.\n- Second.');

        expect(list).toMatchObject({ kind: 'list' });
        const items = (list as { items: unknown[][] }).items;
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveLength(3);
        expect(items[0]![2]).toEqual({
            kind: 'list',
            items: [
                [
                    {
                        kind: 'paragraph',
                        children: [
                            { kind: 'strong', children: [{ kind: 'text', text: 'A.' }] },
                            { kind: 'text', text: ' One wrapped.' },
                        ],
                    },
                ],
                [{ kind: 'paragraph', children: [{ kind: 'text', text: 'B.' }] }],
            ],
        });
    });

    it('ends an item at a blank line followed by something that is not indented', () => {
        expect(parseMarkdown('- An item.\n\nA paragraph after the list.').map(block => block.kind)).toEqual(['list', 'paragraph']);
    });

    it('reads headings and joins a paragraph wrapped across lines', () => {
        expect(parseMarkdown('### The station\n\nThe first\nrelease.')).toEqual([
            { kind: 'heading', level: 3, children: [{ kind: 'text', text: 'The station' }] },
            { kind: 'paragraph', children: [{ kind: 'text', text: 'The first release.' }] },
        ]);
    });

    it('answers nothing for nothing', () => {
        expect(parseMarkdown('')).toEqual([]);
    });
});

describe('parseInline', () => {
    it('reads code, bold, italics and links', () => {
        expect(parseInline('Set **Keen** on `persona`, see *this* and [the issue](https://github.com/x/y/issues/1).')).toEqual([
            { kind: 'text', text: 'Set ' },
            { kind: 'strong', children: [{ kind: 'text', text: 'Keen' }] },
            { kind: 'text', text: ' on ' },
            { kind: 'code', text: 'persona' },
            { kind: 'text', text: ', see ' },
            { kind: 'em', children: [{ kind: 'text', text: 'this' }] },
            { kind: 'text', text: ' and ' },
            { kind: 'link', href: 'https://github.com/x/y/issues/1', children: [{ kind: 'text', text: 'the issue' }] },
            { kind: 'text', text: '.' },
        ]);
    });

    it('leaves everything inside a code span as the literal text it quotes', () => {
        expect(parseInline('markup (`[Jordache](/ʒɔrdæʃ/)`) and (`*laughs*`) and `<link rel="enclosure">`')).toEqual([
            { kind: 'text', text: 'markup (' },
            { kind: 'code', text: '[Jordache](/ʒɔrdæʃ/)' },
            { kind: 'text', text: ') and (' },
            { kind: 'code', text: '*laughs*' },
            { kind: 'text', text: ') and ' },
            { kind: 'code', text: '<link rel="enclosure">' },
        ]);
    });

    it('keeps the words of a link it will not follow', () => {
        expect(parseInline('[click](javascript:alert(1))')).not.toContainEqual(expect.objectContaining({ kind: 'link' }));
        expect(parseInline('[click](javascript:alert)')).toEqual([{ kind: 'text', text: 'click' }]);
    });

    it('does not read a lone asterisk as the start of italics', () => {
        expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
    });
});

describe('safeHref', () => {
    it('allows the web and resolves a repository path to the file on GitHub', () => {
        expect(safeHref('https://semver.org')).toBe('https://semver.org');
        expect(safeHref('apps/desktop/CHANGELOG.md')).toBe('https://github.com/robert-dean/deadair/blob/main/apps/desktop/CHANGELOG.md');
    });

    it('refuses every other scheme and every path that means nothing on a station', () => {
        for (const href of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c', '/ʒɔrdæʃ/', '#top', '../up']) {
            expect(safeHref(href)).toBeUndefined();
        }
    });
});

describe('the station changelog', () => {
    it('reads with no emphasis or code marker left over as plain text', async () => {
        const text = await readFile(resolve(__dirname, '../../../../../CHANGELOG.md'), 'utf8');

        const leftovers: string[] = [];
        const walkInline = (spans: ReturnType<typeof parseInline>) => {
            for (const span of spans) {
                if (span.kind === 'text' && /\*\*|`/.test(span.text)) leftovers.push(span.text);
                if ('children' in span) walkInline(span.children);
            }
        };
        const walk = (blocks: ReturnType<typeof parseMarkdown>) => {
            for (const block of blocks) {
                if (block.kind === 'list') block.items.forEach(walk);
                else walkInline(block.children);
            }
        };
        walk(parseMarkdown(text));

        expect(leftovers).toEqual([]);
    });
});
