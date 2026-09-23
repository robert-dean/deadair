import { createFileRoute } from '@tanstack/react-router';

import { OAuthConsentPage } from '../../components/auth/oauth.consent.page';

export const Route = createFileRoute('/oauth/authorize')({ component: OAuthConsentRoute });

/**
 * Where an app sends somebody to approve it. Gated like any other page, so a visitor who is not
 * signed in goes through the sign-in page and comes back here with the app's query intact.
 *
 * The query is read raw off the address bar rather than through the router's search, because it is
 * the app's, passed through to the station whole: the router would parse its values as JSON.
 */
function OAuthConsentRoute() {
    return <OAuthConsentPage query={window.location.search} />;
}
