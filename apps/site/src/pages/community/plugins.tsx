import Link from '@docusaurus/Link';

import { submitUrl, type CatalogPlugin } from '../../community/catalog';
import { useCommunity } from '../../community/use.community';
import { CatalogCard } from '../../components/catalog.card';
import { CommunityDirectory, Facts, Tags } from '../../components/community.directory';
import styles from './plugins.module.css';

/**
 * The hosts a plugin's manifest names, as its author wrote them. Labelled as what it SAYS, because a
 * manifest describes a well-behaved plugin and limits nothing: see "Trust and egress" in
 * packages/plugin-sdk/CLAUDE.md, which is the sentence this label exists not to contradict.
 */
function hosts(plugin: CatalogPlugin): string {
    const named = plugin.hosts.join(', ');
    if (plugin.hostsFromConfig === true) return named === '' ? 'an address you give it' : `${named}, and an address you give it`;
    return named === '' ? 'nothing it names' : named;
}

export default function Plugins() {
    const community = useCommunity();
    const plugins = community?.catalog.plugins;

    return (
        <CommunityDirectory
            eyebrow="Plugins"
            title="Plugins other people wrote."
            description="deadair plugins written outside the project: music sources, facts, voices and models, with where to get each one."
            lede={
                <p>
                    Music sources, places facts come from, voices and models, written outside the project and listed by their authors. A tarball here
                    goes into <strong>Settings</strong>, <strong>Plugins</strong>, <strong>Import</strong>, and arrives switched off.
                </p>
            }
            submit={{ label: 'List your plugin', href: submitUrl('add-plugin') }}
            notice={
                <>
                    <p>
                        <strong>Listed is not vetted.</strong> Nobody reviews the code of a plugin on this page. A plugin runs inside the station’s
                        server process with its privileges: it can read and write files, open network connections, and read the server’s environment,
                        including the database and encryption credentials. Install one only from somebody you trust, as you would add a dependency to
                        a project.
                    </p>
                    <p>
                        What each card says it talks to is its author’s description of a well-behaved plugin, not a limit on what it can do.{' '}
                        <Link to="/docs/features/plugins#plugins-are-trusted-code">What the station does and does not protect you from.</Link>
                    </p>
                </>
            }
            entries={plugins}
            empty={
                <p>
                    No plugins listed yet. <Link to="/docs/plugin-development">Write one</Link>, then{' '}
                    <Link to="/docs/plugin-development/listing">list it here</Link>.
                </p>
            }
        >
            {plugin => (
                <CatalogCard
                    key={plugin.slug}
                    title={plugin.name}
                    subtitle={`${plugin.id} · ${plugin.version}`}
                    listing={plugin.listing}
                    actions={
                        <>
                            {plugin.package !== undefined && <Link href={plugin.package.tarball}>Tarball</Link>}
                            <Link href={plugin.repository}>Source</Link>
                        </>
                    }
                >
                    <p>{plugin.description}</p>
                    <Tags items={plugin.capabilities} />
                    <Facts
                        facts={[
                            ['Author', plugin.author],
                            ['Says it talks to', hosts(plugin)],
                            ['Plugin API', plugin.apiVersion],
                            ['Licence', plugin.license],
                            ['Install', plugin.package === undefined ? 'Build it from source' : undefined],
                            ['SHA-256', plugin.package === undefined ? undefined : <code className={styles.hash}>{plugin.package.sha256}</code>],
                        ]}
                    />
                </CatalogCard>
            )}
        </CommunityDirectory>
    );
}
