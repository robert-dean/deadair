import type { EnergyThird } from '#modules/analysis/energy.rank.js';

/**
 * What a model choosing records is told about the energy stage a batch airs in.
 *
 * One sentence for both prompts, so the shortlist and the search say the same thing about the same
 * stage. A lean in words, as the genre steer is: prefer the stage's records between ones that suit the
 * request equally, and never refuse the rest, since the station still plays everything else and a model
 * told "only" would empty a refill of a show whose library is thin at one end. What "energy" means is
 * said in plain terms because the model cannot hear the records: measured from their sound, loudness
 * and brightness together.
 *
 * `list` describes the shortlist's marks, which are thirds of that list; `search` describes the search
 * rows' marks, which are thirds of the station's library, since one search's rows are not a pool
 * anybody is choosing between.
 */
export function energySentence(stage: EnergyThird, where: 'list' | 'search'): string {
    const which = stage === 'low' ? 'calmer' : stage === 'medium' ? 'middling' : 'more energetic';
    const marks =
        where === 'list'
            ? 'Lines marked "energy low", "energy medium" or "energy high" say which third of this list a record falls in, measured from how loud and bright it sounds.'
            : 'An owned record in a search answer may carry "energy": low, medium or high against the rest of the station\'s library, measured from how loud and bright it sounds.';
    return (
        `This stretch of the show leans toward its ${which} records. ${marks} ` +
        `Between records that suit the request equally, prefer energy ${stage}, without letting it crowd out the rest of the request.`
    );
}
