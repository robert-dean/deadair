import type { ReactNode } from 'react';
import { Alert } from '@mantine/core';

import { apiErrorMessage } from '../../api/sdk.error';

/**
 * How much of the page the failure took with it.
 *
 * `failure` is tally red: the thing this page is for could not be loaded, and there is nothing
 * behind the alert. `warning` is fault amber: something failed and the page still works — a rescan
 * that errored, one plugin of four that would not list, a preview that did not speak. The two are
 * the same red and amber `theme.ts` retunes for "the hard failures" and "installed but wrong", so
 * this prop is naming an existing convention rather than inventing one.
 *
 * Note this is deliberately NOT `StatusTone`. That vocabulary is about the state of a subject and
 * maps `fault` onto amber and `live` onto red, which is the right answer for a lamp and the wrong
 * one here: an error alert is not reporting that anything is on air.
 */
export type ErrorTone = 'failure' | 'warning';

const TONE_COLOR: Record<ErrorTone, string> = {
    failure: 'red',
    warning: 'yellow',
};

export interface ErrorAlertProps {
    /**
     * What failed, in the console's own words.
     *
     * Optional for the same reason `EmptyState.title` is: a couple of these carry one finished
     * sentence and inventing a heading to sit over it would be this component writing station copy.
     */
    title?: string;
    /** Whatever was thrown or returned as `query.error`. */
    error?: unknown;
    /** The sentence to fall back to when the failure carries no message of its own. */
    fallback?: string;
    /** How much of the page went with it. See `ErrorTone`; the default is the whole thing. */
    tone?: ErrorTone;
    /** Given for a failure an operator can wave away, which is one whose page still works. */
    onDismiss?: () => void;
    /** For the few callers holding a finished sentence, or a list, rather than an error object. */
    children?: ReactNode;
}

/**
 * Something went wrong, said the same way in all forty-odd places it happens.
 *
 * The point is not the four lines of markup it saves. It is that the shape of an error message —
 * a title the console wrote, then a detail the SERVER wrote, and never one without the other —
 * was previously re-decided per page, and a page that skipped the fallback showed an operator an
 * empty red box on a failure whose response had no body.
 *
 * `tone` exists because that guarantee was only ever as good as the colour happening to be right.
 * The component drew red and nothing else, so every page with a failure it had survived — a failed
 * rescan, a partial list, a preview that would not play — hand-rolled an amber `Alert` to get the
 * colour, and lost the title-and-detail rule on the way out. Five of them did exactly that. The
 * colour was the reason they left, so the colour is the prop.
 */
export function ErrorAlert({ title, error, fallback, tone = 'failure', onDismiss, children }: ErrorAlertProps) {
    return (
        <Alert
            color={TONE_COLOR[tone]}
            title={title}
            withCloseButton={onDismiss !== undefined}
            closeButtonLabel="Dismiss"
            onClose={onDismiss}
        >
            {children ?? apiErrorMessage(error, fallback ?? '')}
        </Alert>
    );
}
