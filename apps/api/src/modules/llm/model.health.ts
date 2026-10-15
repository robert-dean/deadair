import { Injectable } from 'injectkit';

/**
 * How long a model that just failed is passed over, in milliseconds.
 *
 * A minute: long enough that the calls queued behind a dead server go straight to the next model
 * rather than each paying a refused connection or a server's 500 first, and short enough that a
 * model host restarting is back in use on the next refill rather than after an operator notices.
 */
export const MODEL_DOWN_MS = 60_000;

/**
 * Which models failed lately, so a call naming several asks the working ones first.
 *
 * Every action names its models in the order an operator prefers them, and `LlmService.converse`
 * moves down that list when one fails before answering. Without a memory, every call would ask the
 * dead model first and pay for finding out again: an immediate refusal is cheap, but a server
 * answering 500 with its model unloaded, or a proxy relaying a retired model, is a round trip each
 * time. This remembers the failure for {@link MODEL_DOWN_MS} and nothing more.
 *
 * **A remembered failure moves a model to the back and never takes it off the list.** An operator's
 * list is a list of models they are willing to hear from; when every one of them is marked, the
 * order they wrote is the right order to try, because a mark is a guess about now and the list is an
 * instruction. A success clears the mark at once.
 *
 * A singleton, because it is a fact about the station's model hosts rather than about any one
 * caller, and keyed by the model id exactly as written (`provider:model`), so one provider row being
 * down says nothing about another.
 */
@Injectable()
export class ModelHealth {
    private readonly downUntil = new Map<string, number>();

    /** The clock, a field rather than a constructor argument so the container has nothing to inject. Tests replace it. */
    now: () => number = Date.now;

    /** Remember that `model` just failed before answering. */
    markDown(model: string): void {
        this.downUntil.set(model, this.now() + MODEL_DOWN_MS);
    }

    /** Forget a failure: `model` just answered. */
    clear(model: string): void {
        this.downUntil.delete(model);
    }

    /** Whether `model` failed within the last {@link MODEL_DOWN_MS}. */
    isDown(model: string): boolean {
        const until = this.downUntil.get(model);
        if (until === undefined) return false;
        if (until > this.now()) return true;

        this.downUntil.delete(model);
        return false;
    }

    /**
     * `models` in the order to try them: the ones not marked down first, then the marked ones, each
     * half in the order given. Every model stays on the list.
     */
    ordered<T extends string | undefined>(models: readonly T[]): T[] {
        const up = models.filter(model => model === undefined || !this.isDown(model));
        const down = models.filter(model => model !== undefined && this.isDown(model));
        return [...up, ...down];
    }
}
