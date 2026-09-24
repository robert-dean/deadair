/** What the route files draw themselves: the shell's chrome in `__root.tsx`, and the pending screens. */
export const routes = {
    root: {
        skipToContent: 'Skip to content',
        wordmark: 'deadair',
        jumpTo: 'Jump to anything',
        signOutIncompleteTitle: 'Sign-out incomplete',
        revokeFailed: 'You were signed out on this device, but the server did not confirm the session was revoked.',
        revokeFailedWithDetail: 'You were signed out on this device, but the server did not confirm the session was revoked. ({{detail}})',
    },
    authCallback: {
        title: 'Signing you in',
        wait: 'One moment.',
    },
    pluginOAuth: {
        title: 'Authorization',
        completing: 'Completing the connection…',
    },
} as const;
