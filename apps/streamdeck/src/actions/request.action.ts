import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { RequestKeys } from './request.keys.js';
import { REQUEST, type RequestSettings } from './request.reading.js';

/** The Stream Deck's side of the Request key. Everything it decides is in `RequestKeys`. */
@action({ UUID: REQUEST })
export class RequestAction extends SingletonAction<RequestSettings> {
    constructor(private readonly keys: RequestKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<RequestSettings>): void {
        if (ev.action.isKey()) this.keys.show(ev.action, ev.payload.settings);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<RequestSettings>): void {
        this.keys.configure(ev.action.id, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<RequestSettings>): void {
        this.keys.disappear(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent<RequestSettings>): Promise<void> {
        await this.keys.press(ev.action.id);
    }
}
