import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * What the station will do about records marked with a parental advisory.
 *
 * ## Why this is not one of the rotation rules
 *
 * It sits beside {@link ResolvedRules} and deliberately not inside it. A lineup's mode decides that
 * bag's baseline, and a `setlist` or a `feature` starts from `NO_RULES` — every field off — which is
 * the whole mechanism behind those modes. Put this there and a Christmas setlist would silently
 * start swearing the moment somebody chose it, because turning the rotation rules off is exactly
 * what a setlist is FOR.
 *
 * So this follows `rejectDisliked` instead: read at the point of use, applied whatever the lineup
 * says, not overridable per lineup. A dislike and a content policy are both instructions about what
 * the station MAY play rather than preferences about how often, and neither is a knob a running
 * order gets to turn off.
 *
 * ## The three states
 *
 * Two preferences and one hard rule, each naming both what it wants and what it falls back to. The
 * symmetry is the point: a value that named a permission (`allow`) would say nothing about which
 * copy wins when the catalog holds both, and a bare `explicit` would read as the mirror of
 * `clean-only` — "explicit only" — which is the one thing none of these mean. Nothing here bans a
 * clean record.
 */
export type AdvisoryPolicy =
    /** The artist's version where the catalog holds both, the clean one otherwise. */
    | 'prefer-explicit'
    /** The clean copy where one exists, the explicit one otherwise. */
    | 'prefer-clean'
    /** A copy positively marked `clean`, or the record does not air. */
    | 'clean-only';

/** The `deadair.settings` key, dot-flat like every other and named for the station rather than the module. */
export const ADVISORY_KEY = 'rotation.advisory';

/**
 * What a station does before anybody has said otherwise: nothing.
 *
 * `prefer-explicit` is today's behaviour made explicit rather than a new opinion. It is also the
 * closest thing this type has to "no preference", which is why it is what a caller asking an
 * availability question rather than a programming one passes.
 */
export const ADVISORY_DEFAULT: AdvisoryPolicy = 'prefer-explicit';

const POLICIES: readonly AdvisoryPolicy[] = ['prefer-explicit', 'prefer-clean', 'clean-only'];

/** Whether a stored string is one of the three. Exported because the settings route validates on it. */
export const isAdvisoryPolicy = (value: unknown): value is AdvisoryPolicy => POLICIES.includes(value as AdvisoryPolicy);

/**
 * The station's policy as the operator has it set.
 *
 * A stored value that is not one of the three falls back rather than propagating, which is the same
 * call `stationRules` makes about a non-numeric window and for the same reason: this reaches SQL,
 * and a junk value there would narrow the pool to nothing, which sounds exactly like a station whose
 * library is empty.
 *
 * One `get` with the default behind it rather than a `has` then a `get`, following `DISCOVER_KEY`.
 * `stationRules` needs the pair because it has to tell "stored but not a number" from "never set" to
 * decide which of several fields to fall back on; here both answers are the same answer, so asking
 * twice would buy nothing.
 */
export function advisoryPolicy(config: AppConfig): AdvisoryPolicy {
    const stored = config.get(ADVISORY_KEY, ADVISORY_DEFAULT);
    return isAdvisoryPolicy(stored) ? stored : ADVISORY_DEFAULT;
}

/**
 * Whether a policy demands a positively `clean` copy.
 *
 * The one place the "silence is not consent" rule is spelled, so the two queries that enforce it
 * cannot drift apart. An unknown advisory is NOT clean: most providers never say — Subsonic has no
 * such field at all — so a library from one is entirely unmarked, and a station under `clean-only`
 * there plays nothing. That is the honest answer and it is paid for in the setting's help text
 * rather than by weakening the promise, because the alternative is a station that says it is clean
 * and is not.
 */
export const demandsClean = (policy: AdvisoryPolicy): boolean => policy === 'clean-only';

/**
 * How much this policy wants a binding, lowest first. Only ever a RANK, never a filter.
 *
 * Ordered ahead of the operator's provider preference in {@link CandidatesRepository.bindingsFor},
 * which is the decision most easily got backwards and has no symptom when it is. The policy is a
 * content rule and the provider list is a delivery preference — where the bytes come from — so
 * content wins and delivery breaks the tie. Ranked the other way, a station set to `prefer-clean`
 * whose clean copy happens to sit on the second-choice provider is handed the explicit one from the
 * first, and the console shows a clean station playing explicit records for reasons nothing states.
 *
 * An unknown copy sorts BETWEEN the two under either preference rather than last. It is a copy the
 * station may perfectly well play; it is only one nothing has vouched for, so it should lose to a
 * positive answer in the wanted direction and beat a positive answer in the unwanted one.
 */
export const advisoryRank = (policy: AdvisoryPolicy, advisory: string | null | undefined): number => {
    // Under `clean-only` everything reaching a rank is already `clean`: the query filtered the rest.
    if (policy === 'clean-only') return 0;

    const wanted = policy === 'prefer-clean' ? 'clean' : 'explicit';
    if (advisory === wanted) return 0;
    if (advisory !== 'explicit' && advisory !== 'clean') return 1;
    return 2;
};
