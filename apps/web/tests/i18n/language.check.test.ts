import { describe, expect, it } from 'vitest';

import { en } from '../../src/i18n/en/en.catalog';
import { checkLanguagePack, type LanguagePackReading } from '../../src/i18n/language.check';
import { germanPack } from '../utils/language.pack.fixture';

function read(file: unknown): LanguagePackReading {
    const check = checkLanguagePack(file, en);
    if (!check.ok) throw new Error(`refused: ${check.refusal}`);
    return check;
}

describe('checkLanguagePack, the header', () => {
    it.each([
        ['not an object', null, 'not-a-pack'],
        ['another format', { ...germanPack(), format: 'something.else' }, 'not-a-pack'],
        ['a newer format', { ...germanPack(), version: 2 }, 'newer-format'],
        ['a language that is not one', germanPack({ locale: 'not a tag!' }), 'bad-locale'],
        ['English, which is built in', germanPack({ locale: 'en-GB' }), 'english-is-built-in'],
        ['no name', germanPack({ name: '  ' }), 'no-name'],
        ['a direction that is neither', { ...germanPack(), direction: 'up' }, 'bad-direction'],
        ['no catalog', { ...germanPack(), catalog: [] }, 'no-catalog'],
    ])('refuses %s', (_, file, refusal) => {
        expect(checkLanguagePack(file, en)).toEqual({ ok: false, refusal });
    });

    it('takes the language tag in its canonical form', () => {
        expect(read(germanPack({ locale: 'pt-br' })).locale).toBe('pt-BR');
    });
});

describe('checkLanguagePack, the catalog', () => {
    it('installs what fits, and counts a plural once', () => {
        const reading = read(germanPack());
        expect(reading.catalog).toEqual(germanPack().catalog);
        expect(reading.translated).toBe(5);
        expect(reading.faults).toEqual([]);
        expect(reading.unknown).toEqual([]);
    });

    it('lists what the pack has not translated, by the key a translator would add', () => {
        const reading = read(germanPack());
        expect(reading.missing).toContain('common.copy.copy');
        expect(reading.missing).toContain('auth.rateLimited.retryIn_other');
        expect(reading.missing).not.toContain('common.action.cancel');
        expect(reading.total - reading.translated).toBe(reading.missing.length);
    });

    it('drops keys this console has not got', () => {
        const reading = read(germanPack({ catalog: { common: { action: { cancel: 'Abbrechen', gone: 'Weg' } }, nowhere: { x: 'y' } } }));
        expect(reading.unknown).toEqual(['common.action.gone', 'nowhere.x']);
        expect(reading.catalog).toEqual({ common: { action: { cancel: 'Abbrechen' } } });
    });

    it('takes the plural forms the language has, and refuses ones it has not', () => {
        const polish = read(
            germanPack({
                locale: 'pl',
                catalog: {
                    auth: {
                        rateLimited: {
                            retryIn_one: '{{count}} sekunda',
                            retryIn_few: '{{count}} sekundy',
                            retryIn_many: '{{count}} sekund',
                            retryIn_other: '{{count}} sekundy',
                        },
                    },
                },
            }),
        );
        expect(polish.unknown).toEqual([]);

        const german = read(
            germanPack({ catalog: { auth: { rateLimited: { retryIn_few: '{{count}} Sekunden', retryIn_other: '{{count}} Sekunden' } } } }),
        );
        expect(german.unknown).toEqual(['auth.rateLimited.retryIn_few']);
    });

    it('drops a string that fills in something the English does not, or loses something it does', () => {
        const reading = read(
            germanPack({
                catalog: {
                    common: {
                        action: { cancel: 'Abbrechen {{wer}}' },
                        notify: { saved: 'Gespeichert.' },
                        apiStatus: { retryIn_one: 'Gleich noch einmal.', retryIn_other: 'In {{count}} s.' },
                    },
                },
            }),
        );
        expect(reading.faults).toEqual([
            { key: 'common.action.cancel', fault: 'placeholders' },
            { key: 'common.notify.saved', fault: 'placeholders' },
        ]);
        // A singular may spell its count out, as English itself does ("a day").
        expect(reading.catalog).toEqual({ common: { apiStatus: { retryIn_one: 'Gleich noch einmal.', retryIn_other: 'In {{count}} s.' } } });
    });

    it('drops a string whose markup is not the English markup', () => {
        const reading = read(
            germanPack({
                catalog: {
                    auth: { consent: { answerSentTo: 'Ihre Antwort geht an {{host}}.' } },
                    common: { action: { cancel: '<b>Abbrechen</b>' } },
                },
            }),
        );
        expect(reading.faults).toEqual([
            { key: 'auth.consent.answerSentTo', fault: 'markup' },
            { key: 'common.action.cancel', fault: 'markup' },
        ]);
    });

    it('drops a value that is not text', () => {
        const reading = read(germanPack({ catalog: { common: { action: { cancel: 42 } } } } as never));
        expect(reading.faults).toEqual([{ key: 'common.action.cancel', fault: 'not-text' }]);
    });
});
