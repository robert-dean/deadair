import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import { ChipList } from '../components/chip.list';
import { ConsoleTour, type TourStop } from '../components/console.tour';
import { FeatureRow } from '../components/feature.row';
import { Figure } from '../components/figure';
import styles from './index.module.css';

const repository = 'https://github.com/robert-dean/deadair';
const playStore = 'https://play.google.com/store/apps/details?id=com.maroonedsoftware.deadair';
/** The Stream Deck plugin's listing on the Elgato Marketplace, which installs it and keeps it updated. */
const streamDeckMarketplace = 'https://marketplace.elgato.com/product/deadair-67841f42-616f-45f3-9708-341017359656';

/** The four facts worth reading before anything else, as a strip under the hero's buttons. */
const facts = ['Self-hosted', 'Your music', 'Any model, or none', 'MIT licensed'];

/** The rest of the console, after the feature rows have shown the pages they are about. */
const tour: TourStop[] = [
    {
        shot: 'scheduleToday',
        title: 'The programme',
        body: 'The format clock is what the station says inside an hour, whatever it is playing: the weather at five past, the news at half past. Above it, a weekly timetable of blocks, each with its own brief and its own presenter.',
    },
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
        shot: 'checkup',
        title: 'Why it is quiet',
        body: 'Eleven ordered checks over one snapshot answer “why is nothing playing” with a single verdict, written to the station’s own log. So “why was it silent at three in the morning” is a question with an answer.',
    },
];

/** What the station can use for words, a voice, facts and music, as the plugins that ship with it reach them. */
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
const providers = ['Spotify', 'YouTube Music', 'Navidrome', 'Any Subsonic server'];

/** The three images, as the install guide lists them. */
const tags = [
    { tag: 'full', brings: 'A voice, PostgreSQL and Redis', bring: 'Nothing. Start here on an empty machine.' },
    { tag: 'latest', brings: 'A voice', bring: 'PostgreSQL and Redis you already keep backups of.' },
    { tag: 'slim', brings: 'The station alone', bring: 'PostgreSQL, Redis and a speech server, ideally on a GPU.' },
];

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
                        <Link className={styles.primary} to="/docs/quick-start">
                            Quick start
                        </Link>
                        <Link className={styles.secondary} to="/community/stations">
                            Hear a station
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
                        waits on a download. <Link to="/docs/features/running-order">The running order.</Link>
                    </p>
                </FeatureRow>

                <FeatureRow
                    part="Part two"
                    kicker="The presenter"
                    title="A model cannot make it go quiet."
                    side="right"
                    figure={<Figure shot="voiceSaid" number={3} caption="Every break written, and every one declined" />}
                >
                    <p>
                        The presenter talks between records using a local or hosted model when one is configured. When there is none, when it is slow,
                        or when what it wrote failed a check, the station falls back on its own phrasings. That floor cannot fail, which is the whole
                        design.
                    </p>
                    <p>
                        Every attempt is kept, the declined ones too, with the reason. One here was turned down because{' '}
                        <strong>the model said “tonight” at seven in the morning</strong>, which a listener hears immediately and the station cannot
                        take back. <Link to="/docs/features/breaks">Breaks.</Link>
                    </p>
                </FeatureRow>

                <FeatureRow
                    part="Part three"
                    kicker="The facts"
                    title="True, or nothing."
                    figure={<Figure shot="catalogTrack" number={4} caption="One record, and what the station knows about it" />}
                >
                    <p>
                        Every fact the presenter mentions about a record is a stored claim with the sentence of source prose behind it. A claim with
                        no source cannot be written down at all. The alternative is a presenter saying something specific, checkable and untrue in
                        exactly the voice it uses for things that are true.
                    </p>
                    <p>
                        It also knows what the record sounds like. A measurement sidecar decodes each one for its cue points and its loudness, so the
                        silence at its head and tail is trimmed before the player ever sees it.{' '}
                        <Link to="/docs/features/claims">Facts and claims.</Link>
                    </p>
                </FeatureRow>

                <FeatureRow
                    part="Part four"
                    kicker="The characters"
                    title="Presenters that accumulate."
                    side="right"
                    figure={<Figure shot="voiceCharacters" number={5} caption="The roster" />}
                >
                    <p>
                        Who is presenting is a character with a voice, a diction, how much rope it is given and how brief it is. It keeps a notebook
                        of what it has said and the traits it is growing into, and a set of stories it can tell on air. A show can hand the hour to a
                        different character, and you can rehearse one over an hour of records before it goes on air.{' '}
                        <Link to="/docs/features/characters">Characters.</Link>
                    </p>
                    <p>
                        It can also give the hour to something that is not records: a <Link to="/docs/features/podcasts">podcast</Link> it carries, a{' '}
                        <Link to="/docs/features/narrations">book or column</Link> it reads out, or a{' '}
                        <Link to="/docs/features/phone-ins">phone-in</Link> it produces for itself, where a caller and the host trade turns and each
                        turn is its own model call in its own voice.
                    </p>
                </FeatureRow>

                <section className={styles.section}>
                    <p className="da-eyebrow">The console</p>
                    <h2>The rest of the desk.</h2>
                    <p className={styles.sectionLede}>
                        A broadcast desk rather than a player. It deliberately does not play the station: the listeners have the mount. It is what you
                        open to see what is going out, what is coming up, and what needs you. What is on air, Skip, Stop and your opinion of the
                        record playing also come as keys, on <Link to="/docs/features/console#on-a-stream-deck">an Elgato Stream Deck</Link>.
                    </p>
                    <ConsoleTour stops={tour} />
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
                        <ChipList
                            label="Your library"
                            title="It plays your music, not its own."
                            note="deadair holds no catalogue. It programmes what your provider already gives you, and it grants you no rights to broadcast any of it."
                            items={providers}
                        />
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
                        releases only. <Link to="/docs/quick-start">The quick start</Link> takes the first one from nothing to on air, and{' '}
                        <Link to="/docs/install">the install guide</Link> covers every choice it makes for you.
                    </p>
                    <p className={styles.note}>
                        Listeners get <code>/live.mp3</code>, with Opus, AAC, FLAC and HLS when you turn them on, so anything that plays an internet
                        radio stream plays the station. There are also apps: Android on <Link href={playStore}>Google Play</Link>, and{' '}
                        <Link href={`${repository}/tree/main/apps/ios`}>iPhone</Link> and{' '}
                        <Link href={`${repository}/tree/main/apps/desktop`}>macOS</Link> built from source.{' '}
                        <Link to="/docs/features/listening">Listening.</Link>
                    </p>
                </section>

                <section className={styles.section}>
                    <p className="da-eyebrow">Develop</p>
                    <h2>Build on it.</h2>
                    <div className={styles.cards}>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">A plugin</p>
                            <p>
                                Music sources, facts, charts, voices, models and news are all plugins, and yours loads beside the bundled fourteen
                                without rebuilding anything. Plain npm, against the published SDK.{' '}
                                <Link to="/docs/plugin-development/getting-started">Your first plugin.</Link>
                            </p>
                        </div>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">The API</p>
                            <p>
                                Every station serves the same HTTP API, and the console and all three listener apps are built on it. A key from
                                Settings, Security drives the desk from your own code, a keypad or a home-automation hub.{' '}
                                <Link to="/docs/develop/api">Build on the API.</Link>
                            </p>
                        </div>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">The station itself</p>
                            <p>
                                A pnpm monorepo, a Koa API and a React console, with the audio chain in containers beside it. From clone to a station
                                running on your machine is one page. <Link to="/docs/develop/setup">Setting up a checkout.</Link>
                            </p>
                        </div>
                        <div className={styles.tag}>
                            <p className="da-eyebrow">Hardware</p>
                            <p>
                                The desk on keys: what is on air with its cover, Skip, a Stop that asks twice, and a heart on the record playing.{' '}
                                <Link href={streamDeckMarketplace}>Get it on the Elgato Marketplace</Link>, or{' '}
                                <Link to="/docs/features/console#on-a-stream-deck">read what it does</Link>.
                            </p>
                        </div>
                    </div>
                </section>

                <section className={styles.end}>
                    <h2>Put a station on the air.</h2>
                    <p>One container, your music, and a presenter who never goes quiet.</p>
                    <div className={styles.actions}>
                        <Link className={styles.primary} to="/docs/quick-start">
                            Quick start
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
