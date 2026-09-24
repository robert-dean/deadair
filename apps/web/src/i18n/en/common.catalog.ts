/**
 * The shared components' words: the ones every page borrows (Cancel, Dismiss, Try again) and the
 * framing the console puts around a failure it did not write.
 */
export const common = {
    action: {
        cancel: 'Cancel',
        dismiss: 'Dismiss',
        tryAgain: 'Try again',
        tryNow: 'Try now',
        loadOlder: 'Load older',
        backToDesk: 'Back to the desk',
    },
    copy: {
        copy: 'Copy',
        copied: 'Copied',
        failed: 'Copy failed',
        failedHint: 'This browser would not copy it. It is selected below, so copy it with your keyboard instead.',
        textToCopy: 'Text to copy',
    },
    confirm: {
        errorTitle: 'That could not be done',
        errorFallback: 'Nothing was changed.',
    },
    notify: {
        saved: '{{what}} saved.',
    },
    statusLamp: {
        label: 'Status: {{label}}',
    },
    feed: {
        failedTitle: 'Nothing to show',
    },
    oneTimeCode: {
        label: 'Code',
        placeholder: '123456',
    },
    apiStatus: {
        title: "Can't reach the station",
        stale: 'Anything on screen may be out of date.',
        trying: 'Trying now…',
        retryIn: 'Trying again in {{seconds}}s.',
    },
    routeError: {
        offlineTitle: 'This page could not be loaded',
        title: 'This page did not load',
        offline: 'The station is not answering. It may be restarting — the console is already trying again.',
        fallback: 'Something in this page failed while it was loading.',
        showDetail: 'Show technical detail',
        hideDetail: 'Hide technical detail',
    },
} as const;
