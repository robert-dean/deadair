import { readFileSync } from 'node:fs';

import streamDeck from '@elgato/streamdeck';

import { NowPlayingAction } from './actions/now.playing.action.js';
import { NowPlayingKeys } from './actions/now.playing.js';
import { SkipAction } from './actions/skip.action.js';
import { SkipKeys } from './actions/skip.keys.js';
import { TransportAction } from './actions/transport.action.js';
import { TransportKeys } from './actions/transport.keys.js';
import { DislikeAction, LikeAction } from './actions/vote.action.js';
import { VoteKeys } from './actions/vote.keys.js';
import { ArtworkCache } from './display/artwork.js';
import { isToPlugin, type ToInspector } from './inspector/inspector.messages.js';
import { describe, type Failure } from './station/connection.failure.js';
import { createPublicSdk, createStationSdk } from './station/station.client.js';
import { StationLink } from './station/station.link.js';
import { probeStation } from './station/station.probe.js';
import { redact, type StationSettings } from './station/station.settings.js';
import { StatusPoller } from './station/status.poller.js';
import { RatingStore } from './station/track.rating.js';

streamDeck.logger.setLevel('info');
const logger = streamDeck.logger.createScope('deadair');

const userAgent = `deadair-streamdeck/${streamDeck.info.plugin.version}`;
const poller = new StatusPoller();
const link = new StationLink(poller, userAgent);
const artwork = new ArtworkCache({ userAgent });
// What the station thinks of the records it plays, shared by both vote keys. Emptied when the
// station changes, because a rating is remembered against a track id and another station's ids name
// other records, if they name anything.
const ratings = new RatingStore({ catalog: () => link.sdk?.catalog });
link.onChange(() => ratings.reset());

/**
 * A picture the app ships beside the bundle, as a data URI.
 *
 * Read off the plugin's own folder rather than bundled, because these are images the app already
 * carries; a plugin that cannot read one draws its fallback and says so, rather than failing to
 * start. `mark.png` is the badge the Now Playing key shows when it has no cover, and `skull.png` is
 * the drawing lifted off its green field, which the vote keys draw inside their heart.
 */
function readPicture(name: string, without: string): string | undefined {
    try {
        return `data:image/png;base64,${readFileSync(new URL(`../imgs/plugin/${name}`, import.meta.url)).toString('base64')}`;
    } catch (error) {
        logger.warn(`${name} could not be read, so ${without}: ${String(error)}`);
        return undefined;
    }
}
const mark = readPicture('mark.png', 'a key with no cover draws a plain record');
const skull = readPicture('skull.png', 'the vote keys draw their heart empty');

const warn = (sentence: string): void => {
    logger.warn(sentence);
};

streamDeck.actions.registerAction(
    new NowPlayingAction(
        new NowPlayingKeys({
            poller,
            artwork,
            station: () => link.station,
            openConsole: origin => streamDeck.system.openUrl(origin),
            ...(mark === undefined ? {} : { mark }),
        }),
    ),
);
streamDeck.actions.registerAction(new SkipAction(new SkipKeys(poller, warn)));
streamDeck.actions.registerAction(new TransportAction(new TransportKeys(poller, warn)));
streamDeck.actions.registerAction(new LikeAction(new VoteKeys('liked', ratings, poller, warn, skull)));
streamDeck.actions.registerAction(new DislikeAction(new VoteKeys('disliked', ratings, poller, warn, skull)));

// A failure is logged when it starts and when it ends, not on every poll that repeats it: a station
// that is down for an hour is two lines in the log, not eighteen hundred. It starts out as "no station"
// because that is what the plugin knows before the app hands it the settings, and saying so, then
// saying the station is back a millisecond later, would be two lines about nothing.
let failing: Failure | undefined = 'unconfigured';
poller.subscribe(reading => {
    if (reading.failure === failing) return;
    if (reading.failure !== undefined) logger.warn(describe(reading.failure).sentence);
    else if (failing !== 'unconfigured') logger.info('The station is answering again.');
    failing = reading.failure;
});

// The settings the keys are using, which is what the settings panel is told about: it writes them,
// the app hands them here, and the check runs on what arrived rather than on what the panel typed.
let settings: StationSettings = {};

/**
 * Checks the settings and tells the settings panel what it found. Only while a panel is open: the
 * panel asks for a check itself when it opens, and nobody else reads the answer.
 */
async function reportConnection(): Promise<void> {
    if (streamDeck.ui.action === undefined) return;
    const result = await probeStation(settings, {
        anonymous: apiBase => createPublicSdk(apiBase, userAgent),
        keyed: station => createStationSdk(station, userAgent),
    });
    const message: ToInspector = { event: 'connection', ...result };
    await streamDeck.ui.sendToPropertyInspector(message);
}

streamDeck.settings.onDidReceiveGlobalSettings<StationSettings>(ev => {
    settings = ev.settings;
    logger.info(`Station settings: ${redact(settings)}`);
    link.apply(settings);
    void reportConnection();
});
streamDeck.ui.onSendToPlugin(ev => {
    if (isToPlugin(ev.payload)) void reportConnection();
});
streamDeck.system.onSystemDidWakeUp(() => link.refresh());

await streamDeck.connect();
settings = await streamDeck.settings.getGlobalSettings<StationSettings>();
link.apply(settings);
if (link.station === undefined) logger.warn(describe('unconfigured').sentence);
