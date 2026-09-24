/** Productions: programmes the station writes for itself, how far along each is, and the form that asks for one. */
export const productions = {
    title: 'Productions',
    description:
        'Programmes the station writes for itself: several beats of speech, made over minutes and aired as one block. Asking for one queues it — nothing is made while you wait, and it goes into the running order once every beat has been spoken.',
    ask: 'Ask for one',
    stop: 'Stop',
    error: {
        list: 'Could not read what the station is making',
        cancel: 'Could not stop that production',
    },
    empty: {
        title: 'The station has not made anything yet',
        body: 'Ask for one above, or put a line like <code>21:00 podcast</code> on the station clock and one is commissioned ahead of every slot.',
    },
    /** What the badge says. Plain words rather than the state name, which is the machine's vocabulary. */
    state: {
        planned: 'queued',
        outlining: 'planning it',
        drafting: 'writing it',
        checking: 'checking it',
        rendering: 'speaking it',
        stitching: 'joining it up',
        ready: 'ready',
        aired: 'in the running order',
        failed: 'failed',
        cancelled: 'stopped',
    },
    cast: {
        joiner: ' and ',
        hostWithCallers: 'presented by {{host}}, with {{callers}}',
        host: 'presented by {{host}}',
        callers: 'with {{callers}}',
        voices_one: '{{count}} voice',
        voices_other: '{{count}} voices',
    },
    describe: {
        minutes_one: 'about {{count}} minute',
        minutes_other: 'about {{count}} minutes',
        mode: '{{mode}} write',
        beats_one: '{{count}} beat written',
        beats_other: '{{count}} beats written',
        due: 'due {{when}}',
    },
    form: {
        error: 'Could not ask for that production',
        title: {
            label: 'Called',
            description: "What this one is, for the console and for its beats' own labels.",
            placeholder: 'The machine nobody wanted',
            required: 'Give it a name',
        },
        brief: {
            label: 'What it should be about',
            description: 'In your own words. This is what the planning pass actually works from, and it matters far more than the title does.',
            placeholder: 'The history of the TR-808: why it flopped, who rescued it, and what it did to pop music.',
        },
        kind: {
            label: 'Kind',
            description: 'Free text, and what a clock band names.',
        },
        minutes: {
            label: 'Minutes',
            description: "Leave empty for the station's default. This decides how many beats it has.",
        },
        mode: {
            label: 'How much to write it',
            description: "Leave empty for the station's default.",
            option: {
                quick: 'Quick — one draft per beat',
                outlined: 'Outlined — plan it, then write it',
                polished: 'Polished — plan, write, then check and fix',
            },
        },
        presenter: {
            label: 'Presenter',
            description: 'Leave empty and whoever is on air when a pass runs presents it.',
        },
        submit: 'Ask for it',
    },
} as const;
