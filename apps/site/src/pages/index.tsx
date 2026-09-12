import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import { ChipList } from '../components/chip.list';
import { ConsoleTour, type TourStop } from '../components/console.tour';
import { FeatureRow } from '../components/feature.row';
import { Figure } from '../components/figure';
import styles from './index.module.css';

const repository = 'https://github.com/robert-dean/deadair';
const playStore = 'https://play.google.com/store/apps/details?id=com.maroonedsoftware.deadair';

/** The four facts worth reading before anything else, as a strip under the hero's buttons. */
const facts = ['Self-hosted', 'Your music', 'Any model, or none', 'MIT licensed'];

/** The rest of the console, after the six parts have shown the pages they are about. */
const tour: TourStop[] = [
    {
        shot: 'catalogTracks',
        title: 'The library',
        body: 'Every record the station has taken in, how many are ready to air right now, and what it thinks of each one. A thumb down on a record, an album or an artist is a veto no lineup can turn off.',
    },
    {
        shot: 'plugins',
        title: 'The plugins',
        body: 'Where the music, the facts, the weather, the voices and the model come from. Each says what it will talk to, and anything more it asks for waits for you.',
    },
    {
        shot: 'activity',
        title: 'What happened',
        body: 'What aired, what was written and spoken, and every break that fell through to the floor and why, newest first.',
    },
    {
        shot: 'settingsLlm',
        title: 'Which model does which job',
        body: 'Writing a break and programming an hour are different sizes of task, so each has its own model. Leave them empty and the station still talks.',
    },
];

/** What the station can use for words and a voice, as the plugins that ship with it reach them. */
const models = ['Ollama', 'vLLM', 'OpenAI', 'Groq', 'Mistral', 'OpenRouter', 'Anthropic', 'Gemini', 'Any OpenAI-compatible server'];
const voices = ['Kokoro', 'Chatterbox', 'Any OpenAI-compatible speech server'];
const sources = [
    'MusicBrainz',
    'Last.fm',
    'Wikipedia',
    'RSS',
    'SearXNG',
    'Brave Search',
    'Tavily',
    'Open-Meteo',
    'US National Weather Service',
    'OpenWeatherMap',
];
const providers = ['Spotify', 'Navidrome', 'Any Subsonic server'];

/** The three images, as the install guide lists them. */
const tags = [
    { tag: 'full', brings: 'A voice, PostgreSQL and Redis', bring: 'Nothing. Start here on an empty machine.' },
    { tag: 'latest', brings: 'A voice', bring: 'PostgreSQL and Redis you already keep backups of.' },
    { tag: 'slim', brings: 'The station alone', bring: 'PostgreSQL, Redis and a speech server, ideally on a GPU.' },
];

const diagram = `                  your provider                    a model             a voice
              (Spotify / Navidrome)             (local or hosted)   (Kokoro / Chatterbox)
                       │                               │                    │
                       └───────────── plugins ─────────┴────────────────────┘
                                         │
    ┌────────────────────────────────────┴─────────────────────────────────┐
    │  the station (Node)                                                  │
    │    director ── one running order, and the only thing that writes it  │
    │    render   ── words, then audio, one state per stage                │
    │    playout  ── hands records over, one at a time, and holds a lease  │
    └────────────────────────────────────┬─────────────────────────────────┘
                                         │  HTTP
                  ┌──────────────────────┼──────────────────────┐
             Liquidsoap              PostgreSQL              analysis
          (mixing, on air)        (everything kept)      (cue points, loudness)
                  │
               Icecast ──────────────►  /live.mp3  (plus Opus/AAC/FLAC and HLS, opt-in)`;

export default function Home() {
    return (
        <Layout description="deadair picks the records, writes what the presenter says between them, speaks it, and streams the result. Self-hosted and MIT licensed.">
            <main className={styles.page}>
                <header className={styles.hero}>
                    <p className="da-eyebrow">Self-hosted AI radio</p>
                    <h1 className={styles.headline}>An AI radio station you run yourself.</h1>
                    <p className={styles.lede}>
                        It picks the records, writes what the presenter says between them, speaks it in that presenter’s voice, and streams the
                        result. One mount, one running order, and everybody hears the same thing at the same moment.
                    </p>
                    <div className={styles.actions}>
                        <Link className={styles.primary} to="/docs/install">
                            Install it
                        </Link>
                        <Link className={styles.secondary} to="/docs/features">
                            What it does
                        </Link>
                        <Link className={styles.secondary} href={repository}>
                            Read the source
                        </Link>
                    </div>
                    <ul className={styles.facts}>
                        {facts.map(fact => (
                            <li key={fact}>{fact}</li>
                        ))}
                    </ul>
                </header>

                <div className={styles.showcase}>
                    <Figure shot="desk" number={1} caption="The Desk, on air" eager />
                </div>

                <section className={styles.statement}>
                    <h2>A radio station, not a playlist.</h2>
                    <p>
                        There is no per-listener shuffle and no skip button. What is on is what is on, and the station decides. You run it from a
                        desk, and everybody else hears it.
                    </p>
                </section>

                <FeatureRow
                    part="Part one"
                    kicker="The running order"
                    title="One thing owns what plays next."
                    figure={<Figure shot="desk" number={2} caption="The running order, several hours deep" aspect={16 / 7} focus="left bottom" />}
                >
                    <p>
                        Not a queue that gets topped up. A forward lineup several hours deep that you can see and edit, where every record and every
                        break carries its own state. The console, the schedule and the model all ask one part of the station to change it, and that
                        part is the only thing that writes it. So an edit made at 3pm is still true at 3.05.
                    </p>
                    <p>
                        Tell it what you want in a sentence, “rap like snoop dog”, and it programmes the next hours to that brief. Ask it why the
                        record on air is on air and it will say. Nothing is committed to air until its audio is on the machine, so the stream never
                        waits on a download.
                    </p>
                </FeatureRow>

                <FeatureRow
                    part="Part two"
                    kicker="The programme"
                    title="Which hour is which."
                    side="right"
                    figure={<Figure shot="scheduleToday" number={3} caption="The format clock" aspect={16 / 9} focus="left 60%" />}
                >
                    <p>
                        The format clock is what the station says inside an hour, whatever it is playing: the weather at five past, the news at half
                        past. A band takes the first boundary at or after its time, so nothing is ever cut off mid-record.
                    </p>
                    <p>
                        Above it, a weekly timetable of blocks, each with its own brief and its own presenter, and a sustaining setting for whatever
                        nobody scheduled. A station with no schedule at all is an ordinary station: it keeps playing what you put on until you put
                        something else on.
                    </p>
                </FeatureRow>

                <FeatureRow
                    part="Part three"
                    kicker="The presenter"
                    title="A model cannot make it go quiet."
                    figure={<Figure shot="voiceSaid" number={4} caption="Every break written, and every one declined" />}
                >
                    <p>
                        The presenter talks between records using a local or hosted model when one is configured. When there is none, when it is slow,
                        or when what it wrote failed a check, the station falls back on its own phrasings. That floor cannot fail, which is the whole
                        design.
                    </p>
                    <p>
                        Every attempt is kept, the declined ones too, with the reason. One here was turned down because{' '}
                        <strong>the model said “tonight” at seven in the morning</strong>, which a listener hears immediately and the station cannot
                        take back.
                    </p>
                </FeatureRow>

                <FeatureRow
                    part="Part four"
                    kicker="The facts"
                    title="True, or nothing."
                    side="right"
                    figure={<Figure shot="catalogTrack" number={5} caption="One record, and what the station knows about it" />}
                >
                    <p>
                        Every fact the presenter mentions about a record is a stored claim with the sentence of source prose behind it. A claim with
                        no source cannot be written down at all. The alternative is a presenter saying something specific, checkable and untrue in
                        exactly the voice it uses for things that are true.
                    </p>
                    <p>
                        It also knows what the record sounds like. A measurement sidecar decodes each one for its cue points and its loudness, so the
                        silence at its head and tail is trimmed before the player ever sees it.
                    </p>
                </FeatureRow>

                <FeatureRow
                    part="Part five"
                    kicker="The characters"
                    title="Presenters that accumulate."
                    figure={<Figure shot="voiceCharacters" number={6} caption="The roster" />}
                >
                    <p>
                        Who is presenting is a character with a voice, a diction, how much rope it is given and how brief it is. It keeps a notebook
                        of what it has said and the traits it is growing into, and a set of stories it can tell on air.
                    </p>
                    <p>A show can hand the hour to a different character, and you can rehearse one over an hour of records before it goes on air.</p>
                </FeatureRow>

                <FeatureRow
                    part="Part five, continued"
                    kicker="Phone-ins"
                    title="It can take a call."
                    side="right"
                    figure={<Figure shot="voiceProductions" number={7} caption="Phone-ins the station wrote for itself" />}
                >
                    <p>
                        A phone-in is a produced block in the middle of a broadcast. A caller and the host trade turns, each turn its own model call
                        in its own voice, and the whole thing is joined into one piece of audio before it airs.
                    </p>
                    <p>Nothing is made while you wait. It goes into the running order once every beat has been spoken.</p>
                </FeatureRow>

                <FeatureRow
                    part="Part six"
                    kicker="The check-up"
                    title="It says why it is quiet."
                    figure={<Figure shot="checkup" number={8} caption="The machinery, in one place" />}
                >
                    <p>
                        Eleven ordered checks over one snapshot answer “why is nothing playing” with a single verdict, and the answer is written to
                        the station’s own log. So “why was it silent at three in the morning” is a question with an answer.
                    </p>
                    <p>
                        Some of that quiet is on purpose. The station stays on the air only by renewing its claim every few seconds, so a crash or a
                        redeploy takes it off within seconds instead of leaving a fallback loop playing that nobody chose. And by default it
                        broadcasts only while somebody is listening: with nobody tuned in, the console reads <strong>ready</strong>, not faulty.
                    </p>
                </FeatureRow>

                <section className={styles.section}>
                    <p className="da-eyebrow">The console</p>
                    <h2>The rest of the desk.</h2>
                    <p className={styles.sectionLede}>
                        A broadcast desk rather than a player. It deliberately does not play the station: the listeners have the mount. It is what you
                        open to see what is going out, what is coming up, and what needs you.
                    </p>
                    <ConsoleTour stops={tour} />
                </section>

                <section className={styles.section}>
                    <h3 className={styles.subhead}>Three ways to read it.</h3>
                    <p className={styles.sectionLede}>The same desk in each of the console’s themes. The tally stays red in every one.</p>
                    <div className={styles.themes}>
                        <Figure shot="desk" caption="Carbon" />
                        <Figure shot="deskWhite" caption="Studio White" />
                        <Figure shot="deskNeon" caption="Neon Transmitter" />
                    </div>
                </section>

                <section className={styles.section}>
                    <p className="da-eyebrow">The stack</p>
                    <h2>Bring your own model. Bring your own voice.</h2>
                    <p className={styles.sectionLede}>
                        The words and the voice are separate choices, and both are yours. Change either in Settings and the next break uses it, with
                        no restart. A station with no model at all still talks.
                    </p>
                    <div className={styles.stack}>
                        <ChipList
                            label="The words"
                            title="Any model can present."
                            note="As many providers at once as you add, each job on whichever suits it. Break-writing on a hosted model and reading on a local one is one setting each."
                            items={models}
                        />
                        <ChipList
                            label="The voice"
                            title="And any voice can read it."
                            note="Every character carries its own voice. Chatterbox reads from a reference clip rather than a named preset."
                            items={voices}
                        />
                        <ChipList
                            label="What it knows"
                            title="Facts, news and the weather."
                            note="Where the claims come from, what the bulletins are written from, and what it is like outside."
                            items={sources}
                        />
                    </div>
                </section>

                <section className={styles.section}>
                    <h2>How it fits together</h2>
                    <p className={styles.sectionLede}>
                        Nothing in the station decodes, mixes or encodes audio. The mixing chain and the stream server run beside it, and the station
                        drives them over HTTP.
                    </p>
                    <div className={styles.diagram}>
                        <pre>{diagram}</pre>
                    </div>
                </section>

                <section className={styles.section}>
                    <p className="da-eyebrow">Your library</p>
                    <h2>It plays your music, not its own.</h2>
                    <div className={styles.library}>
                        <p className={styles.sectionLede}>
                            deadair holds no catalogue. It programmes what your provider already gives you, a Spotify account or a Subsonic server
                            such as Navidrome, and it grants you no rights to broadcast any of it.
                        </p>
                        <ul className={styles.providers}>
                            {providers.map(provider => (
                                <li key={provider}>{provider}</li>
                            ))}
                        </ul>
                    </div>
                    <aside className={styles.callout}>
                        <p>
                            <strong>Read the licensing page before you publish an address.</strong> Owning the music is not the same as the right to
                            broadcast it, and keeping a station private lowers the risk rather than removing it.{' '}
                            <Link to="/docs/licensing">Music licensing</Link> says what is clear and what is not.
                        </p>
                    </aside>
                </section>

                <section className={styles.section}>
                    <h2>Run it</h2>
                    <p className={styles.sectionLede}>
                        One container holds the station, its console, the audio chain, the stream server and the measurement sidecar. One port carries
                        all of it, so whatever you already put in front of a port carries the station too.
                    </p>
                    <div className={styles.tags}>
                        {tags.map(image => (
                            <div key={image.tag} className={styles.tag}>
                                <code>deadair/deadair:{image.tag}</code>
                                <dl>
                                    <dt>Brings</dt>
                                    <dd>{image.brings}</dd>
                                    <dt>You bring</dt>
                                    <dd>{image.bring}</dd>
                                </dl>
                            </div>
                        ))}
                    </div>
                    <p className={styles.note}>
                        Images are <code>linux/amd64</code>. The tags above follow <code>main</code>; pin <code>deadair/deadair:0.1</code> to track
                        releases only. <Link to="/docs/install">The install guide</Link> covers the two secrets to generate first and the first-boot
                        order.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>Listen.</h2>
                    <div className={styles.listen}>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">The mount</p>
                            <p>
                                <code>/live.mp3</code>, with Opus, AAC, FLAC and HLS when you turn them on. Anything that plays an internet radio
                                stream plays the station.
                            </p>
                        </div>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">Android</p>
                            <p>
                                Background playback and lock-screen controls. Signed in as the operator, it is the station’s remote as well.{' '}
                                <Link href={playStore}>Get it on Google Play</Link>, or{' '}
                                <Link href={`${repository}/tree/main/apps/android`}>build it from source</Link>.
                            </p>
                        </div>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">iPhone</p>
                            <p>
                                Background playback, the lock screen and Control Center, and the format your station publishes.{' '}
                                <Link href={`${repository}/tree/main/apps/ios`}>Build it from source.</Link>
                            </p>
                        </div>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">macOS</p>
                            <p>
                                A listener with a real player and the operator’s desk in one window, on Apple Silicon.{' '}
                                <Link href={`${repository}/tree/main/apps/desktop`}>Build it from source.</Link>
                            </p>
                        </div>
                    </div>
                </section>

                <section className={styles.end}>
                    <h2>Put a station on the air.</h2>
                    <p>One container, your music, and a presenter who never goes quiet.</p>
                    <div className={styles.actions}>
                        <Link className={styles.primary} to="/docs/install">
                            Install it
                        </Link>
                        <Link className={styles.secondary} to="/docs/features">
                            What it does
                        </Link>
                        <Link className={styles.secondary} href={repository}>
                            Read the source
                        </Link>
                    </div>
                </section>
            </main>
        </Layout>
    );
}
