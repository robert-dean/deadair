import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

import type { GrantKeys } from './grant.keys.js';
import { GRANT } from './grant.reading.js';

/** The Stream Deck's side of the Grant key. Everything it decides is in `GrantKeys`. */
@action({ UUID: GRANT })
export class GrantAction extends SingletonAction {
    constructor(private readonly keys: GrantKeys) {
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
