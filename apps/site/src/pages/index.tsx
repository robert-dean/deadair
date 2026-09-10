import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const repository = 'https://github.com/robert-dean/deadair';

/** What the station does, in the order the README argues it. */
const features = [
    {
        label: 'Running order',
        title: 'One thing owns what plays next',
        body: 'A forward lineup several hours deep that you can see and edit, every item carrying its own state. The director is its only writer, so an edit made at 3pm is still true at 3.05.',
    },
    {
        label: 'Breaks',
        title: 'A model cannot make it go quiet',
        body: 'The presenter talks between records using a local or hosted model when one is configured, and falls back on the station’s own phrasings when there is none, when it is slow, or when what it wrote failed a check.',
    },
    {
        label: 'Facts',
        title: 'True, or nothing',
        body: 'Every fact the presenter mentions is a stored claim with the sentence of source prose behind it. A claim with no source cannot be written down at all.',
    },
    {
        label: 'Personas',
        title: 'Presenters that accumulate',
        body: 'A voice, a diction, a notebook of what it has said and the anecdotes it can tell. A persona can even take a phone-in, with a caller and a host trading turns in their own voices.',
    },
    {
        label: 'Measurement',
        title: 'It knows what it is playing',
        body: 'A sidecar measures every record’s cue points and loudness, so the silence at its head and tail is trimmed before the player ever sees it.',
    },
    {
        label: 'Check-up',
        title: 'It says why it is quiet',
        body: 'Eleven ordered checks answer “why is nothing playing” with one verdict, written to the station’s own log, so three in the morning has an answer too.',
    },
];

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
                    <div>
                        <p className={styles.eyebrow}>Self-hosted AI radio</p>
                        <h1 className={styles.headline}>An AI radio station you run yourself.</h1>
                        <p className={styles.lede}>
                            It picks the records, writes what the presenter says between them, speaks it in that presenter’s voice, and streams the
                            result. One mount, one running order, and everybody hears the same thing at the same moment.
                        </p>
                        <div className={styles.actions}>
                            <Link className={styles.primary} to="/docs/install">
                                Install it
                            </Link>
                            <Link className={styles.secondary} href={repository}>
                                Read the source
                            </Link>
                        </div>
                    </div>
                    <img className={styles.mark} src={useBaseUrl('/logo.png')} alt="" width={280} height={280} />
                </header>

                <section className={styles.statement}>
                    <h2>A radio station, not a playlist.</h2>
                    <p>There is no per-listener shuffle and no skip button. What is on is what is on, and the station decides.</p>
                </section>

                <section className={styles.features} aria-label="What it does">
                    {features.map(feature => (
                        <article key={feature.label} className={styles.feature}>
                            <p className={styles.label}>{feature.label}</p>
                            <h3>{feature.title}</h3>
                            <p>{feature.body}</p>
                        </article>
                    ))}
                </section>

                <section className={styles.section}>
                    <h2>How it fits together</h2>
                    <p className={styles.sectionLede}>
                        Nothing in the station decodes, mixes or encodes audio. The mixing chain and the stream server run beside it, and the station
                        drives them over HTTP. The mount is leased rather than held, so a crashed station takes itself off the air within seconds.
                    </p>
                    <div className={styles.diagram}>
                        <pre>{diagram}</pre>
                    </div>
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

                <aside className={styles.callout}>
                    <h2>It plays your music, not its own.</h2>
                    <p>
                        deadair holds no catalogue. It programmes what your provider already gives you, a Spotify account or a Subsonic server such as
                        Navidrome, and it grants you no rights to broadcast any of it. <Link to="/docs/licensing">Read the licensing page</Link>{' '}
                        before you publish an address.
                    </p>
                </aside>
            </main>
        </Layout>
    );
}
