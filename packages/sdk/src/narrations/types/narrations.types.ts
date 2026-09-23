/**
 * Something the station can read out, as one installed plugin describes it
 * generated from [StationSeries](../../../../../apps/api/data/contracts/narrations/narrations.types.ck#L7)
 */
export interface StationSeries {
    /** Unique across the station: the plugin's own id for the series, qualified with the plugin that offered it */
    id: string;
    pluginId: string;
    /** What the series is called, which is what a presenter says out loud */
    title: string;
    /** How it is worked through: `serial` from the beginning in order, `latest` its newest piece and nothing once that has aired */
    order: 'serial' | 'latest';
    author?: string;
    /** What the series says about itself, as plain text */
    description?: string;
    artworkUrl?: string;
    homeUrl?: string;
    /** ISO 639-1, or the source's own tag. Also what the station splits sentences by when it cuts a long piece up */
    language?: string;
}

/**
 * One instalment, and what the station has done with it
 * generated from [StationPiece](../../../../../apps/api/data/contracts/narrations/narrations.types.ck#L23)
 */
export interface StationPiece {
    /** The station's own id for this piece */
    id: string;
    /** Qualified, matching `StationSeries.id` */
    seriesId: string;
    /** The plugin's own id for the piece, stable across refreshes */
    pieceId: string;
    seriesTitle: string;
    title: string;
    /** How its series is worked through, copied onto the piece by every refresh */
    order: 'serial' | 'latest';
    author?: string;
    /** What it is about, as plain text */
    summary?: string;
    /** The piece's page, for a person */
    url?: string;
    artworkUrl?: string;
    /** Where it comes in a serial, from 0. Absent for a `latest` series */
    ordinal?: number;
    /** ISO-8601 */
    publishedAt?: string;
    /** Roughly how many words it runs to, as the plugin counted them */
    wordCount?: number;
    /** ISO-8601: when a refresh last saw it listed */
    seenAt: string;
    /** ISO-8601: when a refresh found its plugin no longer listing it. The station never picks a withdrawn piece; the row is kept so what was done with it is not lost */
    withdrawnAt?: string;
    /** Whether the station has the spoken audio, ready to air */
    rendered: boolean;
    /** Whether the words are being spoken right now */
    rendering: boolean;
    /** ISO-8601: when the station last asked for it to be spoken */
    renderRequestedAt?: string;
    /** Why the last attempt to speak it failed, when it did */
    renderError?: string;
    /** ISO-8601: the slot it was made for */
    scheduledFor?: string;
    /** ISO-8601: when a listener could first have heard it. A piece airs once, and for a serial this is also the station's place in the book */
    airedAt?: string;
}

/**
 * generated from [StationPieceQuery](../../../../../apps/api/data/contracts/narrations/narrations.types.ck#L47)
 */
export interface StationPieceQuery {
    /** One series' pieces in its own order, or absent for every series' newest first */
    seriesId?: string;
    limit?: number;
}

/**
 * generated from [StationSeriesList](../../../../../apps/api/data/contracts/narrations/narrations.types.ck#L19)
 */
export interface StationSeriesList {
    series: StationSeries[];
}

/**
 * generated from [StationPiecePage](../../../../../apps/api/data/contracts/narrations/narrations.types.ck#L52)
 */
export interface StationPiecePage {
    /** Empty when the station knows of none, which is not an error */
    pieces: StationPiece[];
}
