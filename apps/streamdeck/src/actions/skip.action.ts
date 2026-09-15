import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

import type { SkipKeys } from './skip.keys.js';

/** The Stream Deck's side of Skip. Everything it decides is in `SkipKeys`. */
@action({ UUID: 'radio.deadair.streamdeck.skip' })
export class SkipAction extends SingletonAction {
    constructor(private readonly keys: SkipKeys) {
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
