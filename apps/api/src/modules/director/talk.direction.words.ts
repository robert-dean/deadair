/**
 * What a presenter is told about the operator's talk direction, in one place for every prompt that
 * carries it: the break prompt (`break.prompt.ts`) and a banter's beats (`production.prompt.ts`).
 *
 * One sentence shared rather than two written, on the rule those two files already keep for the
 * station's other policies: two prompts stating the same thing in different words is how they drift.
 *
 * A LEAN, and the wording says so in each of its three clauses. It is offered rather than asked for,
 * on the played list's measured argument that a model handed material gets through it. It is a
 * direction to the presenter rather than something that happened, so nothing may be built on it as
 * fact or added to it. And it is never read out: the guards refuse a script that copies a run of it
 * (`readOutDirectionIn`), while saying what it is about in the presenter's own words is the point.
 */
export function directionNote(direction: string): string {
    return (
        `A note from the station for tonight, for you rather than for the listener: "${direction}"\n` +
        'Let it lean what you talk about and how, where this gives you room. You do not have to mention it. ' +
        'It is a direction, not news and not evidence: do not state it as a fact, do not add anything it does not say, ' +
        'and do not read it out or quote it. If you touch on it, say it in your own words, as yourself.'
    );
}
