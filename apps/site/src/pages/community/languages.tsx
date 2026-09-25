import Link from '@docusaurus/Link';

import { languageName, submitUrl } from '../../community/catalog';
import { useCommunity } from '../../community/use.community';
import { CatalogCard } from '../../components/catalog.card';
import { CommunityDirectory, Facts } from '../../components/community.directory';
import { DownloadLink } from '../../components/download.link';

/**
 * Translations of the console, each a language pack the console's Settings, Languages imports as it
 * stands.
 *
 * A card counts a pack's strings and says which console version it was made for, and no more: how
 * much of a given console a pack covers depends on that console's own English, which is why the
 * console, not this page, says it when the pack is imported.
 */
export default function Languages() {
    const community = useCommunity();
    const languages = community?.catalog.languages;

    return (
        <CommunityDirectory
            eyebrow="Languages"
            title="The console, in your language."
            description="Translations of the deadair console other operators made, ready to import into your station."
            lede={
                <p>
                    Translations of the console other people made. Each is a language pack the console imports as it stands: download it, then in the
                    console open <strong>Settings</strong>, <strong>Languages</strong>, and choose <strong>Import a language pack</strong>. After
                    that, everybody on your station can choose it for themselves. See <Link to="/docs/features/languages">languages</Link> for
                    translating one of your own.
                </p>
            }
            submit={{ label: 'Share a language', href: submitUrl('add-language') }}
            notice={
                <p>
                    This is the console’s language only, not what your station broadcasts in. Only an admin can import a pack, and the import shows
                    how much of your console it covers before it installs anything: a pack made for an older console shows what changed since in
                    English, string by string.
                </p>
            }
            entries={languages}
            empty={
                <p>
                    No languages shared yet. Export the English from <strong>Settings</strong>, <strong>Languages</strong> in your console, translate
                    it, and <Link href={submitUrl('add-language')}>share it</Link>.
                </p>
            }
        >
            {entry => (
                <CatalogCard
                    key={entry.slug}
                    eyebrow={languageName(entry.locale)}
                    // `auto`, so a name written right to left, such as العربية, is laid out that way on a page that is not.
                    title={<span dir="auto">{entry.name}</span>}
                    subtitle={entry.summary}
                    listing={entry.listing}
                    actions={<DownloadLink href={`${community?.origin}/${entry.download}`} filename={`deadair-console-${entry.locale}.json`} />}
                >
                    <Facts
                        facts={[
                            ['Translated by', entry.translators],
                            ['Tag', entry.locale],
                            ['Strings', entry.strings.toLocaleString('en')],
                            ['Made for', entry.madeFor === '' ? undefined : `console ${entry.madeFor}`],
                            ['Written', entry.direction === 'rtl' ? 'right to left' : undefined],
                        ]}
                    />
                </CatalogCard>
            )}
        </CommunityDirectory>
    );
}
