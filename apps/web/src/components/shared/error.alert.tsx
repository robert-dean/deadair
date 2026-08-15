import type { ReactNode } from 'react';
import { Alert } from '@mantine/core';

import { apiErrorMessage } from '../../api/sdk.error';

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
    /** For the few callers holding a finished sentence rather than an error object. */
    children?: ReactNode;
}

/**
 * Something went wrong, said the same way in all forty-odd places it happens.
 *
 * The point is not the four lines of markup it saves. It is that the shape of an error message —
 * a title the console wrote, then a detail the SERVER wrote, and never one without the other —
 * was previously re-decided per page, and a page that skipped the fallback showed an operator an
 * empty red box on a failure whose response had no body.
 */
export function ErrorAlert({ title, error, fallback, children }: ErrorAlertProps) {
    return (
        <Alert color="red" title={title}>
            {children ?? apiErrorMessage(error, fallback ?? '')}
        </Alert>
    );
}
