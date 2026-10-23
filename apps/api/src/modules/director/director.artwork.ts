/**
 * The pictures a commit pass hands the player: each record's cover and each kind of break's
 * picture, both as paths the station serves itself.
 *
 * Out of `DirectorService` because neither lookup reads the running order or anything else the
 * director holds; they ask the art store and, for a cover it has never seen, the job queue. The
 * director calls both from `toPlayerItems` on every pass.
 */
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { ArtRepository } from '#modules/art/art.repository.js';
import { artPath } from '#modules/art/art.path.js';
import type { Segment } from '#modules/render/segment.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { breakPictureKeys, breakPicturesFrom, type BreakPictures } from './break.picture.js';

/**
 * The cover for each record in a batch, as a path the station serves itself, and a request for
 * any it does not hold yet.
 *
 * **A line carries whatever its cover was when the record was PICKED**, which is the provider's
 * own URL for anything the station had not cached by then, and nothing ever revisits it. So a
 * cover fetched an hour after the pick never reaches the record it belongs to: the running
 * order still holds the upstream URL, and the mount carries the station's logo instead of a
 * sleeve for the whole of that record. Resolving here, on every commit pass, is what closes
 * that gap — the answer is read fresh each time from a store that is still filling.
 *
 * **Why the mount cannot simply carry the provider's URL** is in `listenerArtwork`: a player
 * decides whether a URL is a picture by looking at it and never asks for one that ends in an
 * id, and the field is broadcast to every listener, so a cover URL carrying a credential must
 * never reach it. Both halves mean a cover has to be the station's own before it is worth
 * anything here.
 *
 * A URL the store has never seen is asked for, ahead of the sweep's backlog, because the sweep
 * walks the catalog in URL order and has no idea what is on tonight. **A URL it has seen and
 * has no bytes for is NOT asked for**: that row is already in the sweep's queue carrying its
 * own `next_attempt_at`, and asking by name bypasses the backoff, so a cover that 404s would be
 * refetched on every commit pass for as long as it stayed in the running order.
 *
 * Failing to read the store is not a reason to commit nothing, on the rule `DirectorService.withLocalAudio`
 * follows: the batch resolves to nothing, every record carries the logo for now, and the next
 * pass tries again.
 */
export async function stationArtwork(
    container: Container,
    jobs: PgBossJobBroker,
    logger: Logger,
    covers: readonly (string | undefined)[],
): Promise<Map<string, string>> {
    const upstream = [...new Set(covers.filter((url): url is string => url !== undefined && /^https?:\/\//i.test(url)))];
    if (upstream.length === 0) return new Map();

    const held = await inScope(container, async scope => scope.get(ArtRepository).findBySourceUrls(upstream)).catch(error => {
        logger.warn(`director: could not tell which covers the station already holds (${errorText(error)})`);
        return undefined;
    });
    if (held === undefined) return new Map();

    const resolved = new Map<string, string>();
    const unseen: string[] = [];
    for (const url of upstream) {
        const asset = held.get(url);
        if (asset === undefined) unseen.push(url);
        else if (asset.checksum !== undefined) resolved.set(url, artPath(asset));
    }

    if (unseen.length > 0) {
        void jobs.send('catalog.cache_art', { urls: unseen }).catch(error => {
            logger.warn(`director: could not ask for ${unseen.length} cover(s) (${errorText(error)})`);
        });
    }

    return resolved;
}

/**
 * The picture each kind of break in this batch wears, as a path the station serves itself.
 *
 * {@link stationArtwork}'s sibling, and it is a separate lookup rather than a branch inside that
 * one because the two ask different questions of the same table: that one asks "have we cached
 * this provider's URL", this one asks "what does a `weather` break look like here". The key is
 * `deadair:break-art/<kind>`; `art/break.art.ts` carries the argument for why that is a row in
 * `art_assets` and not a table of its own.
 *
 * **Resolved per commit pass, deliberately, and never stamped when the segment is written.** A
 * line carries whatever it was given when it was picked and nothing revisits it, which is the
 * rule the cover half of this learned the hard way; a picture baked in at write time would mean
 * an operator replacing the weather picture changed nothing about the forecast already sitting
 * in the running order.
 *
 * The same read answers the portrait of each break's SPEAKER, which is the picture a break with
 * none for its kind wears; see `break.picture.ts` for why that is the speaker and not the host.
 *
 * Undefined on any failure, which costs a break the host's portrait or the station's logo and
 * nothing else. Nothing here asks for anything to be fetched, unlike {@link stationArtwork}: a
 * break picture has no upstream to go and get, so a kind with no row is simply a kind nobody has
 * given a picture.
 */
export async function breakArtwork(container: Container, logger: Logger, segments: ReadonlyMap<string, Segment>): Promise<BreakPictures | undefined> {
    const keys = breakPictureKeys(segments.values());
    if (keys.length === 0) return undefined;

    const held = await inScope(container, async scope => scope.get(ArtRepository).findBySourceUrls(keys)).catch(error => {
        logger.warn(`director: could not tell which pictures the station holds for a kind of break (${errorText(error)})`);
        return undefined;
    });
    return held === undefined ? undefined : breakPicturesFrom(segments.values(), held);
}
