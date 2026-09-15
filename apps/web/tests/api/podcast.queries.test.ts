import { describe, expect, it } from 'vitest';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { withSubscription } from '../../src/api/podcast.queries';

const feeds: ConfigFieldDescriptor = {
    key: 'feeds',
    label: 'Shows',
    type: 'list',
    columns: [
        { key: 'name', label: 'Name', type: 'string' },
        { key: 'url', label: 'Feed address', type: 'url' },
    ],
};

const show = { title: 'Night Radio', feedUrl: 'https://night.example.com/feed.xml' };

describe('withSubscription', () => {
    it('adds the show to the list field that holds feed addresses, named in its name column', () => {
        const added = withSubscription(
            [{ key: 'directory', label: 'Directory', type: 'boolean' }, feeds],
            { feeds: '[{"url":"https://a.example.com/feed"}]' },
            show,
        );

        expect(added).toEqual({
            fieldKey: 'feeds',
            value: JSON.stringify([{ url: 'https://a.example.com/feed' }, { url: 'https://night.example.com/feed.xml', name: 'Night Radio' }]),
        });
    });

    it('starts a list that was empty or unreadable, rather than refusing', () => {
        expect(JSON.parse(withSubscription([feeds], {}, show)!.value)).toEqual([{ url: show.feedUrl, name: 'Night Radio' }]);
        expect(JSON.parse(withSubscription([feeds], { feeds: 'not json' }, show)!.value)).toEqual([{ url: show.feedUrl, name: 'Night Radio' }]);
    });

    it('does not add a feed the list already holds', () => {
        const held = JSON.stringify([{ url: show.feedUrl, name: 'My name for it' }]);

        expect(withSubscription([feeds], { feeds: held }, show)).toEqual({ fieldKey: 'feeds', value: held });
    });

    it('answers nothing for a plugin that keeps no list of addresses the console can find', () => {
        expect(withSubscription([{ key: 'apiKey', label: 'Key', type: 'secret' }], {}, show)).toBeUndefined();
    });
});
