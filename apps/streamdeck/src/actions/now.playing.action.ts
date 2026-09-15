import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

import type { NowPlayingKeys } from './now.playing.js';

/** The Stream Deck's side of the Now Playing key. Everything it decides is in `NowPlayingKeys`. */
@action({ UUID: 'radio.deadair.streamdeck.now-playing' })
export class NowPlayingAction extends SingletonAction {
    constructor(private readonly keys: NowPlayingKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent): void {
        if (ev.action.isKey()) this.keys.appear(ev.action);
    }

    override onWillDisappear(ev: WillDisappearEvent): void {
        this.keys.disappear(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent): Promise<void> {
        await this.keys.press(ev.action.id);
    }
}
