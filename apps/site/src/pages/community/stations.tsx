import Link from '@docusaurus/Link';

import { languageName, listenUrl, submitUrl, timeAgo, type StationStatus } from '../../community/catalog';
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
            {checked !== undefined && <p className={styles.checked}>Checked {checked}</p>}
        </div>
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
                    Every one of these is somebody’s own: their music, their presenter, their clock. Whether each is on the air, and what it is
                    playing, is checked every fifteen minutes.
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
            {station => {
                const status = community?.status[station.slug];
                const where = [station.location, station.language === undefined ? undefined : languageName(station.language)]
                    .filter(part => part !== undefined)
                    .join(' · ');
                return (
                    <CatalogCard
                        key={station.slug}
                        title={station.name}
                        subtitle={where === '' ? undefined : where}
                        badge={<Badge status={status} />}
                        listing={station.listing}
                        actions={
                            <>
                                <Link href={listenUrl(station, status)}>Listen</Link>
                            </>
                        }
                    >
                        <p>{station.description}</p>
                        <Tags items={station.genres ?? []} />
                        <NowPlaying status={status} />
                    </CatalogCard>
                );
            }}
        </CommunityDirectory>
    );
}
