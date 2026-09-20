// The rule every capability that fans out shares for the ORDER it asks in, as `plugin.selection.ts`
// holds the rule for picking the one that answers. What is pinned here is the pair of promises the
// capabilities rely on and their own tests then assume: an unset setting reproduces the fallback
// exactly, and a listed id that nothing installed ever gates anything.

import { describe, expect, it } from 'vitest';

import { ORDER_SOURCE_COLUMN, byOrderThen, pluginOrder } from '../../../src/modules/plugins/plugin.order.js';
import { settingsConfig } from '../../utils/settings.config.js';

const KEY = 'rotation.similarityOrder';

const plugin = (id: string) => ({ record: { id } });

/** The value the console writes: a JSON array of one-column rows. */
const stored = (...ids: string[]): string => JSON.stringify(ids.map(source => ({ [ORDER_SOURCE_COLUMN]: source })));

/** Reads the order out of a config holding `raw`, which is how every caller reaches it. */
const orderFrom = (raw: string | undefined): string[] => pluginOrder(settingsConfig(raw === undefined ? {} : { [KEY]: raw }).config, KEY);

/** Sorts ids by an order, which is the whole of what a capability does with this. */
const asked = (order: readonly string[], ids: string[]): string[] =>
    ids
        .map(plugin)
        .sort(byOrderThen(order))
        .map(one => one.record.id);

describe('reading an order out of a setting', () => {
    it('answers the ids in the order the rows give them', () => {
        expect(orderFrom(stored('deadair.musicbrainz', 'deadair.deezer'))).toEqual(['deadair.musicbrainz', 'deadair.deezer']);
    });

    it('answers nothing for a setting nobody has set', () => {
        expect(orderFrom(undefined)).toEqual([]);
        expect(orderFrom('')).toEqual([]);
    });

    it('answers nothing rather than throwing for a value somebody broke by hand', () => {
        // The whole path is optional, so unreadable has to mean "no order" — which is the
        // station's behaviour before the setting existed — rather than an error on a refill.
        expect(orderFrom('{not json')).toEqual([]);
        expect(orderFrom('"a string"')).toEqual([]);
        expect(orderFrom('[1, 2, 3]')).toEqual([]);
    });

    it('keeps the FIRST of a duplicated id', () => {
        // An id written twice is one the operator wanted early and then wrote again.
        expect(orderFrom(stored('deadair.deezer', 'deadair.lastfm', 'deadair.deezer'))).toEqual(['deadair.deezer', 'deadair.lastfm']);
    });

    it('skips a blank cell rather than ranking an empty id', () => {
        expect(orderFrom(JSON.stringify([{ source: '  ' }, { source: 'deadair.lastfm' }, {}]))).toEqual(['deadair.lastfm']);
    });

    it('trims the whitespace a pasted id arrives with', () => {
        expect(orderFrom(JSON.stringify([{ source: ' deadair.deezer ' }]))).toEqual(['deadair.deezer']);
    });
});

describe('the order plugins are asked in', () => {
    it('asks the listed ones first, in the order given', () => {
        expect(asked(['deadair.musicbrainz', 'deadair.deezer'], ['deadair.deezer', 'deadair.lastfm', 'deadair.musicbrainz'])).toEqual([
            'deadair.musicbrainz',
            'deadair.deezer',
            'deadair.lastfm',
        ]);
    });

    it('reproduces the alphabetical fallback exactly when nothing is listed', () => {
        // The promise that lets this be added to a capability without changing a station that
        // never opens the page.
        expect(asked([], ['deadair.musicbrainz', 'deadair.deezer', 'deadair.lastfm'])).toEqual([
            'deadair.deezer',
            'deadair.lastfm',
            'deadair.musicbrainz',
        ]);
    });

    it('puts the unlisted behind the listed, alphabetically among themselves', () => {
        expect(asked(['deadair.musicbrainz'], ['deadair.lastfm', 'deadair.deezer', 'deadair.musicbrainz'])).toEqual([
            'deadair.musicbrainz',
            'deadair.deezer',
            'deadair.lastfm',
        ]);
    });

    it('ignores an id that nothing installed answers to, rather than gating on it', () => {
        // Orders and never disables: a typo here must not cost the station the capability.
        expect(asked(['deadair.nothing', 'deadair.lastfm'], ['deadair.deezer', 'deadair.lastfm'])).toEqual(['deadair.lastfm', 'deadair.deezer']);
    });

    it('orders the unlisted by a capability fallback when it has one', () => {
        // Enrichment's shape: the plugin author's declared priority decides the remainder, and the
        // operator's list overrules it for whatever they named.
        interface PriorityPlugin {
            record: { id: string };
            priority: number;
        }

        const withPriority = (id: string, priority: number): PriorityPlugin => ({ record: { id }, priority });
        const byPriority = (left: PriorityPlugin, right: PriorityPlugin): number => left.priority - right.priority;

        const sorted = [withPriority('deadair.guess', 900), withPriority('deadair.canonical', 100), withPriority('deadair.extra', 500)]
            .sort(byOrderThen(['deadair.guess'], byPriority))
            .map(one => one.record.id);

        expect(sorted).toEqual(['deadair.guess', 'deadair.canonical', 'deadair.extra']);
    });

    it('breaks a fallback tie on id, so one station answers the same way twice', () => {
        const flat = () => 0;
        const sorted = ['zeta.one', 'acme.two'].map(plugin).sort(byOrderThen([], flat));

        expect(sorted.map(one => one.record.id)).toEqual(['acme.two', 'zeta.one']);
    });
});
