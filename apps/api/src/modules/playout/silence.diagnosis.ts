import { CONTROL_TTL_S } from './liquidsoap.control.js';
import { RECONCILE_TICK_MS } from './playout.pusher.js';
import type { AirMode } from './air.mode.js';
import type { StreamConfigWarning } from '#modules/stream/stream.staleness.js';

/**
 * Why the station cannot be heard, as one answer.
 *
 * ## The problem, which is not a logging problem
 *
 * Several gates can silence this station and every one of them is honest on its
 * own: the mount is leased and the lease is renewed only while there is a
 * programme AND an audience, the stream has to be reachable, the containers have
 * to be running config the app has not since replaced, and the operator can stand
 * the whole thing down. Each of those is readable somewhere. **Nothing composes
 * them**, so an operator asking "why can't I hear anything" gets a console that
 * has guessed, in three places, from three different expressions.
 *
 * Worse, the guesses cannot tell apart the pair that matters most. In `audience`
 * mode a station with a full running order and nobody connected is silent ON
 * PURPOSE, and a station whose Icecast stopped answering is silent because
 * something broke — and from a listener count of zero the two are identical. The
 * console said `ready` for both.
 *
 * ## What this is
 *
 * An ORDERED chain, and the ordering is the whole value. The checks run in the
 * order the signal chain does, and the first one that blocks is the answer,
 * because a gate upstream of another makes everything downstream of it
 * unreadable rather than merely also-wrong. {@link diagnose} is a pure function
 * over a snapshot for the same reason: every fact it reads lives on a different
 * singleton with a timer behind it, so a version that gathered its own inputs
 * could not be tested at all, and the ordering is exactly the part worth testing.
 *
 * It is deliberately not a health check. Five of the gates below —
 * `stoodDown`, `noProgramme`, `warmingUp`, `waitingOnAudio`, `noAudience` —
 * describe a completely healthy process in a particular state, and a surface that
 * called any of those `degraded` would be a light an operator learns to stop
 * reading. That is the mistake the `ready` badge was added to fix, and repeating
 * it here would undo it.
 */

/** Every gate that can silence the station, plus the answer when none of them is. */
export type SilenceCause =
    | 'airing'
    | 'transportStalled'
    | 'controlDenied'
    | 'streamUnreachable'
    | 'configNotAdopted'
    | 'stoodDown'
    | 'noProgramme'
    | 'noAudience'
    | 'warmingUp'
    | 'waitingOnAudio'
    | 'notDriving'
    | 'starved';

/**
 * How a gate is doing.
 *
 * `waiting` is its own state rather than a mild `fault`, and that distinction is
 * the point of the whole file: a station idling for want of a listener and a
 * station that cannot reach its stream are both silent, and only one of them is
 * something to go and fix.
 */
export type SilenceState = 'ok' | 'waiting' | 'fault';

/** One gate's answer about itself. */
export interface SilenceCheck {
    code: Exclude<SilenceCause, 'airing'>;
    state: SilenceState;
    /** What this gate is doing right now, in a sentence, whether or not it is the one blocking. */
    detail: string;
    /** What would clear it, where there is something an operator can actually do. */
    remedy?: string;
}

/** The station's own answer to "why can't I hear anything". */
export interface StationSilence {
    /**
     * Whether the station believes its programme is reaching the mount.
     *
     * NOT whether anybody is hearing it. The two get conflated every time they are
     * not spelled out: a station can be audible with no listeners (`always` mode)
     * and can have listeners while airing Liquidsoap's local bed (`starved`).
     */
    audible: boolean;
    cause: SilenceCause;
    detail: string;
    remedy?: string;
    /** Every gate, in the order they are judged, so a console can say what it ruled out. */
    checks: SilenceCheck[];
}

/**
 * What one reading of the station consists of.
 *
 * Plain numbers and booleans rather than the objects they were read from, so the
 * resolver below stays a function anybody can call with a literal. Three fields
 * are "how long has this been true", and `undefined` does NOT mean the same thing
 * on all three — each one says which, because the natural reading of each name is
 * different and forcing them into one convention would make two of them lie.
 */
export interface StationFacts {
    /** Now, passed in rather than read, so the ordering can be tested without faking a clock. */
    now: number;
    /**
     * How long the reconcile loop has gone without completing a pass.
     *
     * `undefined` means there is nothing to report: the loop is passing, or nothing
     * registered it. An unregistered loop is a question about this code rather than
     * about the station, which is why it does not read as a fault here.
     */
    reconcileStalledForMs?: number;
    /** The last thing a reconcile pass threw, if it has thrown since it last succeeded. */
    reconcileFailure?: { at: number; message: string };
    streamUp: boolean;
    /**
     * How long the control API has been answering and refusing the app's bridge secret.
     *
     * `undefined` is the ordinary state and covers two different ones deliberately: the secret is
     * accepted, or nothing answered at all. Only the check below it can tell those apart, and it
     * does not need to — a stream that is not there is `streamUnreachable`'s question.
     */
    controlDeniedForMs?: number;
    /** Whether the last reading said deadair is holding the mount. */
    driving: boolean;
    staleConfig: readonly StreamConfigWarning[];
    /** Whether the station has been stood down, from `station_air`. */
    active: boolean;
    hasProgramme: boolean;
    /**
     * How long the director has had a running order it could not commit anything from because the
     * audio is not on this machine yet. `undefined` means that is not what is happening, which
     * covers both an order committing normally and one with nothing left in it.
     *
     * It is what tells those last two apart, and they are indistinguishable from
     * {@link hasProgramme} alone: an order that ran out and an order whose next records are still
     * downloading both leave the transport holding nothing. Read from the commit pass rather than
     * from a clock, so it means "nothing has been committed since", which stays true even when no
     * pass has run lately — the sentences below are worded around that and not around the fetch.
     */
    audioWaitForMs?: number;
    /**
     * How many records in front of the station have their bytes on the way right now.
     *
     * Only meaningful alongside {@link audioWaitForMs}, and it is what splits that one wait into the
     * two states it was always covering: a station downloading its first records is warming up, and
     * the same station with nothing in flight is stuck. Zero and `undefined` mean the same thing
     * here on purpose — a reading nobody supplied is not evidence that anything is coming.
     */
    warmingRecords?: number;
    /**
     * Whether what the player holds is the station's own holding message and nothing else.
     *
     * {@link hasProgramme} is true of anything queued, so a warm-up segment on its way to the mount
     * reads as the show and the chain answers `airing`. This is what tells the two apart, and it
     * only ever narrows: absent means "no idea", which falls back to trusting `hasProgramme`.
     */
    holdingWarmUp?: boolean;
    airMode: AirMode;
    listeners: number;
    /** The gate's own answer, which lingers past the last listener. */
    audience: boolean;
    /**
     * How long the mount has been playing Liquidsoap's local bed instead of the
     * running order. `undefined` means it is not, which is the ordinary state.
     */
    starvedForMs?: number;
}

/**
 * How long the reconcile loop may go quiet before it is presumed stopped.
 *
 * Three passes. One missed tick is a slow Liquidsoap or a long fetch inside the
 * pass, and warning on it would fire during every ordinary download; three is
 * long enough that nothing normal explains it. Taken from the loop's own interval
 * rather than stated as a number, because the whole meaning of the threshold is
 * "did it get several chances".
 */
const STALL_AFTER_MS = 3 * RECONCILE_TICK_MS;

/**
 * How long a gap on the mount has to last before it means anything.
 *
 * One reconcile pass, which is the same yardstick `PlayoutService.noteStarve`
 * judges a recovery against and for the same reason: anything shorter is the
 * queue being topped up, and every first listener produces one of about half a
 * second because the app queues nothing while the gate is shut.
 */
const STARVE_AFTER_MS = RECONCILE_TICK_MS;

/**
 * How long a running order may sit uncommittable for want of its audio before it stops being an
 * ordinary wait.
 *
 * A minute, which is a big file downloading and then some. Stated here rather than borrowed from
 * the director's own `WAITING_ON_AUDIO_MS`, which reports the same wait on the activity feed:
 * importing it would run an edge from playout to director, and this module edge deliberately runs
 * the other way. The two agreeing is worth nothing anyway — one is when to write a row down and
 * this is when to stop calling a wait healthy — so they are free to drift apart on purpose.
 */
const AUDIO_WAIT_AFTER_MS = 60_000;

/**
 * Name the gate that is keeping the station quiet.
 *
 * The first blocking check wins. `configNotAdopted` is the one fault that is
 * reported and never claimed as the cause: a container running replaced config is
 * always worth an operator's attention, but it does not by itself mean nothing is
 * reaching the mount — a station can be airing perfectly well to a listener who
 * connected before the config was replaced. Calling it the reason for a silence
 * that has a different reason is how a real warning stops being believed.
 */
export function diagnose(facts: StationFacts): StationSilence {
    // The gates that stand on their own: each one is true or false about the station
    // without reference to any of the others.
    const independent = [
        transportStalled(facts),
        controlDenied(facts),
        streamUnreachable(facts),
        configNotAdopted(facts),
        stoodDown(facts),
        noProgramme(facts),
        noAudience(facts),
        warmingUp(facts),
        waitingOnAudio(facts),
    ];

    // `notDriving` is the RESIDUE, and does not stand on its own: "the station is not
    // holding the mount" is a fault only when nothing above accounts for it, and is the
    // correct behaviour otherwise. Measured against the running station, which is how
    // this was found: with nobody listening it reported "there is a programme, an
    // audience and a reachable stream" underneath the gate saying there was no audience.
    const explained = independent.some(check => check.state !== 'ok' && check.code !== 'configNotAdopted');
    const checks = [...independent, notDriving(facts, explained ? blockedBy(independent) : undefined), starved(facts)];

    const blocking = checks.find(check => check.state !== 'ok' && check.code !== 'configNotAdopted');
    if (!blocking) {
        return {
            audible: true,
            cause: 'airing',
            detail: 'The station is holding the mount and its programme is going out.',
            checks,
        };
    }

    return {
        audible: false,
        cause: blocking.code,
        detail: blocking.detail,
        ...(blocking.remedy === undefined ? {} : { remedy: blocking.remedy }),
        checks,
    };
}

/**
 * The loop that renews the lease is not passing.
 *
 * First, and that is causal rather than alphabetical: `streamUp` and `driving`
 * are both set by calls this loop makes, so a loop that has stopped leaves them
 * frozen at whatever they last said. Every check below it is reading a stale
 * answer until this one is ruled out.
 */
function transportStalled(facts: StationFacts): SilenceCheck {
    const stalledFor = facts.reconcileStalledForMs;
    if (stalledFor === undefined || stalledFor <= STALL_AFTER_MS) {
        return { code: 'transportStalled', state: 'ok', detail: 'The transport loop is reconciling normally.' };
    }

    const failure = facts.reconcileFailure ? ` The last pass failed: ${facts.reconcileFailure.message}.` : '';
    return {
        code: 'transportStalled',
        state: 'fault',
        detail:
            `The loop that renews the mount lease has not completed a pass for ${seconds(stalledFor)}. ` +
            `The lease expires ${CONTROL_TTL_S}s after the last renewal, so the station is off air, and nothing below this can be trusted: ` +
            `every reading under it is set by calls this loop makes.${failure}`,
        remedy: 'Restart the API.',
    };
}

/**
 * Liquidsoap is answering and refusing the app's bridge secret.
 *
 * ABOVE `streamUnreachable`, and that placement is the whole point of the check. Every call fails
 * either way, so `streamUp` is false for both — and reported as "the control API is not answering"
 * this sends an operator to look at a container that is running perfectly well, while the actual
 * fault is a value in a file. It is also the one silence here that no amount of waiting clears:
 * the two ends of the bridge do not converge on their own, because the container reads `radio.env`
 * once at boot.
 */
function controlDenied(facts: StationFacts): SilenceCheck {
    if (facts.controlDeniedForMs === undefined) {
        return { code: 'controlDenied', state: 'ok', detail: "The stream is accepting the app's bridge secret." };
    }

    return {
        code: 'controlDenied',
        state: 'fault',
        detail:
            `Liquidsoap has been answering and refusing this app's bridge secret for ${seconds(facts.controlDeniedForMs)}. ` +
            'The stream is running; nothing can be handed to it until the two ends of the bridge hold the same secret.',
        remedy: "Restart the liquidsoap container so it adopts the rendered radio.env, and check that its PLAYOUT_BRIDGE_SECRET matches the station's stored setting.",
    };
}

/** Liquidsoap's control API is not answering, so nothing can go to air whatever is queued. */
function streamUnreachable(facts: StationFacts): SilenceCheck {
    if (facts.streamUp) return { code: 'streamUnreachable', state: 'ok', detail: "Liquidsoap's control API is answering." };

    return {
        code: 'streamUnreachable',
        state: 'fault',
        detail: "Liquidsoap's control API is not answering, so nothing can go to air whatever the running order holds.",
        remedy: 'Check that the liquidsoap container is running and reachable at its control address.',
    };
}

/**
 * A container is running config the app has since replaced.
 *
 * Reported, never the cause. See {@link diagnose}. The remedy is the command the
 * warning already carries, because the app cannot restart a sibling container and
 * a button that pretended otherwise would be a lie about what the console can do.
 */
function configNotAdopted(facts: StationFacts): SilenceCheck {
    if (facts.staleConfig.length === 0) {
        return { code: 'configNotAdopted', state: 'ok', detail: 'Both stream containers are running the current config.' };
    }

    const containers = facts.staleConfig.map(warning => warning.container).join(' and ');
    return {
        code: 'configNotAdopted',
        state: 'fault',
        detail:
            `${containers} ${facts.staleConfig.length > 1 ? 'are' : 'is'} running config the app has replaced. ` +
            'That refuses listeners at the door rather than silencing the mount, so it is a fault in its own right and not necessarily why you cannot hear anything.',
        remedy: facts.staleConfig.map(warning => warning.restart).join(' && '),
    };
}

/** Somebody stopped the station. Not a fault, and the console must not draw it as one. */
function stoodDown(facts: StationFacts): SilenceCheck {
    if (facts.active) return { code: 'stoodDown', state: 'ok', detail: 'The station is active.' };

    return {
        code: 'stoodDown',
        state: 'waiting',
        detail: 'The station was stood down, so it is holding nothing and airing nothing.',
        remedy: 'Put a playlist on air.',
    };
}

/**
 * Active, and with nothing to air.
 *
 * A fault rather than a waiting state, because an active station is one somebody
 * told to broadcast: the running order ran out and whatever was supposed to top
 * it up did not.
 *
 * **It yields to {@link waitingOnAudio}**, and that is the whole of the distinction: from
 * `hasProgramme` alone an order that ran out and an order whose next records are still being
 * fetched are the same fact, and this said "the running order ran out and nothing refilled it" for
 * both. That sentence sent an operator to look at refills that were working perfectly, and it went
 * on the activity feed as the reason a full running order was quiet. A replan makes it easy to
 * reach — every record in a fresh tail is one nothing has downloaded yet — but any cold refill got
 * there first.
 */
function noProgramme(facts: StationFacts): SilenceCheck {
    if (facts.hasProgramme) return { code: 'noProgramme', state: 'ok', detail: 'There is a running order to air.' };
    if (facts.audioWaitForMs !== undefined) {
        return {
            code: 'noProgramme',
            state: 'ok',
            detail: 'There is a running order to air; the gate below is about whether its records are here yet.',
        };
    }

    return {
        code: 'noProgramme',
        state: 'fault',
        detail: 'The station is active but has nothing left to air: the running order ran out and nothing refilled it.',
        remedy: 'Extend the running order, or check whether refills are failing.',
    };
}

/**
 * There is a running order, nothing in front of it is here yet, and the bytes are on their way.
 *
 * The first minutes of a station that has just been given something to play: a fresh install, an
 * imported playlist, a replan, or a briefed refill whose records were all discovered at a provider.
 * Every one of them is a full running order with an empty cache, and every one of them is the
 * station working exactly as designed — the commit gate is holding precisely because the download it
 * is waiting on has not finished.
 *
 * **Above {@link waitingOnAudio} rather than inside it**, because the two want different sentences
 * and only one of them wants an operator. That check had to describe both, so it said "which is
 * normally a download away" about a station where nothing was downloading at all, and then escalated
 * to a fault over a wait that was going perfectly well.
 *
 * Never a fault, and it never escalates. This state cannot go on indefinitely: the moment the fetches
 * stop, `warmingRecords` falls to zero and `waitingOnAudio` below takes over, keeping its own clock
 * and its own escalation. So the answer to "what if it warms forever" is that it cannot — a station
 * that stops making progress stops being in this state.
 *
 * **Below {@link noAudience}**, for that check's own reason: with nobody connected the commit pass is
 * not being run on any clock a listener is waiting on, and an empty room is the headline while the
 * room is empty.
 */
function warmingUp(facts: StationFacts): SilenceCheck {
    const waitingFor = facts.audioWaitForMs;
    const warming = facts.warmingRecords ?? 0;
    // A holding message queued does not count as programme here, which is the one place the two
    // have to be told apart: it is exactly what this state is ABOUT, so letting it satisfy
    // `hasProgramme` would have the station stop reporting the wait at the moment it started
    // covering for it.
    const airingTheShow = facts.hasProgramme && facts.holdingWarmUp !== true;
    if (airingTheShow || waitingFor === undefined || warming === 0) {
        return { code: 'warmingUp', state: 'ok', detail: 'The station is not waiting on a download.' };
    }

    return {
        code: 'warmingUp',
        state: 'waiting',
        detail:
            `The station has a running order and is fetching the first ${warming === 1 ? 'record' : `${warming} records`} of it. ` +
            'It goes to air as soon as one of them is here.',
    };
}

/**
 * There is a running order, nothing in front of it is here, and nothing is coming.
 *
 * What is left once {@link warmingUp} above has taken the healthy version of this. A record is not
 * committed until its bytes are local, so that Liquidsoap's resolve is a read from this app rather
 * than a provider download inside the request it is waiting on. The cost of that rule is this state:
 * a running order full of records nobody is fetching commits nothing, and the station is as silent as
 * one with an empty order.
 *
 * `waiting` while it is short, because a fetch that has not started is usually a fetch about to start
 * — the ripener asks for two per pass and the pass runs every few seconds. A fault after
 * {@link AUDIO_WAIT_AFTER_MS}, because by then the explanation is no longer timing: every copy of
 * every record in front of the cursor is refusing, or nothing is asking for them.
 *
 * Both sentences are about what has been COMMITTED rather than about what is downloading, and
 * deliberately: the wait is stamped by the commit pass, so a long one means "nothing has committed
 * since then", which is true whether a fetch is running or nothing has looked lately.
 *
 * **Below {@link noAudience}, which is what keeps that escalation honest.** With nobody connected the
 * transport hands over nothing and the commit pass is not being run on any clock, so the wait can sit
 * there growing while no one has looked at it — an idle station would work itself up to a fault over
 * a running order it will commit the instant a listener arrives. Ranking it under the audience gate
 * says the true thing in both cases: an empty room is the headline while the room is empty, and a
 * wait somebody is actually waiting through is the headline once it is not.
 */
function waitingOnAudio(facts: StationFacts): SilenceCheck {
    const waitingFor = facts.audioWaitForMs;
    if (facts.hasProgramme || waitingFor === undefined) {
        return { code: 'waitingOnAudio', state: 'ok', detail: 'The records in front of the station are on this machine.' };
    }

    if (waitingFor <= AUDIO_WAIT_AFTER_MS) {
        return {
            code: 'waitingOnAudio',
            state: 'waiting',
            detail:
                'The running order is full, and none of the records in front of it is on this machine yet. ' +
                'Nothing has started fetching one, which on a station that is keeping up is a moment away.',
        };
    }

    return {
        code: 'waitingOnAudio',
        state: 'fault',
        detail:
            `The station has had a running order it could not commit anything from for ${seconds(waitingFor)}: ` +
            'nothing in front of it has its audio on this machine.',
        remedy: 'Check the API log for fetch failures, and whether the provider is refusing the records at the head of the order.',
    };
}

/**
 * Nobody is listening, and the count is trustworthy.
 *
 * The resting state of an audience-gated station, which is what the console has
 * been calling `ready`.
 *
 * It used to be reached only after an `audienceUnknown` check had ruled out the reading being a
 * fiction. That check is gone, because the fiction it guarded against cannot happen: a failed poll
 * calls `settle()` without touching the count, so an Icecast that stops answering leaves the last
 * reading standing rather than reading as an empty room. **Only a positive reading — a feed message
 * or a poll that answered — can close this gate.** What the deleted check actually said was that the
 * station "stays silent either way", which was true only when the last answer happened to be zero.
 */
function noAudience(facts: StationFacts): SilenceCheck {
    if (facts.airMode !== 'audience' || facts.audience) {
        return { code: 'noAudience', state: 'ok', detail: facts.listeners === 1 ? '1 listening.' : `${facts.listeners} listening.` };
    }

    return {
        code: 'noAudience',
        state: 'waiting',
        detail: 'The station is loaded and the stream is up. It goes on air the moment somebody starts listening.',
    };
}

/**
 * Everything above passes and the station still is not driving the mount.
 *
 * The residue, and worth its own line precisely because nothing else accounts for
 * it: there is a programme, there is an audience, the stream answers, and the
 * lease is not being held.
 *
 * `explainedBy` is what stops it being a lie the rest of the time. The lease is
 * SUPPOSED to be dropped while a gate above is shut — that is the dead-man switch
 * and the audience gate doing their jobs — so a station with no listeners is not
 * driving on purpose, and reporting that as a fault would put a red mark next to
 * correct behaviour on every idle station.
 */
function notDriving(facts: StationFacts, explainedBy: SilenceCause | undefined): SilenceCheck {
    if (facts.driving) return { code: 'notDriving', state: 'ok', detail: 'deadair is holding the mount.' };

    if (explainedBy !== undefined) {
        return {
            code: 'notDriving',
            state: 'ok',
            detail: 'The mount is not being held, which is correct while something above is keeping the station off air.',
        };
    }

    return {
        code: 'notDriving',
        state: 'fault',
        detail: 'There is a programme, an audience and a reachable stream, and deadair is still not holding the mount.',
        remedy: 'Check the API log for what the last renewal answered.',
    };
}

/** The first gate that is actually blocking, for a check that has to know whether one is. */
function blockedBy(checks: readonly SilenceCheck[]): SilenceCause | undefined {
    return checks.find(check => check.state !== 'ok' && check.code !== 'configNotAdopted')?.code;
}

/**
 * On air, and what is going out is not the running order.
 *
 * Last, because it is the only check that presumes everything above it passed:
 * the station has the mount and the queue stopped producing under it, so
 * Liquidsoap fell through to its local music bed. A listener hears something,
 * which is exactly what makes this the hardest one to notice without being told.
 */
function starved(facts: StationFacts): SilenceCheck {
    if (facts.starvedForMs === undefined || facts.starvedForMs <= STARVE_AFTER_MS) {
        return { code: 'starved', state: 'ok', detail: 'The running order is producing audio.' };
    }

    return {
        code: 'starved',
        state: 'fault',
        detail: `The mount has been airing Liquidsoap's local bed instead of the running order for ${seconds(facts.starvedForMs)}.`,
        remedy: 'Check whether the next items can be fetched: a run of unresolvable records starves the queue.',
    };
}

/** A duration an operator reads rather than one a machine does. */
function seconds(ms: number): string {
    const whole = Math.round(ms / 1000);
    if (whole < 60) return `${whole}s`;

    const minutes = Math.floor(whole / 60);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}
