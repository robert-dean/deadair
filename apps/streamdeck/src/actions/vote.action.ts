import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

import type { VoteKeys } from './vote.keys.js';
import { DISLIKE, LIKE } from './vote.reading.js';

/** The Stream Deck's side of a vote key. Everything either of them decides is in `VoteKeys`. */
abstract class VoteAction extends SingletonAction {
    constructor(private readonly keys: VoteKeys) {
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

/** Play this record more often. */
@action({ UUID: LIKE })
export class LikeAction extends VoteAction {}

/** Never play this record again: a dislike is an instruction to the programming, not a preference. */
@action({ UUID: DISLIKE })
export class DislikeAction extends VoteAction {}
