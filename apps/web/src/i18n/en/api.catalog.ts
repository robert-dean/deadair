/**
 * The sentences the API layer hands a page when the station did not supply its own: the fallbacks
 * for a failed call and the outcomes of a sign-in link.
 */
export const api = {
    authCallback: {
        refused: 'That sign-in was refused.',
        missingToken: 'That link is missing the part that proves who you are. Ask for a new one.',
        missingChallenge: 'That link is missing its challenge id. Ask for a new one.',
        spent: 'That link has already been used, or it has expired. Ask for a new one.',
        fallback: 'Could not finish signing you in. Try again.',
    },
    plugins: {
        enabled: '{{name}} enabled. It reloads on its own.',
        disabled: '{{name}} disabled. It reloads on its own.',
        oauthFallback: 'The authorization could not be completed.',
    },
} as const;
