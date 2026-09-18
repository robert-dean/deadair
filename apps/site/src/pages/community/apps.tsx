import Link from '@docusaurus/Link';

import { submitUrl, type CatalogApp } from '../../community/catalog';
import { useCommunity } from '../../community/use.community';
import { CatalogCard } from '../../components/catalog.card';
import { CommunityDirectory, Facts, Tags } from '../../components/community.directory';
import styles from './apps.module.css';

const kinds: Record<CatalogApp['kind'], string> = {
    player: 'Player',
    remote: 'Remote',
    integration: 'Integration',
    library: 'Library',
};

const platforms: Record<string, string> = {
    android: 'Android',
    ios: 'iPhone',
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
    web: 'Web',
    'stream-deck': 'Stream Deck',
    'home-assistant': 'Home Assistant',
    cli: 'Command line',
    other: 'Other',
};

/** The project's own first, then everybody else's, each by name. */
const order = (a: CatalogApp, b: CatalogApp) => Number(b.firstParty === true) - Number(a.firstParty === true) || a.name.localeCompare(b.name);

export default function Apps() {
    const community = useCommunity();
    const apps = community === undefined ? undefined : [...community.catalog.apps].sort(order);

    return (
        <CommunityDirectory
            eyebrow="Apps"
            title="Things that play it, and drive it."
            description="Players, remotes, integrations and libraries built on deadair, by the project and by other people."
            lede={
                <p>
                    Players, remotes, integrations and libraries. Everything the console does goes through the station’s own HTTP API, so anything
                    here can do what it does with an API key from <strong>Settings</strong>, <strong>Security</strong>.
                </p>
            }
            submit={{ label: 'List your app', href: submitUrl('add-app') }}
            entries={apps}
            empty={
                <p>
                    Nothing listed yet. <Link href={submitUrl('add-app')}>List yours.</Link>
                </p>
            }
        >
            {app => (
                <CatalogCard
                    key={app.slug}
                    eyebrow={kinds[app.kind]}
                    title={app.name}
                    badge={app.firstParty === true ? <span className={styles.ours}>From deadair</span> : undefined}
                    listing={app.listing}
                    actions={
                        <>
                            <Link href={app.url}>Get it</Link>
                            {app.repository !== undefined && app.repository !== app.url && <Link href={app.repository}>Source</Link>}
                        </>
                    }
                >
                    <p>{app.description}</p>
                    <Tags items={app.platforms.map(platform => platforms[platform] ?? platform)} />
                    <Facts
                        facts={[
                            ['Author', app.author],
                            ['Licence', app.license],
                        ]}
                    />
                </CatalogCard>
            )}
        </CommunityDirectory>
    );
}
