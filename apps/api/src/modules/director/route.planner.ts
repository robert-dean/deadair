import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import type { Neighbour } from '#modules/similarity/similarity.service.js';
import type { CoCredit, OwnedArtist } from './route.repository.js';

/**
 * A route from one artist to another through artists the library holds.
 *
 * ## What it is for
 *
 * "Start at Portishead and end up at Daft Punk" is a programme a presenter can carry, if every step on
 * the way has a reason. A route is a shortest path over two kinds of link between artists: a FACT (two
 * of them credited together on a record the library holds, `RouteRepository.coCredits`) and an OPINION
 * (one similarity source naming the other, `SimilarityService.similarTo`). Each hop keeps the link it
 * took, so a break between two stops can say how they connect.
 *
 * ## The costs, and that they are unfitted
 *
 * Every hop costs `HOP_BASE + HOP_SPREAD × (1 − strength) + HOP_PENALTY`. A shared credit is strength
 * `1`; a similarity link is the source's `match` where it gives one, and otherwise its rank in that
 * answer. The fixed penalty per hop is what stops the search preferring a long chain of tiny gains over
 * a short, plausible one. These are starting weights that read sensibly on a few hand-tried routes and
 * have been measured against nothing; the place to fit them is here.
 *
 * ## Bounded
 *
 * Every artist expanded is a similarity question (up to one call per source, cached for a day) and a
 * credit query, so the search stops after {@link MAX_EXPANSIONS} expansions and answers `undefined`
 * rather than wandering the whole graph. Only artists the library can air are ever on the frontier.
 */

/** A shared credit: two artists on one record the library holds. */
export interface CreditLink {
    kind: 'credit';
    /** The record they share, and its lead, for a presenter to name. */
    title: string;
    lead: string;
}

/** A similarity source naming one artist as like the other. */
export interface SimilarLink {
    kind: 'similar';
    /** The plugin id whose answer it was. */
    source: string;
    /** The source's own score, when it gave one. Only comparable inside that source's answer. */
    match?: number;
}

export type RouteLink = CreditLink | SimilarLink;

/** One stop on a route. Every stop but the first carries the link that led to it. */
export interface RouteStop extends OwnedArtist {
    link?: RouteLink;
}

/** What the planner asks of the world, so it can be tested without a database or a plugin. */
export interface RoutePorts {
    owned(artistKeys: readonly string[]): Promise<Map<string, OwnedArtist>>;
    coCredits(artistKey: string): Promise<CoCredit[]>;
    neighbours(name: string, limit: number): Promise<Neighbour[]>;
}

/** How many artists a search may expand before it gives up. */
export const MAX_EXPANSIONS = 30;

/** How many similar artists to ask about for each one expanded. */
export const NEIGHBOURS_PER_ARTIST = 20;

/** The longest route worth airing, in stops. A route longer than this is a wander, not a journey. */
export const MAX_STOPS = 16;

const HOP_BASE = 0.68;
const HOP_SPREAD = 1.18;
const HOP_PENALTY = 0.17;

/** What one hop costs, from how strong its link is (`0` to `1`). */
export const hopCost = (strength: number): number => HOP_BASE + HOP_SPREAD * (1 - Math.min(1, Math.max(0, strength))) + HOP_PENALTY;

/** How strong a similarity link is: the source's score where it gave one, else its rank in the answer. */
export const similarStrength = (neighbour: Pick<Neighbour, 'match'>, rank: number, of: number): number =>
    neighbour.match !== undefined && Number.isFinite(neighbour.match) ? neighbour.match : of <= 0 ? 0 : 1 - rank / of;

interface Edge {
    to: OwnedArtist;
    link: RouteLink;
    cost: number;
}

/**
 * The cheapest route from `from` to `to`, or `undefined` when either end is not an artist the library
 * can air, or no route turns up inside the search's bounds.
 */
export async function planRoute(from: string, to: string, ports: RoutePorts): Promise<RouteStop[] | undefined> {
    const fromKey = normalizeKey(from);
    const toKey = normalizeKey(to);
    if (fromKey.length === 0 || toKey.length === 0) return undefined;

    const ends = await ports.owned([fromKey, toKey]);
    const start = ends.get(fromKey);
    const goal = ends.get(toKey);
    if (start === undefined || goal === undefined) return undefined;
    if (fromKey === toKey) return [start];

    const best = new Map<string, number>([[fromKey, 0]]);
    const came = new Map<string, { from: string; link: RouteLink }>();
    const known = new Map<string, OwnedArtist>([[fromKey, start]]);
    const stops = new Map<string, number>([[fromKey, 1]]);
    const done = new Set<string>();
    let expansions = 0;

    while (expansions < MAX_EXPANSIONS) {
        // The frontier is small (at most a few hundred artists), so a scan for the cheapest beats a heap.
        let current: string | undefined;
        for (const [key, cost] of best) {
            if (done.has(key)) continue;
            if (current === undefined || cost < best.get(current)!) current = key;
        }
        if (current === undefined) return undefined;
        if (current === toKey) return walkBack(toKey, came, known);

        done.add(current);
        if (stops.get(current)! >= MAX_STOPS) continue;
        expansions += 1;

        for (const edge of await edgesFrom(known.get(current)!, ports)) {
            const key = edge.to.artistKey;
            if (done.has(key)) continue;
            const cost = best.get(current)! + edge.cost;
            if (cost >= (best.get(key) ?? Number.POSITIVE_INFINITY)) continue;

            best.set(key, cost);
            came.set(key, { from: current, link: edge.link });
            known.set(key, edge.to);
            stops.set(key, stops.get(current)! + 1);
        }
    }
    return undefined;
}

/** Every link out of one artist to another the library can air, the strongest kept where two disagree. */
async function edgesFrom(artist: OwnedArtist, ports: RoutePorts): Promise<Edge[]> {
    const [credits, neighbours] = await Promise.all([
        ports.coCredits(artist.artistKey).catch(() => [] as CoCredit[]),
        ports.neighbours(artist.name, NEIGHBOURS_PER_ARTIST).catch(() => [] as Neighbour[]),
    ]);

    const similarKeys = neighbours.map(neighbour => normalizeKey(neighbour.name));
    const owned = await ports.owned(similarKeys);

    const edges = new Map<string, Edge>();
    const offer = (edge: Edge) => {
        const held = edges.get(edge.to.artistKey);
        if (held === undefined || edge.cost < held.cost) edges.set(edge.to.artistKey, edge);
    };

    // A credit is only a stop when the partner has a record of their own to air.
    const creditOwned = await ports.owned(credits.map(credit => credit.artistKey));
    for (const credit of credits) {
        const to = creditOwned.get(credit.artistKey);
        if (to === undefined || to.artistKey === artist.artistKey) continue;
        offer({ to, link: { kind: 'credit', title: credit.title, lead: credit.lead }, cost: hopCost(1) });
    }

    neighbours.forEach((neighbour, rank) => {
        const to = owned.get(similarKeys[rank]!);
        if (to === undefined || to.artistKey === artist.artistKey) return;
        const strength = similarStrength(neighbour, rank, neighbours.length);
        offer({
            to,
            link: { kind: 'similar', source: neighbour.source, ...(neighbour.match === undefined ? {} : { match: neighbour.match }) },
            cost: hopCost(strength),
        });
    });

    return [...edges.values()];
}

function walkBack(goal: string, came: ReadonlyMap<string, { from: string; link: RouteLink }>, known: ReadonlyMap<string, OwnedArtist>): RouteStop[] {
    const route: RouteStop[] = [];
    let key: string | undefined = goal;
    while (key !== undefined) {
        const step = came.get(key);
        route.unshift({ ...known.get(key)!, ...(step === undefined ? {} : { link: step.link }) });
        key = step?.from;
    }
    return route;
}
