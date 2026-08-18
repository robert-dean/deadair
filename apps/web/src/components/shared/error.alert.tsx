import type { ReactNode } from 'react';
import { Alert } from '@mantine/core';

import { apiErrorMessage } from '../../api/sdk.error';
import { severityColor, type Severity } from './status';

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
    /** How much of the page went with it. See `Severity`; the default is the whole thing. */
    tone?: Severity;
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
 *
 * The prop is a `Severity` rather than a local vocabulary because the activity feed paints its
 * lines by the same question and used to answer it with a ternary naming `red` and `yellow` inline.
 */
export function ErrorAlert({ title, error, fallback, tone = 'failure', onDismiss, children }: ErrorAlertProps) {
    return (
        <Alert
            color={severityColor[tone]}
            title={title}
            withCloseButton={onDismiss !== undefined}
            closeButtonLabel="Dismiss"
            onClose={onDismiss}
        >
            {children ?? apiErrorMessage(error, fallback ?? '')}
        </Alert>
    );
}
