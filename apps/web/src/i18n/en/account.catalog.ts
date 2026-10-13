/**
 * The console for somebody without the admin role: their own account, and how to listen. Read by
 * `components/account`.
 */
export const account = {
    title: 'Your account',
    intro: 'This console is where the station is run, and your account is for listening. Here you can change how you sign in; everything else is in the apps.',
    listen: {
        title: 'Listen',
        app: 'Open the station in the deadair app',
        appHelp: 'If you have the app on this device, this adds the station to it. Sign in from its settings to ask for records.',
        stream: 'Or listen in your browser',
    },
    signOut: 'Sign out',
} as const;
