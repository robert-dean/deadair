import { nowPlayingTitle } from '../display/key.title.js';
import { nowPlayingSvg, progressStep, svgDataUri, type NowPlayingFace } from '../display/key.image.js';
import { projectPlayhead, PlayheadClock, TICK_MS } from '../display/playhead.js';
import { resolveArtworkUrl, type ArtworkCache } from '../display/artwork.js';
import { describe } from '../station/connection.failure.js';
import type { Station } from '../station/station.settings.js';
import type { Reading, StatusPoller } from '../station/status.poller.js';
import { readTransport } from '../station/transport.reading.js';
import { StationKeys } from './station.keys.js';

export interface NowPlayingDependencies {
    poller: Pick<StatusPoller, 'acquire' | 'subscribe'>;
    artwork: Pick<ArtworkCache, 'peek' | 'load'>;
    station: () => Station | undefined;
    /** Opens the station's console, which is what pressing the key does. */
    openConsole: (origin: string) => Promise<void>;
}

/** What the key shows, before it becomes an image: the title, and the face with the cover's address instead of its bytes. */
export interface NowPlayingView {
    title: string;
    face: Omit<NowPlayingFace, 'cover'>;
    coverUrl?: string;
}

/**
 * What the Now Playing key shows for a reading.
 *
 * A record: its cover, its title and who it is by, and the bar. Nothing on air: the placeholder and
 * the station's own two words for why ("ready", "off air"). A failure: the last cover if there is
 * one, never live-coloured, and the failure's word instead of the title, because the operator
 * glancing at the key needs to know the reading is old more than they need the title again.
 */
export function viewFor(reading: Reading, carriedMs: number, apiBase: string | undefined): NowPlayingView {
    const failure = reading.failure === undefined ? undefined : describe(reading.failure).title;
    const status = reading.status;
    if (status === undefined) {
        return {
            title: failure ?? '',
            face: { tone: reading.failure === undefined || reading.failure === 'unconfigured' ? 'off' : 'fault', stale: false },
        };
    }

    const transport = readTransport(status);
    const nowPlaying = status.nowPlaying;
    if (nowPlaying === undefined) {
        return { title: failure ?? transport.label, face: { tone: transport.tone, stale: reading.stale } };
    }

    const playhead = projectPlayhead(nowPlaying, carriedMs);
    const coverUrl = apiBase === undefined ? undefined : resolveArtworkUrl(apiBase, nowPlaying.item.artworkUrl);
    return {
        title: failure ?? nowPlayingTitle(nowPlaying.item),
        face: {
            tone: transport.tone,
            stale: reading.stale,
            ...(playhead === undefined ? {} : { step: progressStep(playhead.fraction) }),
        },
        ...(coverUrl === undefined ? {} : { coverUrl }),
    };
}

/**
 * Every Now Playing key on the deck, drawn from the one poller.
 *
 * Holding the poller also starts the half-second clock that carries the bar between readings, and
 * letting go stops it. The image is composed only when what it shows changes (another cover, another
 * step of the bar, another tone), which on an ordinary record is every few seconds, never every tick.
 */
export class NowPlayingKeys extends StationKeys {
    private readonly clock = new PlayheadClock();
    private ticker?: ReturnType<typeof setInterval>;
    private composed?: { key: string; image: string };
    /** The cover being fetched, so a tick while it downloads does not ask for it again. */
    private fetching?: string;

    constructor(private readonly deps: NowPlayingDependencies) {
        super(deps.poller);
    }

    /** Pressing the key opens the console, or says there is no station to open. */
    async press(id: string): Promise<void> {
        const station = this.deps.station();
        if (station === undefined) {
            await this.painter
                .get(id)
                ?.showAlert()
                .catch(() => undefined);
            return;
        }
        await this.deps.openConsole(station.origin);
    }

    protected override onHold(): void {
        this.ticker = setInterval(() => {
            this.clock.tick();
            this.render();
        }, TICK_MS);
    }

    protected override onRelease(): void {
        clearInterval(this.ticker);
        this.ticker = undefined;
    }

    protected render(): void {
        const carried = this.clock.carriedFor(this.reading.status?.nowPlaying);
        const view = viewFor(this.reading, carried, this.deps.station()?.apiBase);
        this.painter.paintAll({ title: view.title, image: this.imageFor(view) });
    }

    private imageFor(view: NowPlayingView): string {
        const known = view.coverUrl === undefined ? undefined : this.deps.artwork.peek(view.coverUrl);
        if (view.coverUrl !== undefined && known === undefined && this.fetching !== view.coverUrl) {
            const url = view.coverUrl;
            this.fetching = url;
            void this.deps.artwork.load(url).then(() => {
                if (this.fetching === url) this.fetching = undefined;
                this.render();
            });
        }
        const cover = known?.cover;
        const key = `${view.coverUrl ?? ''}|${cover === undefined ? 'none' : 'cover'}|${view.face.step ?? ''}|${view.face.tone}|${view.face.stale}`;
        if (this.composed?.key !== key) {
            this.composed = { key, image: svgDataUri(nowPlayingSvg({ ...view.face, ...(cover === undefined ? {} : { cover }) })) };
        }
        return this.composed.image;
    }
}
