// The policy is three words and a rank, and every one of them decides what the station plays. The
// two things worth testing are the ones with no symptom when they are wrong: that a junk stored
// value falls back rather than narrowing the pool to nothing, and that an UNKNOWN copy is never
// treated as clean.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    ADVISORY_DEFAULT,
    ADVISORY_KEY,
    advisoryPolicy,
    advisoryRank,
    demandsClean,
    isAdvisoryPolicy,
    type AdvisoryPolicy,
} from '../../../src/modules/director/advisory.policy.js';

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({
        get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    }) as unknown as AppConfig;

describe('advisoryPolicy', () => {
    it('leaves an unconfigured station exactly as it was', () => {
        expect(advisoryPolicy(config())).toBe('prefer-explicit');
        expect(ADVISORY_DEFAULT).toBe('prefer-explicit');
    });

    it('takes each of the three at its word', () => {
        for (const policy of ['prefer-explicit', 'prefer-clean', 'clean-only'] as const) {
            expect(advisoryPolicy(config({ [ADVISORY_KEY]: policy }))).toBe(policy);
        }
    });

    it('falls back rather than propagating a value it does not recognise', () => {
        // This reaches SQL. A junk value carried through would narrow the pool to nothing, which
        // sounds exactly like a library that is empty — the same failure `stationRules` guards a
        // non-numeric window against.
        expect(advisoryPolicy(config({ [ADVISORY_KEY]: 'clean' }))).toBe(ADVISORY_DEFAULT);
        expect(advisoryPolicy(config({ [ADVISORY_KEY]: '' }))).toBe(ADVISORY_DEFAULT);
        expect(advisoryPolicy(config({ [ADVISORY_KEY]: 'Clean-Only' }))).toBe(ADVISORY_DEFAULT);
        expect(advisoryPolicy(config({ [ADVISORY_KEY]: 7 }))).toBe(ADVISORY_DEFAULT);
    });
});

describe('isAdvisoryPolicy', () => {
    it('accepts the three and nothing else', () => {
        expect(isAdvisoryPolicy('prefer-clean')).toBe(true);
        expect(isAdvisoryPolicy('allow')).toBe(false);
        expect(isAdvisoryPolicy(undefined)).toBe(false);
    });
});

describe('demandsClean', () => {
    it('is true only for the hard rule', () => {
        expect(demandsClean('clean-only')).toBe(true);
        expect(demandsClean('prefer-clean')).toBe(false);
        expect(demandsClean('prefer-explicit')).toBe(false);
    });
});

describe('advisoryRank', () => {
    it('puts the wanted copy first under each preference', () => {
        expect(advisoryRank('prefer-clean', 'clean')).toBeLessThan(advisoryRank('prefer-clean', 'explicit'));
        expect(advisoryRank('prefer-explicit', 'explicit')).toBeLessThan(advisoryRank('prefer-explicit', 'clean'));
    });

    it('sorts an unmarked copy between the two, never as the wanted one', () => {
        // Unknown is a copy the station may perfectly well play and one nothing has vouched for, so
        // it should lose to a positive answer in the wanted direction and beat one in the other.
        for (const policy of ['prefer-clean', 'prefer-explicit'] as const) {
            const wanted = policy === 'prefer-clean' ? 'clean' : 'explicit';
            const unwanted = policy === 'prefer-clean' ? 'explicit' : 'clean';

            expect(advisoryRank(policy, wanted)).toBeLessThan(advisoryRank(policy, null));
            expect(advisoryRank(policy, null)).toBeLessThan(advisoryRank(policy, unwanted));
        }
    });

    it('treats null, undefined and a value nobody wrote as equally unknown', () => {
        for (const unknown of [null, undefined, 'PARENTAL ADVISORY']) {
            expect(advisoryRank('prefer-clean', unknown)).toBe(advisoryRank('prefer-clean', null));
        }
    });

    it('has nothing to say under clean-only, where the query already filtered', () => {
        // Everything reaching a rank there is `clean`, so a rank that pretended to choose between
        // copies would be describing rows that cannot exist.
        expect(advisoryRank('clean-only', 'clean')).toBe(0);
    });

    it('never reverses on a policy it was not given', () => {
        const policies: AdvisoryPolicy[] = ['prefer-explicit', 'prefer-clean', 'clean-only'];
        for (const policy of policies) expect(advisoryRank(policy, 'clean')).toBeGreaterThanOrEqual(0);
    });
});
