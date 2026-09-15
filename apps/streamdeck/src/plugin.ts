import streamDeck from '@elgato/streamdeck';

import { NowPlayingAction } from './actions/now.playing.action.js';
import { NowPlayingKeys } from './actions/now.playing.js';
import { ArtworkCache } from './display/artwork.js';
import { describe, type Failure } from './station/connection.failure.js';
import { StationLink } from './station/station.link.js';
import { redact, type StationSettings } from './station/station.settings.js';
import { StatusPoller } from './station/status.poller.js';

streamDeck.logger.setLevel('info');
const logger = streamDeck.logger.createScope('deadair');

const userAgent = `deadair-streamdeck/${streamDeck.info.plugin.version}`;
const poller = new StatusPoller();
const link = new StationLink(poller, userAgent);
const artwork = new ArtworkCache({ userAgent });

streamDeck.actions.registerAction(
    new NowPlayingAction(
        new NowPlayingKeys({
            poller,
            artwork,
            station: () => link.station,
            openConsole: origin => streamDeck.system.openUrl(origin),
        }),
    ),
);

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

streamDeck.settings.onDidReceiveGlobalSettings<StationSettings>(ev => {
    logger.info(`Station settings: ${redact(ev.settings)}`);
    link.apply(ev.settings);
});
streamDeck.system.onSystemDidWakeUp(() => link.refresh());

await streamDeck.connect();
link.apply(await streamDeck.settings.getGlobalSettings<StationSettings>());
if (link.station === undefined) logger.warn(describe('unconfigured').sentence);
