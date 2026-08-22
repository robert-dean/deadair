// The phrasing vocabulary is now held in two places that cannot import each other: the director
// module, which fills the placeholders in, and the console's editor, which warns an operator about a
// line naming one that does not exist. A browser bundle cannot import a Node server, and the SDK
// between them carries shapes rather than behaviour — so this is `voice.slots.test.ts`'s situation
// exactly, and gets its answer: hold the copies together in a test that imports both.
//
// The failure it guards is silent in the worst way. A phrasing naming `{{next.titel}}` is never
// picked, so from the console it looks identical to one the station simply never chooses — which is
// the whole reason the editor warns. If the two lists drift, the warning becomes the bug: the editor
// flags a placeholder that works, or stays quiet about one that does not.
//
// It only bites on a change — adding a placeholder, renaming one — which is exactly when a test
// earns its keep and a runtime check does not.

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_TEMPLATES,
    TEMPLATE_VOCABULARY,
    hasStrayBracket,
    parseTemplates,
    unknownPlaceholders,
} from '../../../src/modules/director/break.templates.js';
import {
    TEMPLATE_VOCABULARY as WEB_VOCABULARY,
    hasStrayBracket as webHasStrayBracket,
    templateLines,
    unknownPlaceholders as webUnknownPlaceholders,
} from '../../../../web/src/components/personas/template.vocabulary.js';

/**
 * Lines that have to be judged the same way by both copies.
 *
 * The first group is what the station itself ships, which must be clean on both sides or the editor
 * warns about the defaults. The rest are the shapes that actually turn up: a typo, a lone bracket a
 * voice reads out, a legal optional chunk with a placeholder inside it, and the two degenerate
 * spellings of a placeholder.
 */
const FIXTURES = [
    ...DEFAULT_TEMPLATES,
    'That was {{previous.titel}}.',
    '[Mate] That was {{previous.title}}.',
    'That was {{previous.title}}.[[ Next up, {{next.title}}.]]',
    'That was {{ next.title }}.',
    'That was {{}}.',
    'Nothing here names anything at all.',
    '[[ {{next.artist.name}} ]] and a stray ] as well',
];

describe('the phrasing vocabulary', () => {
    it('is the same list on both sides, so the editor warns about exactly what the writer cannot fill', () => {
        expect([...WEB_VOCABULARY].sort()).toEqual([...TEMPLATE_VOCABULARY].sort());
    });

    it('is not empty on either side, which is the way a broken copy passes an equality check', () => {
        expect(WEB_VOCABULARY.length).toBeGreaterThan(0);
        expect(TEMPLATE_VOCABULARY.length).toBeGreaterThan(0);
    });
});

describe('the two copies of the checks', () => {
    it.each(FIXTURES)('name the same unfillable placeholders in %j', template => {
        expect(webUnknownPlaceholders(template)).toEqual(unknownPlaceholders(template));
    });

    it.each(FIXTURES)('agree about a stray bracket in %j', template => {
        expect(webHasStrayBracket(template)).toBe(hasStrayBracket(template));
    });

    it('pass everything the station ships, or the editor warns about its own defaults', () => {
        for (const template of DEFAULT_TEMPLATES) {
            expect(webUnknownPlaceholders(template)).toEqual([]);
            expect(webHasStrayBracket(template)).toBe(false);
        }
    });
});

describe('splitting a box of phrasings into lines', () => {
    it('drops the same blanks and comments the writer drops', () => {
        const raw = ['That was {{previous.title}}.', '', '# a phrasing turned off rather than lost', '   ', '  Up next: {{next.title}}.  '].join(
            '\n',
        );

        // `parseTemplates` is the writer's own spelling of the split, with the fallback given
        // explicitly so an empty box does not answer with the station's defaults instead.
        expect(templateLines(raw)).toEqual([...parseTemplates(raw, [])]);
    });

    it('agrees that an empty box holds no phrasings', () => {
        expect(templateLines('')).toEqual([...parseTemplates('', [])]);
    });
});
