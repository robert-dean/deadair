// Turning a folksonomy into two vocabularies is the whole reason to install this plugin, and it is
// the part with no upstream to check against: the service returns whatever people typed. So the
// rules are pinned here — what counts as junk, what counts as a mood, and what the weight threshold
// is actually measuring.

import { describe, expect, it } from 'vitest';

import { isJunkTag, isMoodTag, normalizeTag, splitTags } from '../src/lastfm.tags.js';

const tag = (name: string, count?: number) => ({ name, ...(count === undefined ? {} : { count }) });

describe('junk', () => {
    it.each([
        'seen live',
        'Seen Live',
        'favourite songs',
        'favorites',
        'albums i own',
        'my favourite',
        'stuff i like',
        'heard on tv',
        '1994',
        '90s',
        '00s',
        'top 100',
        'spotify',
    ])('drops "%s", which is about the tagger rather than the record', name => {
        expect(isJunkTag(name)).toBe(true);
    });

    it.each(['trip hop', 'post-punk', 'shoegaze', 'british', 'female vocalists', 'instrumental'])(
        'keeps "%s", which says something about the record',
        name => {
            expect(isJunkTag(name)).toBe(false);
        },
    );

    it('keeps a genre that merely contains a junk word', () => {
        // The junk patterns match on word boundaries, so a style is not lost to one.
        expect(isJunkTag('drone')).toBe(false);
        expect(isJunkTag('grime')).toBe(false);
    });
});

describe('moods', () => {
    it.each(['chill', 'melancholy', 'dreamy', 'aggressive', 'nostalgic'])('routes "%s" to moods', name => {
        expect(isMoodTag(name)).toBe(true);
    });

    it('matches a whole tag and never a prefix, so chillwave stays a genre', () => {
        expect(isMoodTag('chill')).toBe(true);
        expect(isMoodTag('chillwave')).toBe(false);
    });

    it('normalizes before comparing', () => {
        expect(isMoodTag('  MELLOW  ')).toBe(true);
        expect(normalizeTag('  Trip   Hop ')).toBe('trip hop');
    });
});

describe('splitting a real tag list', () => {
    const tags = [
        tag('trip hop', 100),
        tag('electronic', 84),
        tag('seen live', 71),
        tag('melancholy', 60),
        tag('female vocalists', 55),
        tag('chill', 40),
        tag('albums i own', 33),
        tag('downtempo', 12),
        tag('obscure', 3),
    ];

    it('routes each tag to the vocabulary it belongs in', () => {
        const split = splitTags(tags, 10, 12);

        expect(split.genres).toEqual(['trip hop', 'electronic', 'female vocalists', 'downtempo']);
        expect(split.moods).toEqual(['melancholy', 'chill']);
    });

    it('keeps every tag that passed the weight bar in `raw`, junk included', () => {
        // The routing above is a judgement; this is the evidence for it, and it is why an operator
        // can tell a mis-routed tag from one the service never sent.
        const split = splitTags(tags, 10, 12);

        expect(split.raw).toContain('seen live');
        expect(split.raw).toContain('albums i own');
        expect(split.raw).not.toContain('obscure');
    });

    it('drops the long tail below the weight bar', () => {
        expect(splitTags(tags, 50, 12).genres).toEqual(['trip hop', 'electronic', 'female vocalists']);
    });

    it('keeps a tag with no weight at all, because some endpoints send none', () => {
        // Dropping these would silently make a whole endpoint contribute nothing.
        expect(splitTags([tag('shoegaze')], 50, 12).genres).toEqual(['shoegaze']);
    });

    it('counts genres and moods separately against the limit', () => {
        // Otherwise a record with a handful of mood words that sort highest spends its whole
        // allowance on them and reports no genre at all.
        const many = [tag('chill', 90), tag('mellow', 89), tag('dreamy', 88), tag('trip hop', 20), tag('downtempo', 19)];
        const split = splitTags(many, 10, 2);

        expect(split.moods).toEqual(['chill', 'mellow']);
        expect(split.genres).toEqual(['trip hop', 'downtempo']);
    });

    it('says the same tag once, however the service cased it', () => {
        expect(splitTags([tag('Trip Hop', 90), tag('trip hop', 80)], 10, 12).genres).toEqual(['Trip Hop']);
    });

    it('takes a lone object, which is how this API sends a one-entry list', () => {
        expect(splitTags(tag('ambient', 90), 10, 12).genres).toEqual(['ambient']);
    });

    it('answers with nothing at all when there are no tags', () => {
        expect(splitTags(undefined, 10, 12)).toEqual({ genres: [], moods: [], raw: [] });
    });
});
