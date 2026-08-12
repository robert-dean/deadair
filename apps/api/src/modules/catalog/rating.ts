import { Rating } from './types/catalog.types.js';

/**
 * The two spellings of an opinion, and the one place they meet.
 *
 * The wire says `liked` / `neutral` / `disliked`, because a console and an SDK read words. The
 * column says `1` / `0` / `-1`, and that is not an accident of history: the ORDERING is what
 * `CandidatesRepository.ratingsFor` resolves an effective rating with (`least(track, album,
 * artist)`, so a dislike anywhere wins) and what `weightOf` in `rotation.rules.ts` reads to give a
 * liked record twice the draw weight. Neither of those goes anywhere near an HTTP contract, so the
 * enum is a boundary spelling rather than a change of model, and it is mapped here so nothing else
 * has to know both.
 */

/** How the column spells each opinion. */
const COLUMN: Record<Rating, number> = { liked: 1, neutral: 0, disliked: -1 };

/** What the operator said, as the column stores it. */
export const ratingToColumn = (rating: Rating): number => COLUMN[rating];

/**
 * What the column holds, as the wire spells it.
 *
 * Anything outside the three the check constraint allows reads as `neutral`. It cannot happen
 * through this app — the constraint is on the table — and a row hand-edited into a fourth state is
 * better answered as "no opinion" than by refusing to draw the catalog at all.
 */
export const ratingFromColumn = (rating: number): Rating => (rating > 0 ? 'liked' : rating < 0 ? 'disliked' : 'neutral');

/**
 * A row on its way out of a repository, with its opinion in the spelling the contract validates.
 *
 * Every catalog read goes through this, not only the rating routes: the column is the only place
 * the number survives, so a list that skipped this would fail its own `parseAndValidate`.
 *
 * Deliberately not constrained to `{ rating: number }`. Some of these rows are selected alongside
 * raw SQL, which gives Kysely's row type an index signature, and `Omit` over one of those collapses
 * every named property into it — so the constraint would reject exactly the rows that need this.
 * Nothing is lost: the caller hands the result straight to `parseAndValidate`, which takes `unknown`
 * and is what actually decides the shape is right.
 */
export const withRating = <T extends object>(row: T): Omit<T, 'rating'> & { rating: Rating } => ({
    ...row,
    rating: ratingFromColumn(ratingColumn(row)),
});

const ratingColumn = (row: object): number => {
    const value = (row as { rating?: unknown }).rating;
    return typeof value === 'number' ? value : 0;
};
