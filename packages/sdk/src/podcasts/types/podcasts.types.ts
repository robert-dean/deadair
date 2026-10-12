import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * A programme the station carries, as one installed plugin describes it
 * generated from [StationShow](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationShow {
    /** Unique across the station: the plugin's own id for the show, qualified with the plugin that offered it */
    id: string;
    pluginId: string;
    /** What the show is called, which is what a presenter says out loud */
    title: string;
    author?: string;
    /** What the show says about itself, as plain text */
    description?: string;
    artworkUrl?: string;
    homeUrl?: string;
    /** Where its feed is, when the plugin reads one */
    feedUrl?: string;
    language?: string;
    categories?: string[];
    /** Whether the publisher marked the whole show explicit. Absent means the publisher did not say, which is not the same as clean */
    explicit?: boolean;
}

/**
 * One episode of a programme the station carries, and what the station has done with it
 * generated from [StationEpisode](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationEpisode {
    /** The station's own id for this episode */
    id: string;
    /** Qualified, matching `StationShow.id` */
    showId: string;
    /** The plugin's own id for the episode, stable across refreshes */
    episodeId: string;
    showTitle: string;
    title: string;
    /** What the publisher says it is about, as plain text */
    summary?: string;
    /** The episode's page, for a person */
    url?: string;
    /** ISO-8601 */
    publishedAt?: string;
    /** How long the publisher says it runs, in milliseconds */
    durationMs?: number;
    artworkUrl?: string;
    explicit?: boolean;
    /** ISO-8601: when a refresh last saw it in its feed */
    seenAt: string;
    /** Whether the station holds its own copy of the audio, ready to air */
    fetched: boolean;
    /** ISO-8601: when the station last asked for the audio */
    fetchRequestedAt?: string;
    /** Why the last attempt to fetch the audio failed, when it did */
    fetchError?: string;
    /** ISO-8601: the slot the audio was fetched for */
    scheduledFor?: string;
    /** ISO-8601: when a listener could first have heard it. An episode airs once */
    airedAt?: string;
}

/**
 * A show a podcast plugin's directory knows about, which the station may or may not carry
 * generated from [StationDirectoryEntry](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationDirectoryEntry {
    /** The directory's own id for the show. A key in a list, and nothing more */
    id: string;
    /** The plugin whose directory answered, which is the plugin a subscription would go to */
    pluginId: string;
    title: string;
    /** Where the show's feed is, which is what subscribing needs */
    feedUrl: string;
    author?: string;
    description?: string;
    artworkUrl?: string;
    homeUrl?: string;
    categories?: string[];
    explicit?: boolean;
}

/**
 * generated from [StationDirectoryQuery](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationDirectoryQuery {
    /** Words to look a show up by: its name, its publisher, its subject */
    query: string;
    limit?: number;
}

/**
 * generated from [StationEpisodeQuery](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationEpisodeQuery {
    /** One show's episodes, or absent for every show's, newest first */
    showId?: string;
    limit?: number;
}

/**
 * A show the station makes for itself: a saved recipe for a podcast, whose every episode is a production
 * generated from [OwnShow](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface OwnShow {
    id: string;
    /** What the show is called. Each episode's title starts with it */
    title: string;
    /** What the show is, for the console. Never read out */
    description?: string;
    /** What an episode is about when it is asked for with no subject of its own */
    subject?: string;
    /** Who presents it. Absent is whoever is presenting when it is made */
    personaId?: string;
    /** How long an episode runs. Absent is the station's production length */
    targetMs?: number;
    /** How much of the model an episode is worth. Absent is the station's default */
    writingMode?: 'quick' | 'outlined' | 'polished';
    /** The station's news feeds an episode reads, by their qualified ids. Absent or empty is a show that does not read the news */
    newsFeedIds?: string[];
    /** How many hours of news an episode reads. Absent is a day */
    newsHours?: number;
    /** Whether an episode given nothing to read finds its own sources on the operator's trusted sites */
    research?: boolean;
    createdAt: DateTime;
}

export interface OwnShowInput {
    /** What the show is called. Each episode's title starts with it */
    title: string;
    /** What the show is, for the console. Never read out */
    description?: string;
    /** What an episode is about when it is asked for with no subject of its own */
    subject?: string;
    /** Who presents it. Absent is whoever is presenting when it is made */
    personaId?: string;
    /** How long an episode runs. Absent is the station's production length */
    targetMs?: number;
    /** How much of the model an episode is worth. Absent is the station's default */
    writingMode?: 'quick' | 'outlined' | 'polished';
    /** The station's news feeds an episode reads, by their qualified ids. Absent or empty is a show that does not read the news */
    newsFeedIds?: string[];
    /** How many hours of news an episode reads. Absent is a day */
    newsHours?: number;
    /** Whether an episode given nothing to read finds its own sources on the operator's trusted sites */
    research?: boolean;
}

/** Rehydrates every wire-encoded scalar in a OwnShow into its runtime type. Mutates and returns `raw`. */
export function reviveOwnShow(raw: OwnShow): OwnShow {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'OwnShow.createdAt');
    return raw;
}

/**
 * Asks one of the station's own shows for an episode. Everything is optional: a show with a standing subject needs nothing
 * generated from [OwnEpisodeRequest](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface OwnEpisodeRequest {
    /** What this episode is about. Absent is the show's own subject */
    topic?: string;
    /** A page for it to read first, by its address. The episode states only what it can find there */
    url?: string;
    /** What the pasted text is called */
    sourceTitle?: string;
    /** Something for it to read first. The episode states only what it can find in this. Given text, a show that reads the news reads this instead */
    text?: string;
    /** When it should air. Absent is as soon as it is made */
    airAt?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a OwnEpisodeRequest into its runtime type. Mutates and returns `raw`. */
export function reviveOwnEpisodeRequest(raw: OwnEpisodeRequest): OwnEpisodeRequest {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['airAt'] != null) {
        __o0['airAt'] = __dt(__o0['airAt'], 'OwnEpisodeRequest.airAt');
    }
    return raw;
}

/**
 * generated from [StationShowList](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationShowList {
    shows: StationShow[];
}

/**
 * generated from [StationEpisodePage](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationEpisodePage {
    /** Newest first. Empty when the station knows of none, which is not an error */
    episodes: StationEpisode[];
}

/**
 * generated from [StationDirectoryPage](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface StationDirectoryPage {
    /** Empty when nothing matched or no directory could be asked, which is not an error */
    results: StationDirectoryEntry[];
}

/**
 * generated from [OwnShowList](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck)
 */
export interface OwnShowList {
    shows: OwnShow[];
}

export interface OwnShowListInput {
    shows: OwnShowInput[];
}

/** Rehydrates every wire-encoded scalar in a OwnShowList into its runtime type. Mutates and returns `raw`. */
export function reviveOwnShowList(raw: OwnShowList): OwnShowList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['shows'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveOwnShow(__a1[__i2] as never);
        }
    }
    return raw;
}
