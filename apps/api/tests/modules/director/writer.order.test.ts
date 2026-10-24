// Which of a kind's writers is asked first. The registration order puts the model in front, and the
// operator's setting may put the station's own words there instead without either side losing its
// own order.

import { describe, expect, it } from 'vitest';

import { DEFAULT_WRITER_ORDER, inWriterOrder, resolveWriterOrder, WRITER_ORDER_KEY } from '../../../src/modules/director/writer.order.js';
import { MODEL_WRITER } from '../../../src/modules/director/model.talk.break.writer.js';
import { findDescriptor } from '../../../src/modules/settings/settings.registry.js';
import { settingsConfig } from '../../utils/settings.config.js';

const named = (...names: string[]) => names.map(name => ({ name }));

describe('resolveWriterOrder', () => {
    it('answers the model first when nothing was set', () => {
        expect(resolveWriterOrder(settingsConfig().config)).toBe('model');
    });

    it('reads the station order when the operator chose it', () => {
        expect(resolveWriterOrder(settingsConfig({ [WRITER_ORDER_KEY]: 'station' }).config)).toBe('station');
        expect(resolveWriterOrder(settingsConfig({ [WRITER_ORDER_KEY]: ' station ' }).config)).toBe('station');
    });

    it('takes the default for a value nobody can parse, rather than guessing', () => {
        expect(resolveWriterOrder(settingsConfig({ [WRITER_ORDER_KEY]: 'phrasings' }).config)).toBe('model');
        expect(resolveWriterOrder(settingsConfig({ [WRITER_ORDER_KEY]: '' }).config)).toBe('model');
    });

    it('shares its default with the setting the console draws', () => {
        const field = findDescriptor(WRITER_ORDER_KEY);
        expect(field?.default).toBe(DEFAULT_WRITER_ORDER);
    });
});

describe('inWriterOrder', () => {
    it('leaves the registration order alone for the model first', () => {
        expect(inWriterOrder(named(MODEL_WRITER, 'templates'), 'model').map(writer => writer.name)).toEqual([MODEL_WRITER, 'templates']);
    });

    it('moves the model behind the station’s own words', () => {
        expect(inWriterOrder(named(MODEL_WRITER, 'templates'), 'station').map(writer => writer.name)).toEqual(['templates', MODEL_WRITER]);
    });

    it('keeps each side in its own order', () => {
        const writers = named(MODEL_WRITER, 'news', 'headlines');
        expect(inWriterOrder(writers, 'station').map(writer => writer.name)).toEqual(['news', 'headlines', MODEL_WRITER]);
    });

    it('changes nothing for a kind with no model in front of it', () => {
        expect(inWriterOrder(named('jingle'), 'station').map(writer => writer.name)).toEqual(['jingle']);
    });
});
