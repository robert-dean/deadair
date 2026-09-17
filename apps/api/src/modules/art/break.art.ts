import { subdirectoryIsSafe } from '#modules/render/segment.store.js';

/**
 * The scheme a break picture's row is keyed under, and the only place it is spelled.
 *
 * `art_assets.source_url` is documented as the upstream URL a sweeper fetches, and holds a real one
 * for every row the catalog makes. A break picture has no upstream: the station either shipped it or
 * an operator handed it over. What the column is actually being used for in both cases is the same
 * thing — a stable IDENTITY for the image, unique, that a writer can upsert against — and the table
 * says so itself: "`id` is the public handle… `checksum` is the file on disk and may change under a
 * stable id". That is exactly what a replaceable picture needs, so this borrows the column rather
 * than growing a table beside it.
 *
 * **It is never fetched, and cannot be.** The sweeper's queue is `art_assets_pending_idx`, which is
 * partial on `checksum is null`, and a break row is only ever written WITH its bytes, so it is never
 * in that queue. Belt and braces, `ArtCacheService.download` refuses any protocol that is not
 * `http`/`https`, so a row that somehow reached it fails closed rather than fetching something
 * strange. `break.artwork.service.test.ts` pins both halves.
 */
export const BREAK_ART_SOURCE = 'deadair:break-art';

/**
 * The key one kind of break's picture is stored under.
 *
 * `segments.kind` is free text — `weather`, `news`, whatever an operator wrote on a format-clock
 * band — so the key is too, and a kind nobody has a picture for simply has no row.
 */
export const breakArtKey = (kind: string): string => `${BREAK_ART_SOURCE}/${kind.trim()}`;

/** Whether a key belongs to a break picture rather than to a cached cover. */
export const isBreakArtKey = (sourceUrl: string): boolean => sourceUrl.startsWith(`${BREAK_ART_SOURCE}/`);

/**
 * Whether a string may be used as a kind here.
 *
 * `Segment.kind` is not an enum and is operator-controlled from two directions — a multipart field
 * on an upload, and a directory name the segment scan reads — and here it reaches a filesystem read
 * (`<shipped>/<kind>.png`) and, on the write side, a route param. `join(root, \`${kind}.png\`)` with
 * `../../etc/x` in it reads wherever it likes.
 *
 * {@link subdirectoryIsSafe} is the rule, reused rather than restated for the reason its own note
 * gives: a second copy of a path rule is a second thing that can be relaxed by accident. It rejects
 * empty, over-long, a leading dot (so `..` and `../x`), and anything holding a separator or a NUL,
 * which is what a single path component needs. A LIMIT rather than a normalisation, the same way:
 * a kind this refuses is a kind with no picture, not a kind quietly renamed to something else.
 *
 * It lives in `render/segment.store.ts` because the two audio libraries needed it first, so this
 * imports upwards from a module registered later. That is only a direction worth minding for DI and
 * for anything that reads state; this is a pure predicate with no container, no config and no cycle.
 * The third caller is the argument for lifting it to `modules/shared/`, which is a rename across
 * `pad.library.ts`, `segment.library.ts` and `render.service.ts` and belongs in its own commit.
 */
export const breakKindIsSafe = (kind: string): boolean => subdirectoryIsSafe(kind);
