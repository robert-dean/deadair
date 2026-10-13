/**
 * The invite page, where somebody who was invited makes their account. Read by `src/invite`, a page
 * of its own beside the console, as the party page is.
 */
export const invite = {
    title: 'You have been invited',
    intro: 'Somebody who runs this station has invited you to have an account on it. Nothing happens until you press the button.',
    open: 'Accept the invitation',
    opening: 'Reading your invitation…',
    noToken: {
        title: 'This link is incomplete',
        body: 'The part after the # is missing. Open the link exactly as it was sent to you.',
    },
    gone: {
        title: 'This invitation is not open',
        body: 'It may have been used already, withdrawn, or run out of time. Ask whoever invited you to send a new one.',
    },
    taken: {
        title: 'That address already has an account',
        body: 'Sign in to the station with it instead.',
    },
    unreachable: 'The station did not answer. Check your connection and try again.',
    retry: 'Try again',
    role: {
        admin: 'You are invited to run {{station}}: everything in its console is yours to change.',
        listener: 'You are invited to listen to {{station}}, ask for records and read the words of what is playing, from its apps.',
    },
    account: {
        title: 'Your account',
        email: 'Address',
        emailHelp: 'The address you were invited at. You can add another once you are in.',
        password: 'Choose a password',
        passwordConfirm: 'The same password again',
        mismatch: 'The two passwords are not the same.',
        tooShort: 'At least 8 characters.',
    },
    secondStep: {
        title: 'Your second step',
        intro: 'After your password, the station asks for something only you have.',
        authenticator: 'Authenticator app',
        authenticatorHelp: 'A six-digit code from an app such as Google Authenticator, 1Password or Aegis. The phone apps need this one.',
        passkey: 'Passkey',
        passkeyHelp:
            'Touch ID, Face ID, Windows Hello, your phone or a security key: one touch, in a browser. The phone apps still need an authenticator, so add one later if you will use them.',
        continue: 'Continue',
    },
    authenticator: {
        title: 'Scan this code',
        intro: 'Open your authenticator app, add an account, and scan the code. Then enter the first number it shows.',
        qrAlt: 'Authenticator QR code',
        byHand: 'Or enter this key by hand:',
        code: 'First code',
        finish: 'Create my account',
        refused: 'That code was not accepted. Wait for the next one and try again.',
    },
    passkey: {
        title: 'Create your passkey',
        intro: 'Your browser will ask how you want to keep it: on this device, on your phone, or on a security key.',
        create: 'Create passkey and my account',
        refused: 'The passkey was not accepted. Try again.',
    },
    back: 'Back',
    failed: 'Your account was not created',
    fallback: 'Something went wrong. Nothing was saved, and your invitation still works.',
    done: {
        title: 'You are in',
        signInAs: 'Sign in as {{email}} with your password and your second step.',
        listener: {
            app: 'Open the station in the deadair app',
            appHelp: 'If you have the app on this device, this adds the station to it. Sign in from its settings.',
            stream: 'Or listen in your browser',
        },
        admin: {
            console: 'Open the console',
        },
    },
} as const;
