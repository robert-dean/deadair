import { Injectable } from 'injectkit';

/**
 * The requests being put into the running order right now, by id.
 *
 * `RequestDesk.place` posts the record to the director BEFORE it moves the row to `queued`, because a
 * row marked queued for a record that never went in is the worse failure. So two placements of one
 * request that overlap both post it, and the record goes into the order twice. More than one thing
 * places a request (a submit, a grant, the tick, and the edges that offer waiting requests again), so
 * they have to take turns per request, and the desk is scoped, which is why the turn is held here.
 *
 * In memory, which is enough: the director is the one writer of the order and lives in this process.
 */
@Injectable()
export class RequestPlacements {
    private readonly placing = new Set<string>();

    /** Run `place` unless this request is already being placed, and answer nothing without running it if it is. */
    async exclusively<T>(requestId: string, place: () => Promise<T>): Promise<T | undefined> {
        if (this.placing.has(requestId)) return undefined;
        this.placing.add(requestId);
        try {
            return await place();
        } finally {
            this.placing.delete(requestId);
        }
    }
}
