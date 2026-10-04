import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import type { VocalMarkersDetail, VocalMarkersInput } from '#modules/catalog/types/catalog.types.js';
import { LyricsRepository } from './lyrics.repository.js';
import { VocalMarkersReader, type SourcedVocalMarkers } from './vocal.markers.reader.js';

/**
 * The operator's side of a record's vocal markers: read them, correct them, or drop the correction.
 *
 * What it answers is markers and where they came from, never a word of the lyric they were derived
 * from: the text never leaves the station.
 */
@Injectable()
export class VocalMarkersService {
    constructor(
        private readonly tracks: TracksRepository,
        private readonly lyrics: LyricsRepository,
        private readonly reader: VocalMarkersReader,
    ) {}

    /** @throws 404 for a record the catalog does not hold. */
    async getVocalMarkers(id: string): Promise<VocalMarkersDetail> {
        await this.mustExist(id);
        return this.detail(id);
    }

    /**
     * Sets the operator's correction, which wins over any lyric until it is cleared.
     *
     * @throws 400 for a correction that is neither instrumental nor names an onset, or whose end is
     *   not after its onset. 404 for a record the catalog does not hold.
     */
    async setVocalMarkers(id: string, input: VocalMarkersInput): Promise<VocalMarkersDetail> {
        await this.mustExist(id);

        if (input.instrumental === true) {
            await this.lyrics.saveOverride(id, { instrumental: true });
        } else {
            if (input.onsetMs === undefined)
                throw httpError(400).withDetails({ message: 'say where the singing starts, or that the record is instrumental' });
            if (input.endMs !== undefined && input.endMs <= input.onsetMs)
                throw httpError(400).withDetails({ message: 'the singing has to stop after it starts' });
            await this.lyrics.saveOverride(id, {
                instrumental: false,
                onsetMs: input.onsetMs,
                ...(input.endMs === undefined ? {} : { endMs: input.endMs }),
            });
        }

        return this.detail(id);
    }

    /** Drops the correction, so the record's timed lyrics decide again. @throws 404 for a record the catalog does not hold. */
    async clearVocalMarkers(id: string): Promise<VocalMarkersDetail> {
        await this.mustExist(id);
        await this.lyrics.clearOverride(id);
        return this.detail(id);
    }

    private async detail(id: string): Promise<VocalMarkersDetail> {
        const answer = (await this.reader.sourcedForTracks([id])).get(id);
        return toDetail(id, answer ?? { markers: { kind: 'unknown' }, source: 'none' });
    }

    private async mustExist(id: string): Promise<void> {
        const row = await this.tracks.findTrack(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });
    }
}

export function toDetail(trackId: string, { markers, source }: SourcedVocalMarkers): VocalMarkersDetail {
    if (markers.kind !== 'ranges') return { trackId, kind: markers.kind, source };
    return { trackId, kind: 'ranges', onsetMs: markers.onsetMs, endMs: markers.endMs, source };
}
