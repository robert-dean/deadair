// A break that hit a pad carries the hit inside its words, and the console draws it as the token the
// pads page shows. The split is what decides where, so it is tested on its own.

import { describe, expect, it } from 'vitest';

import { scriptParts } from '../../../src/components/pads/pad.script';

describe('scriptParts', () => {
    it('leaves a script with no hit as one run of words', () => {
        expect(scriptParts('That was Green Onions.')).toEqual([{ kind: 'text', text: 'That was Green Onions.' }]);
    });

    it('splits the words around a hit, where it lands', () => {
        expect(scriptParts('That was Green Onions. [sfx:airhorn] Up next, Bill Withers.')).toEqual([
            { kind: 'text', text: 'That was Green Onions. ' },
            { kind: 'pad', name: 'airhorn' },
            { kind: 'text', text: ' Up next, Bill Withers.' },
        ]);
    });

    it('draws a script that ends on its hit without an empty run after it', () => {
        expect(scriptParts('Ahoy. [sfx:cannon-2]')).toEqual([
            { kind: 'text', text: 'Ahoy. ' },
            { kind: 'pad', name: 'cannon-2' },
        ]);
    });

    it('lower-cases the name, as the station resolves it', () => {
        expect(scriptParts('[sfx:AirHorn]')).toEqual([{ kind: 'pad', name: 'airhorn' }]);
    });

    it('leaves any other bracket as words', () => {
        expect(scriptParts('[laugh] Well then.')).toEqual([{ kind: 'text', text: '[laugh] Well then.' }]);
    });
});
