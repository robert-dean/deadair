import { describe, expect, it } from 'vitest';

import { FacePainter } from '../../src/actions/key.face.js';
import { fakeKey } from '../fixtures/fake.key.js';

describe('FacePainter', () => {
    it('sends a key what changed and nothing else', () => {
        const key = fakeKey('one');
        const painter = new FacePainter();
        painter.add(key);
        painter.paintAll({ title: 'Heroes', image: 'a', state: 0 });
        painter.paintAll({ title: 'Heroes', image: 'a', state: 0 });
        painter.paintAll({ title: 'Heroes', image: 'b', state: 0 });
        expect(key.calls).toEqual(['state 0', 'image a', 'title Heroes', 'image b']);
    });

    it('sends a key that appears everything, whatever the others were last sent', () => {
        const first = fakeKey('one');
        const second = fakeKey('two');
        const painter = new FacePainter();
        painter.add(first);
        painter.paintAll({ title: 'Heroes', image: 'a' });
        painter.add(second);
        painter.paintAll({ title: 'Heroes', image: 'a' });
        expect(first.calls).toEqual(['image a', 'title Heroes']);
        expect(second.calls).toEqual(['image a', 'title Heroes']);
    });

    it('leaves a field the frame does not name as it is', () => {
        const key = fakeKey('one');
        const painter = new FacePainter();
        painter.add(key);
        painter.paintAll({ title: 'Confirm' });
        expect(key.calls).toEqual(['title Confirm']);
    });

    it('swallows a send the app refuses, which is a key already gone', async () => {
        const key = fakeKey('one');
        key.setTitle = () => Promise.reject(new Error('closed'));
        const painter = new FacePainter();
        painter.add(key);
        expect(() => painter.paintAll({ title: 'Heroes' })).not.toThrow();
        await Promise.resolve();
    });
});
