import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

import type { TransportKeys } from './transport.keys.js';

/** The Stream Deck's side of Stop or start. Everything it decides is in `TransportKeys`. */
@action({ UUID: 'radio.deadair.streamdeck.transport' })
export class TransportAction extends SingletonAction {
    constructor(private readonly keys: TransportKeys) {
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
