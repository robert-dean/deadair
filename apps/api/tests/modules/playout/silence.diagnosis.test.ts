// The ordering IS the feature, so most of what is worth testing here is precedence rather
// than any individual gate. Two pairs in particular are the reason the file exists: an
// Icecast that stopped answering must beat an empty room (they are the same listener count
// and only one of them is a fault), and a stalled transport loop must beat everything,
// because every reading below it is set by calls that loop makes.

import { describe, expect, it } from 'vitest';

import { diagnose, type StationFacts } from '../../../src/modules/playout/silence.diagnosis.js';

/** A station airing normally to one listener. Every test starts here and breaks one thing. */
const airing = (over: Partial<StationFacts> = {}): StationFacts => ({
    now: 1_000_000,
    streamUp: true,
    driving: true,
    staleConfig: [],
    active: true,
    hasProgramme: true,
    airMode: 'audience',
    listeners: 1,
    audience: true,
    ...over,
});

const stale = [{ container: 'icecast' as const, detail: 'the secret was reseeded', restart: 'docker compose restart icecast' }];

describe('diagnose', () => {
    it('says a working station is audible, with nothing to report', () => {
        const answer = diagnose(airing());

        expect(answer.audible).toBe(true);
        expect(answer.cause).toBe('airing');
        expect(answer.checks.every(check => check.state === 'ok')).toBe(true);
    });

    it('reports every gate on every reading, whether or not it is the one blocking', () => {
        // The panel says what it ruled out, which is most of what makes it worth opening.
        const answer = diagnose(airing({ streamUp: false }));

        expect(answer.checks).toHaveLength(10);
        expect(answer.checks.filter(check => check.state !== 'ok')).toHaveLength(1);
    });

    describe('each gate names itself', () => {
        const cases: [string, Partial<StationFacts>][] = [
            ['transportStalled', { reconcileStalledForMs: 60_000 }],
            ['controlDenied', { streamUp: false, controlDeniedForMs: 30_000 }],
            ['streamUnreachable', { streamUp: false }],
            ['stoodDown', { active: false }],
            ['noProgramme', { hasProgramme: false }],
            ['noAudience', { audience: false, listeners: 0 }],
            ['waitingOnAudio', { hasProgramme: false, audioWaitForMs: 5_000 }],
            ['notDriving', { driving: false }],
            ['starved', { starvedForMs: 30_000 }],
        ];

        it.each(cases)('%s', (cause, facts) => {
            const answer = diagnose(airing(facts));

            expect(answer.cause).toBe(cause);
            expect(answer.audible).toBe(false);
            expect(answer.detail.length).toBeGreaterThan(0);
        });
    });

    describe('a station idling is not a station broken', () => {
        it('calls waiting for a listener `waiting`, not a fault', () => {
            const answer = diagnose(airing({ audience: false, listeners: 0 }));

            expect(answer.cause).toBe('noAudience');
            expect(answer.checks.find(check => check.code === 'noAudience')?.state).toBe('waiting');
        });

        it('calls a stood-down station `waiting` too', () => {
            expect(diagnose(airing({ active: false })).checks.find(check => check.code === 'stoodDown')?.state).toBe('waiting');
        });

        it('does not ask about the audience at all in `always` mode', () => {
            // Nobody is holding the station on that reading, so an empty mount is the
            // programme going out to nobody rather than a gate that is shut.
            const answer = diagnose(airing({ airMode: 'always', audience: false, listeners: 0 }));

            expect(answer.cause).toBe('airing');
            expect(answer.audible).toBe(true);
        });
    });

    describe('an Icecast that stopped answering', () => {
        // There is no `audienceUnknown` gate any more, and its absence is the assertion. The
        // fiction it guarded against cannot happen: a failed poll leaves the last reading standing
        // rather than reading as an empty room, so only a positive reading can shut this gate. What
        // the check actually said — that the station "stays silent either way" — was true only when
        // the last answer happened to have been zero.
        it('leaves the gate where the last real reading left it', () => {
            const answer = diagnose(airing({ audience: true, listeners: 2 }));

            expect(answer.cause).toBe('airing');
            expect(answer.audible).toBe(true);
        });

        it('still calls an empty room an empty room', () => {
            expect(diagnose(airing({ audience: false, listeners: 0 })).cause).toBe('noAudience');
        });
    });

    describe('a refused bridge secret', () => {
        // The other pair this file exists for. A stream that is not there and a stream that
        // will not take our secret fail every call identically, so `streamUp` is false for
        // both — and only one of them names its own fix.

        it('outranks the stream being unreachable, which is what it looks like from every call', () => {
            const answer = diagnose(airing({ streamUp: false, controlDeniedForMs: 30_000 }));

            expect(answer.cause).toBe('controlDenied');
            expect(answer.checks.find(check => check.code === 'controlDenied')?.state).toBe('fault');
        });

        it('carries what to do about it, because waiting never clears it', () => {
            // The container reads `radio.env` once at boot, so the two ends do not converge
            // on their own however long the app keeps trying.
            const check = diagnose(airing({ streamUp: false, controlDeniedForMs: 30_000 })).checks.find(
                candidate => candidate.code === 'controlDenied',
            );

            expect(check?.remedy?.length).toBeGreaterThan(0);
        });

        it('says nothing when the secret is being accepted', () => {
            expect(diagnose(airing()).checks.find(check => check.code === 'controlDenied')?.state).toBe('ok');
        });

        it('is still below a stalled loop, which sets the reading it stands on', () => {
            expect(diagnose(airing({ reconcileStalledForMs: 60_000, streamUp: false, controlDeniedForMs: 30_000 })).cause).toBe('transportStalled');
        });
    });

    describe('a stalled transport loop', () => {
        it('outranks the readings it is responsible for setting', () => {
            const answer = diagnose(airing({ reconcileStalledForMs: 60_000, streamUp: false, driving: false, hasProgramme: false }));

            expect(answer.cause).toBe('transportStalled');
        });

        it('quotes the failure when the loop threw rather than merely stopped', () => {
            const answer = diagnose(airing({ reconcileStalledForMs: 60_000, reconcileFailure: { at: 999_000, message: 'socket hang up' } }));

            expect(answer.detail).toContain('socket hang up');
        });

        it('tolerates a pass or two being late', () => {
            // A long fetch inside a pass is ordinary, and warning on it would fire during
            // every download the station makes.
            expect(diagnose(airing({ reconcileStalledForMs: 4_000 })).cause).toBe('airing');
        });

        it('reads a loop nothing registered as nothing to report', () => {
            expect(diagnose(airing({ reconcileStalledForMs: undefined })).cause).toBe('airing');
        });
    });

    describe('replaced container config', () => {
        it('is reported as a fault', () => {
            expect(diagnose(airing({ staleConfig: stale })).checks.find(check => check.code === 'configNotAdopted')?.state).toBe('fault');
        });

        it('is never the cause, because a station can air perfectly well while it is true', () => {
            const answer = diagnose(airing({ staleConfig: stale }));

            expect(answer.cause).toBe('airing');
            expect(answer.audible).toBe(true);
        });

        it('does not displace the gate that actually is silencing the station', () => {
            const answer = diagnose(airing({ staleConfig: stale, streamUp: false }));

            expect(answer.cause).toBe('streamUnreachable');
        });

        it('carries the restart command, because the app cannot run it', () => {
            const check = diagnose(airing({ staleConfig: stale })).checks.find(candidate => candidate.code === 'configNotAdopted');

            expect(check?.remedy).toBe('docker compose restart icecast');
        });
    });

    describe('a starved mount', () => {
        it('is ignored below one reconcile pass, which is the queue topping up', () => {
            // Every first listener produces a gap of about half a second, by design: the app
            // queues nothing while the audience gate is shut.
            expect(diagnose(airing({ starvedForMs: 500 })).cause).toBe('airing');
        });

        it('is last, so it never explains a silence something upstream already accounts for', () => {
            expect(diagnose(airing({ starvedForMs: 30_000, hasProgramme: false })).cause).toBe('noProgramme');
        });
    });

    describe('a running order whose records are not here yet', () => {
        // The pair this gate exists for. A station is not committed to a record until its audio is
        // on this machine, so a full running order that nothing has downloaded yet is as silent as
        // an empty one — and until this gate existed the console said "the running order ran out
        // and nothing refilled it" for both, which sent an operator to look at refills that were
        // working. A replan reaches it in one press, since every record in a fresh tail is cold.
        it('says the records are still coming rather than that the order ran out', () => {
            const answer = diagnose(airing({ hasProgramme: false, audioWaitForMs: 5_000 }));

            expect(answer.cause).toBe('waitingOnAudio');
            expect(answer.detail).not.toContain('ran out');
            expect(answer.checks.find(check => check.code === 'noProgramme')?.state).toBe('ok');
        });

        it('calls a short wait `waiting`, because a station downloading its next record is working', () => {
            const answer = diagnose(airing({ hasProgramme: false, audioWaitForMs: 5_000 }));

            expect(answer.checks.find(check => check.code === 'waitingOnAudio')?.state).toBe('waiting');
            expect(answer.checks.find(check => check.code === 'waitingOnAudio')?.remedy).toBeUndefined();
        });

        it('calls a long one a fault, because by then it is not a big file', () => {
            const answer = diagnose(airing({ hasProgramme: false, audioWaitForMs: 300_000 }));

            expect(answer.cause).toBe('waitingOnAudio');
            expect(answer.checks.find(check => check.code === 'waitingOnAudio')?.state).toBe('fault');
            expect(answer.checks.find(check => check.code === 'waitingOnAudio')?.remedy).toBeDefined();
        });

        it('lets an empty room have the headline, so an idle station never works itself up to a fault', () => {
            // With nobody connected the transport hands over nothing and the commit pass is not
            // being run on any clock, so the wait grows while nobody has looked at it. The station
            // will commit the moment a listener arrives, and calling that a fault first would put a
            // red mark next to a station that is fine.
            const answer = diagnose(airing({ hasProgramme: false, audioWaitForMs: 300_000, audience: false, listeners: 0 }));

            expect(answer.cause).toBe('noAudience');
        });

        it('still calls an order that genuinely ran out what it is', () => {
            // The wait is cleared by the commit pass as soon as there is nothing to wait FOR, so
            // an exhausted order arrives here with no wait on it.
            expect(diagnose(airing({ hasProgramme: false })).cause).toBe('noProgramme');
        });

        it('says nothing at all while the station is airing, whatever the next record is doing', () => {
            // The transport holding one record and the one behind it still downloading is an
            // ordinary moment on every station, and not a silence.
            expect(diagnose(airing({ audioWaitForMs: 300_000 })).cause).toBe('airing');
        });

        it('lets a stand-down explain it, since stopping drops the order and the wait with it', () => {
            expect(diagnose(airing({ active: false, hasProgramme: false, audioWaitForMs: 300_000 })).cause).toBe('stoodDown');
        });
    });

    it('puts a stood-down station ahead of the empty running order it implies', () => {
        // Stopping drops the running order, so both are true at once and only one of them
        // is something an operator did on purpose.
        expect(diagnose(airing({ active: false, hasProgramme: false })).cause).toBe('stoodDown');
    });
});

describe('the residue check', () => {
    // `notDriving` is the only gate that does not stand on its own. Dropping the lease is
    // what the dead-man switch and the audience gate are FOR, so a station with nobody
    // listening is not driving on purpose — and reporting that as a fault puts a red mark
    // next to correct behaviour on every idle station. Found on the running station, where
    // it claimed "there is a programme, an audience and a reachable stream" directly under
    // the gate saying there was no audience.

    const idle = (over: Partial<StationFacts> = {}): StationFacts => ({
        now: 1_000_000,
        streamUp: true,
        driving: false,
        staleConfig: [],
        active: true,
        hasProgramme: true,
        airMode: 'audience',
        listeners: 0,
        audience: false,
        ...over,
    });

    it('does not call a dropped lease a fault when a gate above explains it', () => {
        const answer = diagnose(idle());

        expect(answer.cause).toBe('noAudience');
        expect(answer.checks.find(check => check.code === 'notDriving')?.state).toBe('ok');
    });

    it('does not claim there is an audience when there is not', () => {
        const check = diagnose(idle()).checks.find(candidate => candidate.code === 'notDriving');

        expect(check?.detail).not.toContain('an audience');
    });

    it('is still a fault when nothing else accounts for it', () => {
        const answer = diagnose(idle({ listeners: 2, audience: true }));

        expect(answer.cause).toBe('notDriving');
        expect(answer.checks.find(check => check.code === 'notDriving')?.state).toBe('fault');
    });

    it('is not excused by a stale config, which never blocks anything', () => {
        // Otherwise the one fault that is deliberately never a cause would silence the one
        // check that only fires when nothing else explains the silence.
        const answer = diagnose(idle({ listeners: 2, audience: true, staleConfig: stale }));

        expect(answer.cause).toBe('notDriving');
    });
});
