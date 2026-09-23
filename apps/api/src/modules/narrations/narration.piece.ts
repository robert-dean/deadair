import type { NarrationOrder } from '@deadair/plugin-sdk';

/**
 * A piece of somebody else's writing, as the station holds it.
 *
 * The app's own shape over `deadair.narration_pieces`, in the codebase's own conventions rather than
 * the table's: instants are epoch milliseconds, and a column the database holds as null is a field
 * that is absent here.
 */
export interface NarrationPieceRecord {
    /** The row's own id. */
    id: string;
    /** Qualified: `<plugin id>:<the plugin's series id>`. */
    seriesId: string;
    /** The plugin's own id for the piece. */
    pieceId: string;
    seriesTitle: string;
    title: string;
    /** How the series it belongs to is worked through. Copied onto the piece by every refresh. */
    seriesOrder: NarrationOrder;
    author?: string;
    summary?: string;
    artworkUrl?: string;
    language?: string;
    url?: string;
    /** Where this comes in a `serial`, from 0. Absent for a `latest` series. */
    ordinal?: number;
    publishedAt?: number;
    wordCount?: number;
    seenAt: number;
    /**
     * When a refresh found the plugin no longer listing it. Absent while it is still listed.
     *
     * What the plugin said rather than what the station did, as {@link seenAt} is, and why it is not
     * on {@link NarrationPieceListing}: a listing can say a piece is there, never that one is not. The
     * station keeps a withdrawn piece and everything it did with it, and never picks it again.
     */
    withdrawnAt?: number;
    /** The production whose beats are this piece being spoken, while it is being made. */
    productionId?: string;
    /** The joined audio, once every beat has been spoken and put together. */
    segmentId?: string;
    renderRequestedAt?: number;
    renderAttempts: number;
    renderError?: string;
    scheduledFor?: number;
    airedAt?: number;
}

/**
 * What a refresh knows about a piece: everything the plugin said, and nothing the station did.
 *
 * Kept apart from {@link NarrationPieceRecord} so a refresh cannot, even by accident, write over what
 * the station did with a piece. `PodcastEpisodeListing`'s rule, and it costs more here if it is
 * broken: a re-listed episode that lost its fetch mark is a second download, where a re-listed piece
 * that lost its render mark is the station's only speech engine saying a whole chapter over again.
 */
export interface NarrationPieceListing {
    seriesId: string;
    pieceId: string;
    seriesTitle: string;
    title: string;
    seriesOrder: NarrationOrder;
    author?: string;
    summary?: string;
    artworkUrl?: string;
    language?: string;
    url?: string;
    ordinal?: number;
    publishedAt?: number;
    wordCount?: number;
}
