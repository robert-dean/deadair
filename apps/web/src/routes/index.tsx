import { useCallback } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { stationOrderOptions } from '../api/director.queries';
import { DeskPage } from '../components/desk/desk.page';

/** What the Desk's address may carry. At rest it carries nothing. */
export interface DeskSearch {
    /** Open the request dialog on arrival. The Stream Deck's Request key sends `?request=1`. */
    request?: true;
}

/** `?request=1` and `?request=true` both ask; the router has already read either as a number or a boolean. Anything else is dropped. */
export function validateDeskSearch(input: Record<string, unknown>): DeskSearch {
    const value = input.request;
    return value === true || value === 1 || value === '1' || value === 'true' ? { request: true } : {};
}

export const Route = createFileRoute('/')({
    component: DeskRoute,
    validateSearch: validateDeskSearch,
    // Reads through the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two. The desk draws the running order now, so it wants what /onair wanted.
    loader: ({ context }) => context.queryClient.ensureQueryData(stationOrderOptions),
});

function DeskRoute() {
    const { request } = Route.useSearch();
    const navigate = useNavigate();
    // `replace`, so the ask leaves the address without adding a back-button step that would open the
    // dialog again.
    const arrived = useCallback(() => void navigate({ to: '/', search: {}, replace: true }), [navigate]);
    return <DeskPage requestOnArrival={request === true} onRequestArrived={arrived} />;
}
