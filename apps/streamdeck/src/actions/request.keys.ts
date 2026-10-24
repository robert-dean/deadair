import type { ListenerRequest, ListenerRequestCreate } from '@deadair/sdk';

import { requestSvg, svgDataUri } from '../display/key.image.js';
import { classify, describe, NotConfigured } from '../station/connection.failure.js';
import type { Log } from './command.outcome.js';
import { FacePainter, type KeyFace } from './key.face.js';
import { requestSettingsFrom, requestView, type RequestSettings } from './request.reading.js';

/** What a Request key reads of the station's answer: whether it took, and what to say if not. */
export type RequestAnswer = Pick<ListenerRequest, 'status' | 'title' | 'reason'>;

/** The part of the station's SDK a Request key uses: asking. The SDK's `RequestsClient` is one. */
export interface Requests {
    createRequest(body: ListenerRequestCreate): Promise<RequestAnswer>;
}

export interface RequestKeysOptions {
    /** The requests of the station in use, or none while no station is set up. Read on every press, because the station changes under it. */
    requests: () => Requests | undefined;
    /** The origin of the station in use, which a key's record has to have been found on. */
    origin: () => string | undefined;
    /** Open an address in the operator's browser: the console's request dialog, for a key with no record. */
    openUrl: (url: string) => Promise<void>;
    log: Log;
}

/**
 * Request: one record, chosen in the key's settings, asked for on a press. A key with no record
 * opens the console's request dialog in the browser instead, to choose one there.
 *
 * `POST /requests`, which is the phone apps' own call, so the station alone decides: the API key acts
 * as the account that issued it, and that account is held to the same rules a listener is — one open
 * request at a time, the cooldown after one is let through, the cap on the line, the station's taste,
 * and an operator's approval when `requests.approval` is on. A deck of several Request keys is
 * therefore a shortlist to ask from one at a time, not several requests at once.
 *
 * A refusal is not an error. The station answers 201 with `declined` and says why in `reason`, so the
 * key shows the warning triangle and the log carries the station's own sentence, as for every other
 * key whose press did not take. Anything it did take — waiting for an operator, waiting on its audio,
 * or placed — is the tick: the press did what a press can do.
 *
 * These keys hold no hold on the poller. Nothing they draw depends on what is on air, so a deck
 * showing only Request keys asks the station nothing until one is pressed.
 */
export class RequestKeys {
    private readonly painter = new FacePainter();
    private readonly settings = new Map<string, RequestSettings>();
    private readonly busy = new Set<string>();
    private readonly faces = { live: svgDataUri(requestSvg({ dim: false })), dim: svgDataUri(requestSvg({ dim: true })) };

    constructor(private readonly options: RequestKeysOptions) {}

    show(face: KeyFace, settings: unknown): void {
        this.painter.add(face);
        this.configure(face.id, settings);
    }

    /** A key's settings changed, from its panel: redraw that key alone. */
    configure(id: string, settings: unknown): void {
        this.settings.set(id, requestSettingsFrom(settings));
        this.render(id);
    }

    disappear(id: string): void {
        this.painter.remove(id);
        this.settings.delete(id);
    }

    /** The station changed: every key's record may now belong to another station. */
    refresh(): void {
        for (const id of this.painter.ids()) this.render(id);
    }

    async press(id: string): Promise<void> {
        const face = this.painter.get(id);
        const view = this.view(id);
        if (view.dim) this.options.log(view.refusal);
        if (view.dim || this.busy.has(id)) {
            await face?.showAlert().catch(() => undefined);
            return;
        }
        if ('open' in view) {
            // The browser does the asking from here: the console's dialog searches, takes a name and a
            // dedication, and shows the station's answer, none of which a key has room for.
            await this.options.openUrl(view.open).catch(() => undefined);
            return;
        }
        const press = view.press;
        this.busy.add(id);
        try {
            const requests = this.options.requests();
            if (requests === undefined) throw new NotConfigured();
            const answer = await requests.createRequest(press);
            if (answer.status === 'declined') {
                this.options.log(refusal(answer));
                await face?.showAlert().catch(() => undefined);
            } else {
                await face?.showOk().catch(() => undefined);
            }
        } catch (error) {
            const failure = classify(error);
            this.options.log(
                failure === 'forbidden'
                    ? 'The station would not let this key ask for a record. Requests need a key issued by an account with a role on the station.'
                    : describe(failure).sentence,
            );
            await face?.showAlert().catch(() => undefined);
        } finally {
            this.busy.delete(id);
        }
    }

    private render(id: string): void {
        const view = this.view(id);
        // The image alone: a title the operator typed in the app is left as it is.
        this.painter.paint(id, { image: view.dim ? this.faces.dim : this.faces.live });
    }

    private view(id: string) {
        return requestView(this.settings.get(id) ?? {}, this.options.origin());
    }
}

/** The log line for a request the station turned down, in its own words where it gave any. */
function refusal(answer: RequestAnswer): string {
    const reason = answer.reason?.trim();
    return `The station turned down the request for “${answer.title}”${reason ? `: ${reason}` : '.'}`;
}
