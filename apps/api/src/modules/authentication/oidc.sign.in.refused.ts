/**
 * Why a sign-in through an identity provider was turned away, as the code the console is sent back
 * with and the sentence it shows.
 *
 * - `not_allowed`: nobody has an account for this identity, and the allowlist does not name its
 *   address or domain (or the provider did not vouch for the address at all).
 * - `email_unverified`: an account with this address exists, but the provider does not say the
 *   address is verified, so the station will not hand that account to whoever holds the identity.
 * - `already_linked`: the identity already belongs to a different account here.
 */
export type OidcSignInRefusal = 'not_allowed' | 'email_unverified' | 'already_linked';

const DESCRIPTIONS: Record<OidcSignInRefusal, string> = {
    not_allowed: 'That account is not allowed to join this station. Ask whoever runs it to add your address to the sign-in list.',
    email_unverified:
        'An account with that address already exists, but the provider did not confirm the address is yours. Sign in another way, then link the provider from Security.',
    already_linked: 'That sign-in is already linked to a different account on this station.',
};

/** Thrown inside the OIDC callback and turned into `?error=<code>&error_description=<sentence>`. */
export class OidcSignInRefused extends Error {
    constructor(readonly code: OidcSignInRefusal) {
        super(DESCRIPTIONS[code]);
        this.name = 'OidcSignInRefused';
    }

    get description(): string {
        return DESCRIPTIONS[this.code];
    }
}
