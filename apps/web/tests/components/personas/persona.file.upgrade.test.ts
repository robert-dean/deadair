import { describe, expect, it } from 'vitest';

import { PERSONA_FILE_FORMAT, upgradePersonaFile } from '../../../src/components/personas/persona.file.upgrade';

describe('upgradePersonaFile', () => {
    it('turns a first-format file’s string quirks into always-quirks and stamps it with the current format', () => {
        const upgraded = upgradePersonaFile({
            format: 'deadair.persona/1',
            takenAt: '2026-10-01T00:00:00.000Z',
            personas: [{ key: 'ozzysghost', label: "Ozzy's Ghost", style: 'a ghost', quirks: ['Call it the Boneyard'], stories: [] }],
        });

        expect(upgraded.format).toBe(PERSONA_FILE_FORMAT);
        expect(upgraded.personas[0]!.quirks).toEqual([{ text: 'Call it the Boneyard' }]);
    });

    it('leaves a current file exactly as it was', () => {
        const file = {
            format: PERSONA_FILE_FORMAT,
            takenAt: '2026-10-11T00:00:00.000Z',
            personas: [
                { key: 'ozzysghost', label: "Ozzy's Ghost", style: 'a ghost', quirks: [{ text: 'Yell for Sharon', cadence: 'rarely' }], stories: [] },
            ],
        };

        expect(upgradePersonaFile(file)).toBe(file);
    });

    it('passes something that is not a persona file through for the station to refuse', () => {
        expect(upgradePersonaFile('just a string')).toBe('just a string');
        expect(upgradePersonaFile({ format: 'deadair.persona/1', personas: 'not a list' })).toEqual({
            format: 'deadair.persona/1',
            personas: 'not a list',
        });
    });
});
