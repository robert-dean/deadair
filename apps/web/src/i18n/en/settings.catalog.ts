/**
 * The settings page's own words: its framing, the cards it draws beside the station's settings, and
 * what the settings form says around fields. A field's label, help, placeholder and option labels
 * come from the API in its descriptor, and stay there.
 */
export const settings = {
    apiKeys: {
        title: 'API keys',
        intro: 'For a script or an integration that should reach the station as you without your password. A key never does more than this account can, and it cannot sign in, change how you sign in, or make other keys.',
        unavailable: {
            title: 'API keys unavailable',
            fallback: "The station could not list this account's keys.",
        },
        empty: 'No keys yet. Nothing outside the console can reach the station as you.',
        column: {
            name: 'Name',
            access: 'Access',
            lastUsed: 'Last used',
            expires: 'Expires',
        },
        expiry: {
            never: 'Never',
            '30': '30 days',
            '90': '90 days',
            '365': '1 year',
        },
        never: 'Never',
        state: {
            active: 'active',
            expired: 'expired',
            revoked: 'revoked',
        },
        phone: {
            used: '{{access}} · used {{date}}',
            neverUsed: '{{access}} · never used',
        },
        issued: {
            title: {
                created: '{{name}}: key created',
                rotated: '{{name}}: new token',
            },
            body: {
                created: 'Copy it now. The station keeps only a fingerprint of it and can never show it again.',
                rotated: 'The old token has stopped working. Copy this one now; it will not be shown again.',
            },
            sendAs: 'Send it as <code>Authorization: Bearer <key></code>.',
            done: 'Done',
        },
        rotate: {
            action: 'Rotate',
            title: 'Rotate {{name}}?',
            errorTitle: 'Not rotated',
            errorFallback: 'The key still has its old token.',
            body: 'The current token stops working at once, and the new one is shown here once. Whatever uses this key needs the new token before its next request.',
        },
        revoke: {
            action: 'Revoke',
            title: 'Revoke {{name}}?',
            errorTitle: 'Not revoked',
            errorFallback: 'The key still works.',
            body: 'Every request made with this key is refused from the next one on. It stays in this list, marked revoked.',
            done: '{{name}} revoked.',
        },
        create: {
            errorTitle: 'No key created',
            errorFallback: 'The station could not create a key.',
            name: {
                label: 'New key',
                description: 'What will use it, so you can tell keys apart later',
                placeholder: 'Doorbell',
            },
            action: 'Create key',
        },
    },
    appearance: {
        title: 'Appearance',
        intro: 'Three ways to read the same console. The tally stays red in every one of them.',
        footnote: 'Remembered on this browser. Nothing else about the station changes.',
        inUse: 'in use',
    },
    languages: {
        title: 'Languages',
        intro: 'The languages the console can be shown in. A language pack is a file holding every word the console says, translated: export the English one, translate it, and import it here to make it a language every operator can choose.',
        english: {
            name: 'English',
            builtIn: 'Built in, as of console {{version}}',
            export: 'Export as a language pack',
        },
        footnote: 'This is the console’s language only. What the station broadcasts in is set under Stream.',
        listFailed: 'The languages could not be read',
        listFailedBody: 'The console is in English until the station answers.',
        installed: {
            coverage: '{{percent}}% translated',
            imported: 'Imported {{date}}',
            importedFor: 'Imported {{date}}, made for console {{madeFor}}',
            export: 'Export',
            remove: 'Remove',
            exportFailed: 'That language could not be exported',
            exportFailedBody: 'The station did not hand the pack back.',
        },
        import: {
            open: 'Import a language pack',
            title: 'Import a language pack',
            intro: 'Choose a language pack file. Nothing is installed until you have seen what this console makes of it.',
            choose: 'Choose a file',
            chooseAnother: 'Choose another file',
            unreadable: '{{name}} is not a JSON file, so it cannot be a language pack.',
            refusedTitle: 'That file cannot be installed',
            refusal: {
                'not-a-pack': '{{name}} is not a console language pack.',
                'newer-format': '{{name}} was made for a newer console. Update the station, then import it again.',
                'bad-locale': '{{name}} does not say which language it is in, as a language tag such as de or pt-BR.',
                'english-is-built-in': '{{name}} is an English pack. English is built into the console, and every other language falls back to it.',
                'no-name': '{{name}} does not give its language a name.',
                'bad-direction': '{{name}} does not say whether its text runs left to right or right to left.',
                'no-catalog': '{{name}} holds no strings.',
            },
            coverage: '{{translated}} of {{total}} strings are translated ({{percent}}%). The rest show in English.',
            rightToLeft: 'Its text runs right to left, and the console turns its layout round for it.',
            madeFor:
                'It was made for console {{madeFor}}, and this is console {{version}}. What changed since shows in English until the pack catches up.',
            replaces: 'It replaces the {{name}} pack imported {{date}}.',
            faults_one: '{{count}} string was left out and shows in English:',
            faults_other: '{{count}} strings were left out and show in English:',
            fault: {
                'not-text': 'not text',
                placeholders: 'its placeholders differ from the English',
                markup: 'its markup differs from the English',
            },
            unknown_one: '{{count}} string is for a part of the console this version has not got, and was dropped:',
            unknown_other: '{{count}} strings are for parts of the console this version has not got, and were dropped:',
            andMore_one: 'and {{count}} more',
            andMore_other: 'and {{count}} more',
            install: 'Install {{name}}',
            installNothing: 'Install',
            failedTitle: 'The language was not installed',
            failed: 'Only an admin can install a language. Nothing was changed.',
        },
        remove: {
            title: 'Remove {{name}}?',
            body: 'Anybody who has the console in {{name}} goes back to English. The pack is gone from the station, so export it first if its translator still needs it.',
            confirm: 'Remove',
            failedTitle: 'The language was not removed',
            failed: 'Only an admin can remove a language. Nothing was changed.',
        },
    },
    breakArt: {
        title: 'Break artwork',
        intro: 'What a listener’s player shows while the station is talking. A kind with no picture of its own shows the station’s logo, as the bed and off air do.',
        readFailed: 'Could not read what the station shows',
        replaceFailed: 'That picture did not go up',
        revertFailed: 'That did not go back',
        empty: {
            title: 'No pictures yet',
            body: 'The station holds no picture for any kind of break, so every break shows the station’s logo. This is what a first boot looks like before the shipped pictures have been taken in.',
        },
        alt: 'What a {{kind}} break shows',
        source: {
            shipped: 'The one this station ships',
            yours: 'Yours',
        },
        revert: {
            action: 'Put the original back',
            nothingShipped: 'This station ships no picture for that kind, so there is nothing to go back to',
        },
        drop: {
            title: 'Drop a picture here, or click to choose',
            hint: 'jpeg, png, webp or gif, up to 4 MB. A square one, since that is how a player draws it.',
        },
    },
    chatAccounts: {
        title: 'Chat accounts',
        intro: 'Link your account on a chat platform, such as Telegram, Discord or Slack, to skip a record or take the station off the air from a chat. It can do only what you can.',
        unavailable: {
            title: 'Chat accounts unavailable',
            fallback: 'The station could not list your chat accounts.',
        },
        code: {
            title: "Send this to the station's bot",
            hint: 'In a direct message, not a group. It works once, until {{date}}.',
            errorTitle: 'No code',
            errorFallback: 'The station could not make a code.',
            first: 'Link a chat account',
            again: 'New code',
        },
        link: {
            name: '{{user}} on {{platform}}',
            linked: 'Linked {{date}}',
        },
        unlink: {
            action: 'Unlink',
            title: 'Unlink {{name}}?',
            errorTitle: 'Still linked',
            errorFallback: 'The chat account is still linked.',
            body: 'Its operator commands are refused from the next one on. You can link it again with a new code.',
            done: '{{name}} unlinked.',
        },
    },
    connectedApps: {
        title: 'Connected apps',
        intro: 'Apps you have let act as you on this station, such as a Claude connector, and what each may do. To change that, disconnect it and connect it again.',
        unavailable: {
            title: 'Apps unavailable',
            fallback: 'The station could not list your connected apps.',
        },
        grant: {
            connected: '{{access}} · connected {{date}}',
            connectedUsed: '{{access}} · connected {{date}} · last used {{used}}',
        },
        disconnect: {
            action: 'Disconnect',
            title: 'Disconnect {{name}}?',
            errorTitle: 'Still connected',
            errorFallback: 'The app is still connected.',
            body: '{{name}} stops working as you straight away. You can connect it again later, and you will be asked to approve it again.',
            done: '{{name}} disconnected.',
        },
    },
    linkedSignins: {
        title: 'Linked sign-ins',
        intro: 'Sign in to this account through a provider instead of a password. Linking one sends you there to prove it is yours, and back.',
        singleSignOn: 'Single sign-on',
        linked: {
            title: 'Linked',
            body: '{{provider}} now signs you in to this account.',
        },
        linkError: {
            title: 'Not linked',
            alreadyLinked: 'That sign-in already belongs to a different account on this station, so it was not linked to yours.',
            fallback: 'That provider was not linked. Try again.',
        },
        startFailed: {
            title: 'Could not start linking',
            fallback: 'Could not reach that provider. Try again.',
        },
        none: 'No provider linked yet.',
        link: 'Link {{provider}}',
        unlink: {
            action: 'Unlink',
            title: 'Unlink {{name}}?',
            errorTitle: 'Still linked',
            errorFallback: 'The provider is still linked.',
            body: '{{name}} will stop signing you in to this account. You can link it again afterwards.',
            done: '{{name}} unlinked.',
        },
    },
    oauthClients: {
        title: 'Registered apps',
        intro: 'Apps allowed to ask somebody here for access. Registering one gives it nothing until a person approves it.',
        unavailable: {
            title: 'Apps unavailable',
            fallback: 'The station could not list its apps.',
        },
        none: 'None yet.',
        method: {
            none: 'No secret (an app on somebody’s own device)',
            client_secret_post: 'Keeps a secret, sent in the request',
            client_secret_basic: 'Keeps a secret, sent as HTTP Basic',
        },
        issued: {
            title: '{{name}}: registered',
            clientId: 'Client id',
            clientSecret: 'Client secret. This is the only time it is shown: copy it now.',
            done: 'Done',
        },
        kind: {
            dynamic: 'registered itself',
            manual: 'registered here',
        },
        lastUsed: 'Last used {{date}}',
        neverUsed: 'Never used',
        lapses: ' · lapses {{date}} unless used again',
        withdraw: {
            action: 'Withdraw',
            title: 'Withdraw {{name}}?',
            errorTitle: 'Not withdrawn',
            errorFallback: 'The app is still registered.',
            body: 'Everybody who approved {{name}} is disconnected from it, and every token it holds stops working. An app that registers itself can register again, and somebody will have to approve it again.',
            done: '{{name}} withdrawn.',
        },
        create: {
            heading: 'Register an app by hand',
            errorTitle: 'Not registered',
            errorFallback: 'The station did not register it.',
            name: 'Name',
            redirects: {
                label: 'Where it may be sent back to',
                description: "One address per line: https, or this computer's own (http://127.0.0.1/…).",
            },
            secret: 'Secret',
            action: 'Register',
        },
    },
    pluginGrants: {
        title: 'What plugins have asked for',
        intro: 'A plugin reaches only what its manifest names and what you gave it. These are the things one has asked for on top of that. Nothing here is allowed until you say so, and a decision takes effect on the plugin’s next request.',
        unavailable: {
            title: 'Requests unavailable',
            fallback: 'The station could not read what its plugins have asked for.',
        },
        column: {
            plugin: 'Plugin',
            askedFor: 'Asked for',
            answer: 'Answer',
        },
    },
    providerPick: {
        label: 'Doing this job',
        automatic: 'Automatic',
        automaticCurrently: 'Automatic (currently {{name}})',
        notRunning: '{{name}} (not running)',
        notInstalled: '{{name}} (not installed)',
        unanswered: {
            title: 'Nothing is doing this job',
            body: '{{name}} is named here and is not running, and naming a plugin means the station uses that one or none. Choose one that is running, or set this back to Automatic.',
        },
        saved: 'The plugin',
        idle: {
            enabled: 'switched on and not answering',
            disabled: 'not switched on',
        },
    },
    providerRanking: {
        saved: 'The order',
        theirs: 'Your order',
        default: 'Default order',
        staleCount_one: '{{count}} listed plugin is not running',
        staleCount_other: '{{count}} listed plugins are not running',
        idle: {
            enabled: 'switched on and not answering, so it is not asked',
            disabled: 'not switched on, so it is not asked',
        },
        staleNames: 'Your saved order also names {{names}}, which nothing installed answers to. It is ignored. Saving this list again drops it.',
        save: 'Save order',
        reset: 'Reset to default',
    },
    providers: {
        unavailable: {
            title: 'Providers unavailable',
            fallback: 'The station could not say which plugins do what.',
        },
        empty: {
            title: 'Nothing to choose between yet',
            body: 'No installed plugin does a job another one could do. Install a second plugin that can speak, write, or say who sounds like whom, and the choice appears here.',
        },
        fallback: {
            meaning: 'Which plugin the station uses for this.',
            only: 'Only {{name}} can do this, so there is nothing to choose.',
        },
        // What each contested capability is called, and what the choice actually changes. The
        // station's vocabulary rather than the SDK's: an operator came here to decide who speaks,
        // not to configure the `speech` capability.
        capability: {
            speech: {
                title: 'Speaking',
                meaning: 'The voice the station talks in. One plugin does it: two engines rendering one break would be two breaks.',
                only: 'Only {{name}} can speak, so there is nothing to choose.',
            },
            llm: {
                title: 'Writing',
                meaning: 'Which plugin the station asks for words. One plugin does it, since two models writing one line is one wasted generation.',
                only: 'Only {{name}} can write, so there is nothing to choose.',
            },
            mixer: {
                title: 'Joining audio',
                meaning:
                    'Which plugin makes one piece of audio out of several. Its own choice, so a station can measure with one engine and join with another.',
                only: 'Only {{name}} can join audio, so there is nothing to choose.',
            },
            analysis: {
                title: 'Measuring records',
                meaning:
                    'Which plugin measures records, so the station can trim the dead air off each one and know how long it may talk over an intro.',
                only: 'Only {{name}} can measure records, so there is nothing to choose.',
            },
            similarity: {
                title: 'Who sounds like whom',
                meaning:
                    'Every source is asked who resembles an artist and the answers are pooled, because two sources disagreeing about that are not in conflict. What to PLAY by an artist, and what sounds like a particular record, take the first usable answer — so this order decides whose judgement airs.',
                only: 'Only {{name}} can say who sounds like whom, so there is nothing to order.',
            },
            weather: {
                title: 'The weather',
                meaning:
                    'The station asks in this order and reads out the first forecast it gets, because two services asked about one sky are two readings of the same thing rather than two facts.',
                only: 'Only {{name}} can report the weather, so there is nothing to order.',
            },
            charts: {
                title: 'Charts',
                meaning:
                    'Every service’s charts stay on the menu whatever this says — two top forties are two published documents. This sets the order they appear in, and decides outright which service answers when a chart is asked for by style.',
                only: 'Only {{name}} publishes charts, so there is nothing to order.',
            },
            enrichment: {
                title: 'What the station believes about a record',
                meaning:
                    'Every source is asked about a record and the answers are merged field by field, so this decides who wins where two of them disagree about a year, a label or a running time. Each plugin declares how much to trust it; this overrides that with what you can see on your own library.',
                only: 'Only {{name}} fills in details about records, so there is nothing to order.',
            },
        },
    },
    security: {
        title: 'How you sign in',
        intro: 'With an authenticator enrolled, every sign-in to this account asks for its code after the password. Lose the phone and the README says how to get back in from the box.',
        unavailable: {
            title: 'Sign-in methods unavailable',
            fallback: 'The station could not read how you sign in.',
        },
        noAuthenticator: 'No authenticator yet. Sign-in is the password alone.',
        factor: {
            authenticator: 'Authenticator',
            password: 'Password',
            email: 'Email',
            emailLabelled: 'Email, {{label}}',
            passkey: 'Passkey',
            phone: 'Phone',
            oidc: 'Single sign-on',
            oidcLabelled: '{{label}} sign-in',
        },
        authenticatorBadge: 'authenticator',
        remove: {
            action: 'Remove',
            title: 'Remove {{name}}?',
            errorTitle: 'Not removed',
            errorFallback: 'The authenticator is still enrolled.',
            body: 'Codes from this app will stop being accepted. If it is the last authenticator on the account, sign-in goes back to the password alone.',
            bodyPending: 'Codes from this app will stop being accepted. ',
            done: '{{name}} removed.',
        },
        notEnrolled: 'Not enrolled',
        authenticator: {
            title: 'Add an authenticator',
            intro: 'Any app that shows six-digit codes: Google Authenticator, 1Password, Aegis. Scan the code, then enter the first number it shows.',
            startFailed: 'Could not start',
            startFallback: 'The station could not start an enrolment.',
            qrAlt: 'Authenticator QR code',
            byHand: 'Or enter this key by hand:',
            firstCode: 'First code',
            verify: 'Verify and enrol',
            label: {
                label: 'Label',
                description: 'So you can tell this one apart later',
                placeholder: 'Phone',
            },
            showQr: 'Show QR code',
            saved: 'Authenticator',
        },
        email: {
            title: 'Add an email address',
            intro: 'An address the station can reach you at: it can send a code or a sign-in link there, and offer it as the second step after your password. The station emails a code to prove the address is yours before anything is saved.',
            sendFailed: 'No code sent',
            sendFallback: 'The station could not send a code to that address.',
            openMail: 'Open mail settings',
            sent: 'We sent a code to {{address}}.',
            code: 'Emailed code',
            resend: 'Send it again',
            verify: 'Verify and add',
            address: {
                label: 'Email address',
                description: 'Where the station sends codes and sign-in links',
                placeholder: 'you@example.com',
            },
            send: 'Send code',
            saved: 'Email address',
        },
    },
    page: {
        noSection: {
            title: 'No such section',
            body: 'Settings has no section called {{id}}.',
        },
        security: {
            account: 'Your account',
            station: 'The station',
            everyone: 'Sign-in for everyone',
        },
        unfinished: {
            title: 'Nothing here yet',
            body: 'This section is in the list but has nothing to draw yet.',
        },
        unavailable: {
            title: 'Settings unavailable',
            fallback: 'The station settings could not be read.',
        },
        emptyGroup: {
            title: 'No {{name}} settings yet',
            body: 'Nothing declares a setting in this section yet.',
        },
        save: {
            label: 'Save {{name}}',
            failureTitle: 'Save failed',
            failureMessage: 'The settings could not be saved.',
        },
    },
    signinCheck: {
        title: 'Do they answer?',
        intro: 'The station asks each provider for its sign-in details, the way the sign-in page will, whenever this list is saved.',
        again: 'Check again',
        failed: {
            title: 'Not checked',
            fallback: 'The station could not check its providers.',
        },
        notOffered: 'Not offered',
        answers: 'Answers',
        noAnswer: 'No answer',
    },
    shell: {
        allSettings: 'All settings',
        title: 'Settings',
        intro: 'The station itself, and the plugins it runs. Every section saves on its own, and nothing here can clear another. What plays between blocks is on Programme instead, beside the timetable that makes sense of it.',
    },
    // Each section of Settings: its name, the line under it in the rail and the phone's list, and,
    // for a section that draws a group, the sentence under its heading.
    sections: {
        station: {
            label: 'Station',
            hint: 'Its name, where it is and its clock',
            blurb: 'What the station is called, where it is, and the clock it tells the time by. Icecast reads the name from a file rendered on save, so a new one reaches the stream on its next restart.',
        },
        stream: {
            label: 'Stream',
            hint: 'What puts it on air, in what formats',
            blurb: 'The mounts the station publishes to: their formats and bitrates, HLS, how Icecast describes the station to players and directories, and the Icecast connection they all go through. Icecast and Liquidsoap read these from files rendered on save, so a change reaches them on their next restart.',
        },
        housekeeping: {
            label: 'Housekeeping',
            hint: 'How long it keeps its own history',
            blurb: 'How long the station keeps its own history, and how much of a library sync it will trust before it refuses rather than throwing the rest away.',
        },
        mail: {
            label: 'Mail',
            hint: 'Where it sends sign-in codes from',
            blurb: 'The mail server the station signs people in through. Without one it cannot send a code or a sign-in link, and it says so rather than failing quietly.',
        },
        appearance: {
            label: 'Appearance',
            hint: 'How the console looks, on this browser',
        },
        languages: {
            label: 'Languages',
            hint: 'What the console can be shown in, and the file a translation starts from',
        },
        security: {
            label: 'Sign-in and security',
            hint: 'How you sign in, and how everybody else may',
            blurb: 'The identity providers the sign-in page offers beside a password, such as Authelia, Authentik, Keycloak or Google, and the addresses allowed to create an account through one. Anyone who already has an account can sign in through a provider linked to it whatever the list says. Below them, whether apps such as a Claude connector may connect to the station as whoever approves them.',
        },
        rotation: {
            label: 'Rotation',
            hint: 'What it plays, and how often it repeats',
            blurb: 'How the station programmes itself when nothing more specific is asked for: how soon a record or an artist may come back, how long a record may be, and where each batch comes from. A lineup can override the spacing rules for itself, and a setlist or a feature ignores all of them.',
        },
        breaks: {
            label: 'Breaks',
            hint: 'How often it talks, and for how long',
            blurb: 'How often the station talks between records and how long it may go on: breaks, jingles, calls, the welcome for a new listener and the word when the show changes. A lineup can override whether it talks and how often, and a setlist or a feature switches all of it off. What it says is under Voice.',
        },
        bulletins: {
            label: 'Bulletins',
            hint: 'What it reads of the news, the weather and the date',
            blurb: 'What goes into a news bulletin, a weather report and a reading of the date, and whether the presenter may bring the weather or the date up between records. When a bulletin airs is the format clock, under Programme; the words around it are under Voice.',
        },
        playout: {
            label: 'Playout',
            hint: 'What puts it on air',
            blurb: 'What puts the station on air.',
        },
        render: {
            label: 'Voice and audio',
            hint: 'How it speaks, and how a programme is assembled',
            blurb: 'How the station speaks, and how a programme written in parts is put together.',
        },
        llm: {
            label: 'Words',
            hint: 'What it writes, and which model writes it',
            blurb: 'What the station writes for itself and which model writes each of them. WHICH plugin it asks is under Providers; with none set up it still writes its own breaks, from what is either side of them in the running order.',
        },
        analysis: {
            label: 'Measurement',
            hint: 'How much of the library it measures at once',
            blurb: 'How widely the station measures its records, so it can trim the dead air off each one and know how long it may talk over an intro. WHICH plugin measures them is under Providers; with none set up every track still plays, unmeasured.',
        },
        artwork: {
            label: 'Artwork',
            hint: "The pictures a listener's player shows",
        },
        storage: {
            label: 'Storage',
            hint: 'What the caches are holding',
        },
        providers: {
            label: 'Providers',
            hint: 'Who does what, and who is asked first',
            blurb: 'The jobs more than one of your plugins can do, and which of them the station uses. Nothing here switches a plugin on or off: that is the Plugins page, and this decides what the station does with the ones that are running.',
        },
        grants: {
            label: 'Waiting on you',
            hint: 'What plugins have asked for',
        },
        plugins: {
            label: 'Plugins',
            hint: 'What the station runs, and what they have asked for',
        },
    },
    // What a refused one-time code is told, by the enrolment cards and the re-verify dialog alike.
    code: {
        invalid: 'That code was not accepted. Wait for the next one and try again.',
        rateLimited: 'Too many attempts. Wait a moment and try again.',
        rateLimitedFor_one: 'Too many attempts. Try again in {{count}} second.',
        rateLimitedFor_other: 'Too many attempts. Try again in {{count}} seconds.',
        fallback: 'Could not check that code. Try again.',
    },
    stepUp: {
        title: 'Confirm it is you',
        intro: 'Enter the code from your authenticator app to make this change.',
        startFailed: {
            title: 'Could not start',
            fallback: 'The station could not issue a challenge.',
        },
        nothing: {
            title: 'Nothing to verify with',
            body: 'This account has no authenticator this console can ask for.',
        },
        notVerified: 'Not verified',
        which: 'Which authenticator',
        authenticator: 'Authenticator',
        code: 'Authenticator code',
        verify: 'Verify',
    },
    unsaved: {
        title: 'Discard unsaved changes?',
        confirm: 'Discard changes',
        body: 'Something on this page has been changed and not saved. Leaving now throws it away. Every section saves on its own, so saving here will not touch anything else.',
    },
    storage: {
        title: 'Disk',
        intro: 'What the station is keeping, and where. Records are the only one with a limit; the rest grow with the library and with how much the station has said.',
        unavailable: {
            title: 'Disk figures unavailable',
            fallback: 'The station could not read what is on disk.',
        },
        everything: 'Everything',
        totals_one: '{{bytes}} · {{count}} file',
        totals_other: '{{bytes}} · {{count}} files',
        files_one: '{{count}} file',
        files_other: '{{count}} files',
        column: {
            store: 'Store',
            onDisk: 'On disk',
            files: 'Files',
            unclaimed: 'Unclaimed',
        },
        footnote:
            'Read {{time}}. Walking the directories is real work, so this is a reading rather than a live figure. Nothing here is deleted automatically: a file no row claims and a record whose file has gone are both reported and left alone.',
        share: {
            label: 'Share of the limit in use',
            of: '{{used}}% of {{cap}}',
        },
        missing: {
            tooltip: 'Rows pointing at a file that is not there. The station fetches or renders these again when it needs them.',
            count: '{{rows}} missing',
        },
        unclaimed: {
            tooltip: 'Files no row claims — usually left by a write that was interrupted. Nothing deletes them.',
            amount: '{{bytes}} unclaimed',
        },
    },
    // What the settings form says around the fields it draws. A field's own label, help,
    // placeholder and options arrive from the API in its descriptor and are not here.
    form: {
        required: 'This is required',
        derived: 'Using {{value}} while this is empty.',
        removeTag: 'Remove {{tag}}',
        refresh: 'Refresh options',
        saved: 'Saved.',
        rows: {
            empty: 'Nothing here yet.',
            row: 'Row {{number}}',
            rowName: 'row {{number}}',
            notApplicable: '{{column}} does not apply to row {{number}}',
            add: 'Add',
            somethingElse: 'Something else',
            moveUp: 'Move {{name}} up',
            moveDown: 'Move {{name}} down',
            remove: 'Remove {{name}}',
        },
        bytes: {
            noLimit: 'No limit',
        },
        secret: {
            willBeRemoved: 'Will be removed when you save.',
            stored: 'Stored — leave blank to keep it.',
            keep: 'Keep the stored value',
            clear: 'Clear the stored value',
        },
        cellSecret: {
            keepLabel: 'Keep the stored {{column}}',
            clearLabel: 'Clear the stored {{column}}',
            willBeRemoved: 'Will be removed — keep it instead',
            stored: 'Stored — clear it',
        },
    },
} as const;
