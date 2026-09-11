// The case worth testing is not "does a sha come back" but the two ways an image says "nobody
// stamped this". `ENV BUILD_REVISION=${REVISION}` with no build argument given puts an EMPTY
// variable in the environment rather than no variable, so an unstamped build and a development
// tree reach this function differently and must leave it identically.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { buildRevision, buildVersion } from '../../../src/modules/shared/build.revision.js';

/** A config whose layer holds exactly what the process environment would put there. */
const config = (rows: Record<string, unknown>): AppConfig =>
    ({
        get: (key: string, fallback: unknown) => (key in rows ? rows[key] : fallback),
        has: (key: string) => key in rows,
    }) as unknown as AppConfig;

describe('buildRevision', () => {
    it('answers the commit the image was built from', () => {
        expect(buildRevision(config({ BUILD_REVISION: 'a518ad85c82e33e7f535afb067bb6e6f22e9eb11' }))).toBe(
            'a518ad85c82e33e7f535afb067bb6e6f22e9eb11',
        );
    });

    it('answers nothing in a development tree, where the variable is absent', () => {
        expect(buildRevision(config({}))).toBeUndefined();
    });

    it('answers nothing for an image built with no revision, where the variable is present and empty', () => {
        // The Dockerfile defaults `REVISION` to the empty string, so this is the shape every
        // hand-built image has. Passing `''` on would put a falsy-but-present field on the wire
        // and give every reader a second empty case to handle.
        expect(buildRevision(config({ BUILD_REVISION: '' }))).toBeUndefined();
    });

    it('answers nothing for whitespace, which is what a build argument set from an empty shell variable leaves', () => {
        expect(buildRevision(config({ BUILD_REVISION: '   ' }))).toBeUndefined();
    });

    it('takes whatever an operator built with, not only a sha', () => {
        // Nothing here parses the value. A tag or a branch is a legitimate answer to "what was
        // this built from", and a validator would reject one for looking wrong.
        expect(buildRevision(config({ BUILD_REVISION: 'v1.4.0' }))).toBe('v1.4.0');
    });
});

describe('buildVersion', () => {
    it('answers the release the image is', () => {
        expect(buildVersion(config({ BUILD_VERSION: '0.1.0' }))).toBe('0.1.0');
    });

    it('answers nothing on a build that is not a release, which is the ordinary case', () => {
        // Unlike the revision, this is absent for every push to main and not only for a hand-built
        // image: `latest` follows main and CI passes `VERSION` on a release run alone. A station
        // tracking `latest` therefore reports a commit and no version, honestly.
        expect(buildVersion(config({}))).toBeUndefined();
        expect(buildVersion(config({ BUILD_VERSION: '' }))).toBeUndefined();
        expect(buildVersion(config({ BUILD_VERSION: '   ' }))).toBeUndefined();
    });

    it('does not parse what it is given', () => {
        // Same argument as the revision's last case: a release name is whoever tagged it's to
        // choose, and a validator here would reject a legitimate one for looking wrong.
        expect(buildVersion(config({ BUILD_VERSION: '0.2.0-rc.1' }))).toBe('0.2.0-rc.1');
    });

    it('is read independently of the revision, so one can be present without the other', () => {
        expect(buildRevision(config({ BUILD_VERSION: '0.1.0' }))).toBeUndefined();
        expect(buildVersion(config({ BUILD_REVISION: 'abc1234' }))).toBeUndefined();
    });
});
