import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { NowPlayingKeys } from './now.playing.js';
import { NOW_PLAYING, type NowPlayingSettings } from './now.playing.options.js';

/** The Stream Deck's side of the Now Playing key. Everything it decides is in `NowPlayingKeys`. */
@action({ UUID: NOW_PLAYING })
export class NowPlayingAction extends SingletonAction<NowPlayingSettings> {
    constructor(private readonly keys: NowPlayingKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<NowPlayingSettings>): void {
        if (ev.action.isKey()) this.keys.show(ev.action, ev.payload.settings);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<NowPlayingSettings>): void {
        this.keys.configure(ev.action.id, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<NowPlayingSettings>): void {
        this.keys.disappear(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent<NowPlayingSettings>): Promise<void> {
        await this.keys.press(ev.action.id);
    }
}
