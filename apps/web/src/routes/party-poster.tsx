import { createFileRoute } from '@tanstack/react-router';

import { partyOptions } from '../api/party.queries';
import { PartyPoster } from '../components/requests/party.poster';

export const Route = createFileRoute('/party-poster')({
    component: PartyPoster,
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(partyOptions).catch(() => undefined);
    },
});
