import Link from '@docusaurus/Link';
import { useEffect, useState } from 'react';

import { fetchNowPlaying, languageName, listenUrl, submitUrl, timeAgo, type CatalogStation, type StationStatus } from '../../community/catalog';
import { useCommunity } from '../../community/use.community';
import { CatalogCard } from '../../components/catalog.card';
import { CommunityDirectory, Tags } from '../../components/community.directory';
import styles from './stations.module.css';

const badges: Record<StationStatus['state'] | 'unchecked', { label: string; className: string | undefined }> = {
    'on-air': { label: 'On air', className: styles.onAir },
    'off-air': { label: 'Off air', className: styles.offAir },
    unreachable: { label: 'Not answering', className: styles.quiet },
    unchecked: { label: 'Not checked yet', className: styles.quiet },
};

function Badge({ status }: { status: StationStatus | undefined }) {
    const badge = badges[status?.state ?? 'unchecked'];
    return <span className={[styles.badge, badge.className].filter(Boolean).join(' ')}>{badge.label}</span>;
}

/** How often a card asks its station again while somebody is looking at the page. */
const LIVE_EVERY_MS = 60_000;

/**
 * What a station says is on air, asked directly, falling back to the catalogue's last check.
 *
 * A station answers another site's browser since `/api/nowplaying` began sending an open CORS header;
 * one on an older version is refused by the browser, and its card stays on the fifteen-minute check.
 * Asked again every minute while the tab is visible, and never while it is hidden.
 */
function useLiveStatus(station: CatalogStation, checked: StationStatus | undefined): StationStatus | undefined {
    const [live, setLive] = useState<StationStatus>();
    useEffect(() => {
        let current = true;
        const ask = () => {
            if (document.visibilityState === 'hidden') return;
            void fetchNowPlaying(station.url).then(status => {
                if (current && status !== undefined) setLive(status);
            });
        };
        ask();
        const timer = window.setInterval(ask, LIVE_EVERY_MS);
        document.addEventListener('visibilitychange', ask);
        return () => {
            current = false;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', ask);
        };
    }, [station.url]);
    return live ?? checked;
}

/** What is on air, as the last check heard it, and when that was. */
function NowPlaying({ status }: { status: StationStatus | undefined }) {
    if (status === undefined) return null;
    const checked = timeAgo(status.checkedAt);
    const { track, show } = status;
    return (
        <div className={styles.now}>
            {status.state === 'on-air' && track !== undefined && (
                <p>
                    <span className={styles.label}>Now</span>{' '}
                    {track.kind === 'break'
                        ? 'The presenter is talking'
                        : track.artist === undefined
                          ? track.title
                          : `${track.artist} — ${track.title}`}
                </p>
            )}
            {status.state === 'on-air' && show !== undefined && (
                <p>
                    <span className={styles.label}>Show</span> {show.name}
                    {show.host !== undefined && `, with ${show.host}`}
                </p>
            )}
            {checked !== undefined && <p className={styles.checked}>{checked === 'just now' ? 'Live' : `Checked ${checked}`}</p>}
        </div>
    );
}

function StationCard({ station, checked }: { station: CatalogStation; checked: StationStatus | undefined }) {
    const status = useLiveStatus(station, checked);
    const where = [station.location, station.language === undefined ? undefined : languageName(station.language)]
        .filter(part => part !== undefined)
        .join(' · ');
    return (
        <CatalogCard
            title={station.name}
            subtitle={where === '' ? undefined : where}
            badge={<Badge status={status} />}
            listing={station.listing}
            actions={<Link href={listenUrl(station, status)}>Listen</Link>}
        >
            <p>{station.description}</p>
            <Tags items={station.genres ?? []} />
            <NowPlaying status={status} />
        </CatalogCard>
    );
}

export default function Stations() {
    const community = useCommunity();
    const stations = community?.catalog.stations;

    return (
        <CommunityDirectory
            eyebrow="Stations"
            title="Stations on the air."
            description="deadair stations other people run, whether each one is on the air, and what it is playing."
            lede={
                <p>
                    Every one of these is somebody’s own: their music, their presenter, their clock. What each is playing is asked of the station
                    itself while you look, or comes from a check every fifteen minutes when it will not say.
                </p>
            }
            submit={{ label: 'Add your station', href: submitUrl('add-station') }}
            entries={stations}
            empty={
                <p>
                    No stations listed yet. <Link href={submitUrl('add-station')}>Yours could be the first.</Link>
                </p>
            }
        >
            {station => <StationCard key={station.slug} station={station} checked={community?.status[station.slug]} />}
        </CommunityDirectory>
    );
}
