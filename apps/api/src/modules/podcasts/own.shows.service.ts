import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';
import { stationZone } from '#modules/director/clock.words.js';
import { ProductionsService } from '#modules/productions/productions.service.js';
import type { Production, ProductionList } from '#modules/productions/types/productions.types.js';
import type { OwnShowRecord, OwnShowWrite } from './own.show.js';
import { OwnShowRepository } from './own.show.repository.js';
import type { OwnEpisodeRequest, OwnShow, OwnShowInput, OwnShowList } from './types/podcasts.types.js';

/** Where an episode's own subject is cut, in its title. The whole of it is still its brief. */
const TITLE_TOPIC_CHARS = 120;

/** What a source pasted with no name of its own is called. */
const PASTED = 'Pasted text';

/**
 * The shows the station makes for itself, beside the ones it carries from somebody else's feeds.
 *
 * A show is a saved recipe and every episode is a production, asked for through
 * `ProductionsService.commission`, the same path the Productions page uses. So an episode is queued,
 * researched, written, spoken, joined and aired by code that already does all of that, and a show adds
 * nothing to any of it but its defaults and the filing.
 */
@Injectable()
export class OwnShowsService {
    constructor(
        private readonly shows: OwnShowRepository,
        private readonly productions: ProductionsService,
        private readonly config: AppConfig,
    ) {}

    async list(): Promise<OwnShowList> {
        return { shows: (await this.shows.list()).map(view) };
    }

    async create(body: OwnShowInput): Promise<OwnShow> {
        return view(await this.shows.create(writeOf(body)));
    }

    async update(id: string, body: OwnShowInput): Promise<OwnShow> {
        const updated = await this.shows.update(id, writeOf(body));
        if (updated === undefined) throw missing(id);
        return view(updated);
    }

    async remove(id: string): Promise<void> {
        if (!(await this.shows.remove(id))) throw missing(id);
    }

    /** A show's episodes, newest first, with how far along each is. */
    async episodes(id: string): Promise<ProductionList> {
        if ((await this.shows.find(id)) === undefined) throw missing(id);
        return await this.productions.listForShow(id);
    }

    /**
     * Ask a show for an episode.
     *
     * Its subject is the episode's own topic when one is given and the show's standing one otherwise;
     * pasted text becomes a source, which the research pass reads for the notes the episode may state as
     * fact. An episode with neither a subject nor anything to read is refused here, since it would be a
     * production about nothing in particular, which is what the show exists to avoid.
     */
    async requestEpisode(id: string, body: OwnEpisodeRequest): Promise<Production> {
        const show = await this.shows.find(id);
        if (show === undefined) throw missing(id);

        const topic = body.topic?.trim() ?? '';
        const text = body.text?.trim() ?? '';
        const brief = topic.length > 0 ? topic : show.subject;
        if (brief === undefined && text.length === 0) {
            throw httpError(400).withDetails({
                message: `"${show.title}" has no subject of its own, so an episode needs a topic or something to read`,
            });
        }

        const sourceTitle = body.sourceTitle?.trim() ?? '';
        return await this.productions.commission(
            {
                kind: 'podcast',
                title: episodeTitle(show, topic, Date.now(), stationZone(this.config)),
                ...(brief === undefined ? {} : { brief }),
                ...(text.length === 0 ? {} : { sources: [{ title: sourceTitle.length > 0 ? sourceTitle : PASTED, text }] }),
                ...(show.personaId === undefined ? {} : { personaId: show.personaId }),
                ...(show.targetMs === undefined ? {} : { targetMs: show.targetMs }),
                ...(show.writingMode === undefined ? {} : { writingMode: show.writingMode }),
                ...(body.airAt === undefined ? {} : { scheduledFor: body.airAt }),
            },
            { showId: show.id },
        );
    }
}

/**
 * What an episode is called: the show and its topic, or the show and the day when it has none of its
 * own. The topic is cut short for the title only; the whole of it is the episode's brief.
 */
export function episodeTitle(show: Pick<OwnShowRecord, 'title'>, topic: string, at: number, zone: string): string {
    if (topic.length > 0) {
        const short = topic.length > TITLE_TOPIC_CHARS ? `${topic.slice(0, TITLE_TOPIC_CHARS).trimEnd()}…` : topic;
        return `${show.title}: ${short}`.slice(0, 300);
    }

    const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at));
    return `${show.title}, ${day}`.slice(0, 300);
}

const missing = (id: string) => httpError(404).withDetails({ message: `show "${id}" does not exist` });

/** What the operator sent, trimmed, with an empty box as nothing. */
function writeOf(body: OwnShowInput): OwnShowWrite {
    const optional = (value: string | undefined): string | undefined => {
        const trimmed = value?.trim() ?? '';
        return trimmed.length === 0 ? undefined : trimmed;
    };
    const description = optional(body.description);
    const subject = optional(body.subject);
    const personaId = optional(body.personaId);

    return {
        title: body.title.trim(),
        ...(description === undefined ? {} : { description }),
        ...(subject === undefined ? {} : { subject }),
        ...(personaId === undefined ? {} : { personaId }),
        ...(body.targetMs === undefined ? {} : { targetMs: body.targetMs }),
        ...(body.writingMode === undefined ? {} : { writingMode: body.writingMode }),
    };
}

function view(show: OwnShowRecord): OwnShow {
    return {
        id: show.id,
        title: show.title,
        ...(show.description === undefined ? {} : { description: show.description }),
        ...(show.subject === undefined ? {} : { subject: show.subject }),
        ...(show.personaId === undefined ? {} : { personaId: show.personaId }),
        ...(show.targetMs === undefined ? {} : { targetMs: show.targetMs }),
        ...(show.writingMode === undefined ? {} : { writingMode: show.writingMode }),
        createdAt: DateTime.fromMillis(show.createdAt),
    };
}
