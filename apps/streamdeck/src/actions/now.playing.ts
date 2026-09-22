import { nowPlayingTitle } from '../display/key.title.js';
import { nowPlayingSvg, progressStep, svgDataUri, type NowPlayingFace } from '../display/key.image.js';
import { projectPlayhead, PlayheadClock, TICK_MS } from '../display/playhead.js';
import { resolveArtworkUrl, type ArtworkCache } from '../display/artwork.js';
import { describe } from '../station/connection.failure.js';
import type { Station } from '../station/station.settings.js';
import type { Reading, StatusPoller } from '../station/status.poller.js';
import { readTransport } from '../station/transport.reading.js';
import type { KeyFace } from './key.face.js';
import { optionsFrom, SHOW_EVERYTHING, type NowPlayingOptions } from './now.playing.options.js';
import { StationKeys } from './station.keys.js';

export interface NowPlayingDependencies {
    poller: Pick<StatusPoller, 'acquire' | 'subscribe'>;
    artwork: Pick<ArtworkCache, 'peek' | 'load'>;
    station: () => Station | undefined;
    /** Opens the station's console, which is what pressing the key does. */
    openConsole: (origin: string) => Promise<void>;
    /** The station's mark as a data URI, for a key with no cover to show. */
    mark?: string;
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
 *
 * A key's options take away the bar and the record's title and artist, and nothing else: with no
 * record, or a failure, the key still says why in words, because a bare placeholder or a cover that
 * is quietly an hour old would say nothing true. The shade under the title goes with the title.
 */
export function viewFor(
    reading: Reading,
    carriedMs: number,
    apiBase: string | undefined,
    options: NowPlayingOptions = SHOW_EVERYTHING,
): NowPlayingView {
    const failure = reading.failure === undefined ? undefined : describe(reading.failure).title;
    const status = reading.status;
    if (status === undefined) {
        const title = failure ?? '';
        return {
            title,
            face: { tone: reading.failure === undefined || reading.failure === 'unconfigured' ? 'off' : 'fault', stale: false, shade: title !== '' },
        };
    }

    const transport = readTransport(status);
    const nowPlaying = status.nowPlaying;
    if (nowPlaying === undefined) {
        const title = failure ?? transport.label;
        return { title, face: { tone: transport.tone, stale: reading.stale, shade: title !== '' } };
    }

    const playhead = options.progress ? projectPlayhead(nowPlaying, carriedMs) : undefined;
    const coverUrl = apiBase === undefined ? undefined : resolveArtworkUrl(apiBase, nowPlaying.item.artworkUrl);
    const title = failure ?? (options.title ? nowPlayingTitle(nowPlaying.item) : '');
    return {
        title,
        face: {
            tone: transport.tone,
            stale: reading.stale,
            shade: title !== '',
            ...(playhead === undefined ? {} : { step: progressStep(playhead.fraction) }),
        },
        ...(coverUrl === undefined ? {} : { coverUrl }),
    };
}

/**
 * Every Now Playing key on the deck, drawn from the one poller.
 *
 * The half-second clock that carries the bar between readings runs only while some key on the deck
 * draws a bar. A key with the bar turned off changes only with a reading, so ticking for it would
 * compose a frame twice a second for the painter to drop. The image is composed only when what it
 * shows changes (another cover, another step of the bar, another tone), which on an ordinary record
 * is every few seconds, never every tick.
 * Each key draws by its own options, so the few images in use at once are each composed once and
 * shared by every key that shows the same thing.
 */
export class NowPlayingKeys extends StationKeys {
    private readonly clock = new PlayheadClock();
    private readonly options = new Map<string, NowPlayingOptions>();
    private ticker?: ReturnType<typeof setInterval>;
    private readonly composed = new Map<string, string>();
    /** The cover being fetched, so a tick while it downloads does not ask for it again. */
    private fetching?: string;

    constructor(private readonly deps: NowPlayingDependencies) {
        super(deps.poller);
    }

    /** A key appearing, with its own settings. */
    show(face: KeyFace, settings: unknown): void {
        this.options.set(face.id, optionsFrom(settings));
        this.appear(face);
        this.syncTicker();
    }

    /** A key's settings changed in the settings panel. */
    configure(id: string, settings: unknown): void {
        this.options.set(id, optionsFrom(settings));
        this.syncTicker();
        this.render();
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
        this.syncTicker();
    }

    protected override onRelease(): void {
        this.syncTicker();
        this.composed.clear();
    }

    protected override onDisappear(id: string): void {
        this.options.delete(id);
        this.syncTicker();
    }

    /**
     * Start the clock if a key showing needs it, and stop it if none does.
     *
     * A clock stopped and started again carries a count from before it stopped, and that is safe for
     * the reason a suspended process is: the bar under-counts until the next reading re-anchors it,
     * which is at most five seconds away, and never runs ahead of the record.
     */
    private syncTicker(): void {
        const wanted = this.painter.ids().some(id => (this.options.get(id) ?? SHOW_EVERYTHING).progress);
        if (wanted && this.ticker === undefined) {
            this.ticker = setInterval(() => {
                this.clock.tick();
                this.render();
            }, TICK_MS);
        } else if (!wanted && this.ticker !== undefined) {
            clearInterval(this.ticker);
            this.ticker = undefined;
        }
    }

    protected render(): void {
        const carried = this.clock.carriedFor(this.reading.status?.nowPlaying);
        const apiBase = this.deps.station()?.apiBase;
        for (const id of this.painter.ids()) {
            const view = viewFor(this.reading, carried, apiBase, this.options.get(id) ?? SHOW_EVERYTHING);
            this.painter.paint(id, { title: view.title, image: this.imageFor(view) });
        }
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
        const key = `${view.coverUrl ?? ''}|${cover === undefined ? 'none' : 'cover'}|${view.face.step ?? ''}|${view.face.tone}|${view.face.stale}|${view.face.shade}`;
        let image = this.composed.get(key);
        if (image === undefined) {
            // A few keys with different options each hold one image at a time; anything older than
            // that is a step of the bar already passed, and is let go rather than kept.
            if (this.composed.size >= 8) this.composed.clear();
            const art = cover === undefined ? (this.deps.mark === undefined ? {} : { mark: this.deps.mark }) : { cover };
            image = svgDataUri(nowPlayingSvg({ ...view.face, ...art }));
            this.composed.set(key, image);
        }
        return image;
    }
}
