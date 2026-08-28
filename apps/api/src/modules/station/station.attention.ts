import type { AttentionItem } from './types/station.types.js';

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

/** One reading of everything the console would otherwise have to visit five pages to learn. */
export interface AttentionFacts {
    /** The transport's own answer about why the station cannot be heard, quoted rather than re-derived. */
    silence: QuotedSilence;
    /** Records whose every copy has been written off, so they cannot air at all. */
    benched: number;
    /** Records with a fetch failing and backing off. Not benched yet, and usually the state before it. */
    failing: number;
    /** How many records are in the catalog at all. */
    tracks: number;
    /** Items in the running order the station could not obtain the audio for. */
    unavailableItems: number;
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

    if (facts.unavailableItems > 0) {
        items.push({
            code: 'unavailableItems',
            severity: 'warning',
            title: `${facts.unavailableItems} ${facts.unavailableItems === 1 ? 'record was' : 'records were'} dropped from the running order`,
            detail:
                'The station could not obtain the audio for them before their slot, so they were taken out and the order closed up. ' +
                'A run of these is a provider refusing records rather than a schedule problem.',
            route: '/onair',
            count: facts.unavailableItems,
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
            detail:
                'Every copy of them has been written off after four consecutive fetch failures, so they cannot be chosen at all. ' +
                'The next catalog sync un-benches any the provider still lists.',
            route: '/catalog',
            count: facts.benched,
        });
    }

    if (facts.failing > 0) {
        items.push({
            code: 'failingFetches',
            severity: 'warning',
            title: `${facts.failing} ${facts.failing === 1 ? 'record is' : 'records are'} failing to download`,
            detail: 'Their fetches are backing off and being retried. They still play if one succeeds; four consecutive failures write the copy off.',
            route: '/catalog',
            count: facts.failing,
        });
    }

    return items;
}
