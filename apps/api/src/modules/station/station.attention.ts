import type { FaultingCopy, FaultingTrack } from '#modules/catalog/tracks.repository.js';
import type { AttentionEvidence, AttentionItem } from './types/station.types.js';

/**
 * What needs somebody, as one ordered list.
 *
 * ## The problem, which is not a dashboard problem
 *
 * Every fact below is already readable. A benched copy is a state on the catalog page, a plugin that
 * will not start says so on its own card, a record the station could not obtain shows as
 * `unavailable` in the running order, and the transport can name the gate keeping the station quiet.
 * The catch is the one v1's console page was rebuilt around: **an operator has to already be on the
 * page to find out that page has something wrong on it.** So a station can sit with four hundred
 * records it cannot fetch, or a speech plugin that failed at boot, and the only surface that would
 * have said so is the one nobody had a reason to open.
 *
 * ## It composes and never re-derives
 *
 * Where the station already has words for a fact, these are those words. The silence diagnosis is ten
 * ordered gates that compose an answer and phrase it; this quotes that answer rather than reaching
 * for the same booleans and writing a second sentence, because two sentences about one fact is two
 * things that can disagree and no reader can tell which one lied. That is the same rule the activity
 * feed holds about its three sources.
 *
 * Pure, over a snapshot, for the reason `silence.diagnosis.ts` is: every fact here lives on a
 * different repository or singleton, and the part worth testing is which of them wins.
 *
 * ## A waiting gate is not attention
 *
 * The diagnosis deliberately tells a station that is idling from one that is broken — an empty room,
 * a station stood down, a record still downloading. None of those is anything to go and do, and a
 * page that listed them would be a page an operator learns to stop reading, which is the exact
 * mistake the `ready` badge was added to undo. Only a `fault` reaches this list.
 *
 * ## What is deliberately not here yet
 *
 * A persona check, a schedule check and a "nothing can speak" check. Each is plausible and none is
 * cheaply precise: a station with no schedule is an ordinary state rather than a fault, a station
 * with no persona has deliberately deleted the four it was seeded with, and whether a station can
 * speak depends on how the speech plugin was chosen. A list that is right about everything on it is
 * worth more than a longer one, because the first wrong entry is what teaches an operator to skim.
 */

/** How bad a thing is, which is a different question from what state a thing is in. */
export type AttentionSeverity = AttentionItem['severity'];

/**
 * The part of the station's own silence answer this quotes.
 *
 * Structural rather than the diagnosis's own `StationSilence`, because what the service can actually
 * hand over is the answer as it goes over the wire — the same facts, parsed by the contract on the
 * way out of `PlayoutService`. Naming only the fields this reads keeps the two from being welded
 * together over an `airing` case that is in one union and not the other.
 */
export interface QuotedSilence {
    audible: boolean;
    cause: string;
    detail: string;
    remedy?: string;
    checks: readonly { code: string; state: 'ok' | 'waiting' | 'fault'; detail: string; remedy?: string }[];
}

/**
 * How many of a fault's records get a sentence of their own.
 *
 * A handful rather than all of them, because this answer is POLLED: a station that has written off
 * four hundred records must not be four hundred sentences on every reading of the desk. The count
 * stays the true figure and the console says how many it is not showing.
 */
export const EVIDENCE_LIMIT = 5;

/** One reading of everything the console would otherwise have to visit five pages to learn. */
export interface AttentionFacts {
    /** The transport's own answer about why the station cannot be heard, quoted rather than re-derived. */
    silence: QuotedSilence;
    /** Records whose every copy has been written off, so they cannot air at all. */
    benched: number;
    /** Records with a fetch failing and backing off. Not benched yet, and usually the state before it. */
    failing: number;
    /**
     * A few of the {@link benched} records, with the copies that put them there.
     *
     * Capped at {@link EVIDENCE_LIMIT} by whoever reads them, and empty is an ordinary answer — for a
     * station with none, and for one whose catalog reader was unhappy. The count above is the figure
     * either way.
     *
     * The catalog's own type rather than a structural one of this file's, which is the opposite of
     * what {@link QuotedSilence} does and for the opposite reason: that one names a wire shape that
     * is not the diagnosis's internal union, and this is exactly what the repository hands over. A
     * second declaration of it would be a second thing to drift.
     */
    benchedExamples: readonly FaultingTrack[];
    /** The same, for {@link failing}. */
    failingExamples: readonly FaultingTrack[];
    /** How many records are in the catalog at all. */
    tracks: number;
    /** Items in the running order the station could not obtain the audio for. */
    unavailableItems: number;
    /**
     * A few of those lines, with whatever the catalog holds about the record behind each.
     *
     * `copies` is empty for a record the catalog never ingested, which the running order can hold: a
     * pick straight from a provider playlist has no `trackId` and no binding row.
     */
    unavailableExamples: readonly DroppedRecord[];
    /** Plugins an operator has enabled that are not running. */
    brokenPlugins: readonly BrokenPlugin[];
    /**
     * The station's track fetcher, where it is running and holds no authorization of its own.
     *
     * `undefined` in every other case, including the ordinary one: a station whose fetcher is
     * authorized, whose records come from somewhere that does not use one, or whose fetcher did not
     * answer, all have nothing to say here.
     */
    unauthorizedFetcher?: UnauthorizedFetcher;
    /**
     * A resolved caller address that looks like a proxy talking to itself, and how often this
     * process has seen one.
     *
     * `undefined` in every ordinary case: a station with no second hop in front of nginx, or one
     * where `REAL_IP_FROM` already tells nginx which address to trust. See `forwarded.reading.ts`
     * for what puts this here and why it is process memory rather than a stored fact.
     */
    singleHop?: { address: string; count: number; lastSeenAt: string };
}

/**
 * A line the station took out of the running order, and what the catalog knows about the record.
 *
 * Its own shape rather than `FaultingTrack` because the two are not the same fact: this is a line of
 * a BROADCAST, which may name a record the catalog never ingested, and the copies hanging off it are
 * what the catalog could add about the ones it did.
 */
export interface DroppedRecord {
    title: string;
    /** The display credit, already joined: the order carries it as a list and the catalog as text. */
    artists: string;
    /** Absent for a pick straight from a provider playlist, which the catalog has never seen. */
    trackId?: string;
    copies: readonly FaultingCopy[];
}

export interface BrokenPlugin {
    id: string;
    name: string;
    /** `misconfigured` is a plugin waiting on a value; `failed` is one that threw on the way up. */
    status: 'misconfigured' | 'failed';
}

/**
 * A track fetcher that is running and has never been authorized.
 *
 * Only that one state, and only when the fetcher actually ANSWERED. A fetcher that is down and one
 * that was never authorized are both "no audio" and only the second is fixed by an authorization, so
 * reporting them as one would be advice that does not work — and the same file that argues a list
 * must be right about everything on it cannot then guess at this.
 */
export interface UnauthorizedFetcher {
    /** The plugin whose records it fetches, so the line can route at the page that fixes it. */
    pluginId: string;
    pluginName: string;
}

/**
 * Everything wrong or waiting, worst first.
 *
 * The order inside a severity is the order they are built, which runs from the station outward: what
 * is on air, then what feeds it, then the library behind that. The sort is stable, so that ordering
 * survives.
 */
export function attention(facts: AttentionFacts): AttentionItem[] {
    const items = [...air(facts), ...supply(facts), ...library(facts)];
    const rank: Record<AttentionSeverity, number> = { failure: 0, warning: 1, notice: 2 };

    return items.sort((left, right) => rank[left.severity] - rank[right.severity]);
}

/** What is stopping the station being heard right now. */
function air(facts: AttentionFacts): AttentionItem[] {
    const items: AttentionItem[] = [];
    const { silence } = facts;

    // A `waiting` gate is the station idling on purpose. Only a fault is something to do.
    const blocking = silence.checks.find(check => check.code === silence.cause);
    if (!silence.audible && blocking?.state === 'fault') {
        items.push({
            code: silence.cause,
            severity: 'failure',
            title: 'The station is silent',
            // The station's own sentence, and its own remedy after it. Nothing here rewords either:
            // the diagnosis is where that wording is decided and this is a place it is shown.
            detail: silence.remedy === undefined ? silence.detail : `${silence.detail} ${silence.remedy}`,
            route: '/onair',
        });
    }

    // Reported and never the cause, exactly as the diagnosis has it: a container running replaced
    // config refuses new listeners at the door while the station airs perfectly well to whoever
    // connected before it. So it is its own line rather than being folded into the silence above,
    // and it is a warning rather than a failure for the same reason.
    const config = silence.checks.find(check => check.code === 'configNotAdopted');
    if (config?.state === 'fault') {
        items.push({
            code: 'configNotAdopted',
            severity: 'warning',
            title: 'A stream container is running replaced config',
            detail: config.remedy === undefined ? config.detail : `${config.detail} Restart it with: ${config.remedy}`,
            route: '/settings',
        });
    }

    // A warning rather than a failure: the station is still reachable, it is just crediting every
    // listener to one bucket (the rate limiter's and the HLS audience register's alike), which is
    // the edge quietly acting as though nobody had ever fixed the first-hop version of this problem.
    if (facts.singleHop) {
        const { address, count } = facts.singleHop;
        items.push({
            code: 'singleHopAddress',
            severity: 'warning',
            title: `Every listener arrives as ${address}`,
            detail:
                `Set REAL_IP_FROM to the proxy's address. ${address} is a private or loopback address, so it is nginx's own ` +
                'hop rather than a caller, and a second proxy in front of it is reporting nginx as though it were every listener at once. ' +
                'TRUST_PROXY must also be on for the station to read the real address once nginx is reporting it.',
            route: '/settings',
            count,
        });
    }

    if (facts.unavailableItems > 0) {
        items.push({
            code: 'unavailableItems',
            // A NOTICE rather than a warning, and it is the honest reading of what this is: the line
            // is already out, the order already closed up around it, and there is nothing to go and
            // do about a record that has been spliced. It also survives for the whole broadcast —
            // `StationLineup.replacePlanned` keeps every terminal state, so a replan does not clear
            // it and only putting the station on air again does — and a warning that cannot be acted
            // on and will not go away for six hours is how a list like this stops being read.
            severity: 'notice',
            title: `${facts.unavailableItems} ${facts.unavailableItems === 1 ? 'record was' : 'records were'} dropped from the running order`,
            detail:
                'The station could not obtain the audio for them before their slot, so they were taken out and the order closed up. ' +
                'A run of these is a provider refusing records rather than a schedule problem.',
            route: '/onair',
            count: facts.unavailableItems,
            evidence: facts.unavailableExamples.map(record => ({
                label: record.artists === '' ? record.title : `${record.title} — ${record.artists}`,
                reason: droppedReason(record),
                ...(record.trackId === undefined ? {} : { route: `/catalog/tracks/${record.trackId}` }),
            })),
        });
    }

    return items;
}

/** What the station is fed by: the plugins an operator switched on. */
function supply(facts: AttentionFacts): AttentionItem[] {
    const items: AttentionItem[] = [];

    // A `failure`, which is what puts it above the benched copies and the failing fetches in the
    // library section. That ordering is the point rather than a nicety: those two are this one's
    // SYMPTOMS, and an operator reading them first goes to the catalog page to look at records that
    // are individually fine. Nothing there could ever have told them what was wrong.
    if (facts.unauthorizedFetcher) {
        const { pluginId, pluginName } = facts.unauthorizedFetcher;
        items.push({
            code: 'fetcherNotAuthorized',
            severity: 'failure',
            title: 'The station is not authorized to fetch audio',
            detail:
                `${pluginName} is connected and can read your library, but the station's track fetcher holds no login of its own, ` +
                'so every record is dropped for want of audio. This is a separate one-time authorization, done on the plugin page.',
            route: `/plugins/${pluginId}`,
        });
    }

    // One line per plugin rather than one carrying a count, because the whole of what an operator
    // needs is WHICH one, and a station runs a handful of them rather than hundreds.
    items.push(
        ...facts.brokenPlugins.map(plugin => ({
            code: `plugin.${plugin.status}`,
            severity: 'warning' as const,
            title: `${plugin.name} is not running`,
            detail:
                plugin.status === 'misconfigured'
                    ? `It is switched on and waiting on its configuration, so anything the station asks of it fails until that is filled in.`
                    : `It is switched on and failed to start, so anything the station asks of it fails until it comes up.`,
            route: `/plugins/${plugin.id}`,
        })),
    );

    return items;
}

/** The library everything else draws on. */
function library(facts: AttentionFacts): AttentionItem[] {
    const items: AttentionItem[] = [];

    if (facts.tracks === 0) {
        // A notice rather than a fault: this is what a station looks like before anybody has
        // connected a provider, and calling the ordinary first hour of an install broken is how a
        // list like this stops being read.
        items.push({
            code: 'emptyCatalog',
            severity: 'notice',
            title: 'The catalog is empty',
            detail: 'Nothing can be programmed until the station has records. A music plugin fills it from the playlists your account holds.',
            route: '/plugins',
        });

        return items;
    }

    if (facts.benched > 0) {
        items.push({
            code: 'benchedCopies',
            severity: 'warning',
            title: `${facts.benched} ${facts.benched === 1 ? 'record has' : 'records have'} no copy left that will play`,
            // Two causes, both named, because the row used to promise only the first and the second
            // is the one an operator gets stuck on: nothing clears a provider's refusal, so waiting
            // for a sync is advice that cannot work. The evidence below says which each record is.
            detail:
                'Their copies have all been written off, so they cannot be chosen at all. The next catalog sync un-benches any the ' +
                'provider still lists — but a copy the provider REFUSED stays off until somebody offers it again on the record’s own page.',
            // The STATE as well as the page. A row about four records that lands on the whole library
            // has told an operator to go and find them, which on a station of eight hundred is the
            // work this list exists to remove. The console owns which of its pages holds the filter.
            route: '/catalog?state=benched',
            count: facts.benched,
            evidence: facts.benchedExamples.map(track => evidenceFor(track, benchedReason(track))),
        });
    }

    if (facts.failing > 0) {
        items.push({
            code: 'failingFetches',
            severity: 'warning',
            title: `${facts.failing} ${facts.failing === 1 ? 'record is' : 'records are'} failing to download`,
            detail: 'Their fetches are backing off and being retried. They still play if one succeeds; four consecutive failures write the copy off.',
            route: '/catalog?state=failing',
            count: facts.failing,
            evidence: facts.failingExamples.map(track => evidenceFor(track, failingReason(track))),
        });
    }

    return items;
}

/** One record, named the way a person names it, pointed at the page holding the whole of it. */
function evidenceFor(track: FaultingTrack, reason: string): AttentionEvidence {
    return {
        label: track.artists === '' ? track.title : `${track.title} — ${track.artists}`,
        reason,
        route: `/catalog/tracks/${track.trackId}`,
    };
}

/**
 * Why one record has no copy left, worst cause first.
 *
 * Two causes wear the same word on the catalog page and they are opposite instructions. A copy with
 * `playable: false` is the PROVIDER's answer and nothing clears it — not the hourly sync, not a
 * re-sighting — so waiting is not a plan and the record needs another source. A benched copy is the
 * station's own guess from repeated failures, and the next sync that still sees it puts it back.
 * Reporting them as one leaves an operator waiting for a sync that will never help, which is exactly
 * what the row's own sentence used to promise.
 */
function benchedReason(track: FaultingTrack): string {
    const refused = track.copies.filter(copy => !copy.playable);
    if (refused.length > 0) {
        const providers = names(refused);
        return `${providers} will never serve ${refused.length === 1 ? 'this copy' : 'these copies'}, so nothing will bring ${refused.length === 1 ? 'it' : 'them'} back. The record needs another source.`;
    }

    const benched = track.copies.filter(copy => copy.benched);
    const worst = deepest(benched);
    const attempts = worst?.attempts ?? 0;
    const failed = attempts === 0 ? 'repeated failures' : `${attempts} failed ${attempts === 1 ? 'fetch' : 'fetches'}`;

    return `Written off after ${failed}. The next sync that still lists the copy puts it back.${detailOf(worst)}`;
}

/**
 * Why one line came out of the running order.
 *
 * The order itself only knows THAT it did: a line carries a title and a state and nothing about the
 * copies underneath it. So the framing is the order's fact and whatever the catalog can add comes
 * after it — and where the catalog can add nothing, which is a record it never ingested, the framing
 * alone is a complete and true sentence rather than one trailing off.
 */
function droppedReason(record: DroppedRecord): string {
    const taken = 'Taken out before its slot: the station could not get hold of its audio.';

    const refused = record.copies.filter(copy => !copy.playable);
    if (refused.length > 0) return `${taken} ${names(refused)} will never serve it, so it needs another source.`;

    const benched = record.copies.filter(copy => copy.benched);
    if (benched.length > 0)
        return `${taken} Every copy is written off; the next sync that still lists one puts it back.${detailOf(deepest(benched))}`;

    return `${taken}${detailOf(deepest(record.copies))}`;
}

/** Why one record's fetch is not landing, off whichever copy has tried hardest. */
function failingReason(track: FaultingTrack): string {
    const worst = deepest(track.copies.filter(copy => copy.playable && !copy.benched));
    const attempts = worst?.attempts ?? 0;
    const counted = attempts === 0 ? 'Backing off' : `${attempts} consecutive ${attempts === 1 ? 'failure' : 'failures'}, backing off`;

    return `${counted}; four in a row writes the copy off.${detailOf(worst)}`;
}

/** The copy that has tried hardest, which is the one with anything to say. */
function deepest(copies: readonly FaultingCopy[]): FaultingCopy | undefined {
    return copies.reduce<FaultingCopy | undefined>(
        (worst, copy) => (worst === undefined || copy.attempts > worst.attempts ? copy : worst),
        undefined,
    );
}

/**
 * What the fetch actually said, where anything said it.
 *
 * The recorded error rather than a paraphrase of it, and it is the whole reason this evidence is
 * worth carrying: "HTTP 404 from the audio url" and "ECONNREFUSED" are two different mornings, and a
 * row that says only "the fetch failed" costs an operator the diagnosis. It is already served at this
 * policy on `TrackBinding.lastError`, which is the same text on the same record.
 */
function detailOf(copy: FaultingCopy | undefined): string {
    return copy?.lastError === undefined ? '' : ` ${copy.lastError}`;
}

/** The providers behind a set of copies, said once each. */
function names(copies: readonly FaultingCopy[]): string {
    const unique = [...new Set(copies.map(copy => copy.pluginId))];
    return unique.length === 1 ? (unique[0] as string) : unique.join(' and ');
}
