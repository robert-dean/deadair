import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { SubsonicAuth } from '../src/navidrome.auth.js';

const auth = () => new SubsonicAuth('station', 'hunter2');

describe('SubsonicAuth', () => {
    it('hashes the password with the salt it reports, and never sends the password', () => {
        const params = auth().params();

        expect(params.t).toBe(createHash('md5').update(`hunter2${params.s}`).digest('hex'));
        expect(JSON.stringify(params)).not.toContain('hunter2');
    });

    it('carries the protocol fields every Subsonic request needs', () => {
        expect(auth().params()).toMatchObject({ u: 'station', v: '1.16.1', c: 'deadair', f: 'json' });
    });

    it('salts each ordinary call differently', () => {
        const subject = auth();
        expect(subject.params().s).not.toBe(subject.params().s);
    });

    it('reuses one salt for URLs that get stored, so the same image is the same string', () => {
        // `art_assets` rows are keyed by their source URL. A fresh salt per mention
        // would make every mention of one cover a new row and a new download of
        // identical bytes, and a cache that could never hit.
        const subject = auth();
        expect(subject.stableParams()).toEqual(subject.stableParams());
    });

    it('gives two plugin instances different stable salts', () => {
        // Fixed for the life of an instance, not global: a reinitialize (which is
        // what a config change does) is allowed to move it.
        expect(auth().stableParams().s).not.toBe(auth().stableParams().s);
    });
});
