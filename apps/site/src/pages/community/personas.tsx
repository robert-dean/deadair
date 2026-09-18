import Link from '@docusaurus/Link';
import type { MouseEvent } from 'react';

import { submitUrl, type CatalogCharacter } from '../../community/catalog';
import { useCommunity } from '../../community/use.community';
import { CatalogCard } from '../../components/catalog.card';
import { CommunityDirectory, Facts } from '../../components/community.directory';
import styles from './personas.module.css';

/**
 * Saves the file rather than opening it.
 *
 * A link's `download` attribute is ignored for a file on another origin, and the catalogue is on
 * one, so a plain link would show the JSON in the tab. This fetches it and saves the bytes instead,
 * and falls back to that plain link when the fetch fails. The href stays the file's own address, so
 * copying the link or opening it in a new tab still works.
 */
function DownloadLink({ href, filename }: { href: string; filename: string }) {
    const save = async (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        try {
            const response = await fetch(href);
            if (!response.ok) throw new Error(String(response.status));
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch {
            window.location.href = href;
        }
    };
    return (
        <a href={href} onClick={event => void save(event)}>
            Download
        </a>
    );
}

/** The sheet's `style` completes "You are …", so on a card it reads as a sentence of its own. */
const sentence = (style: string) => {
    const text = style.trim();
    const capitalised = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
};

/** Everything past the first line, folded away until somebody wants it. */
function More({ persona }: { persona: CatalogCharacter }) {
    const lists: [string, readonly string[] | undefined][] = [
        ['Always and never', persona.quirks],
        ['Catchphrases', persona.catchphrases],
        ['In their own words', persona.samples],
        ['Stories', persona.stories.map(story => story.title)],
    ];
    const shown = lists.filter(([, items]) => items !== undefined && items.length > 0);
    if (persona.background === undefined && shown.length === 0) return null;
    return (
        <details className={styles.more}>
            <summary>More about {persona.djName ?? persona.label}</summary>
            {persona.background !== undefined && <p>{persona.background}</p>}
            {shown.map(([label, items]) => (
                <div key={label}>
                    <p className={styles.heading}>{label}</p>
                    <ul>
                        {items?.map(item => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            ))}
        </details>
    );
}

export default function Personas() {
    const community = useCommunity();
    const personas = community?.catalog.personas;

    return (
        <CommunityDirectory
            eyebrow="Personas"
            title="Characters to put on the air."
            description="Presenters and callers other operators wrote for their deadair stations, ready to import into yours."
            lede={
                <p>
                    Presenters and callers other operators wrote. Each is the file the console exports, so it goes straight into yours: download it,
                    then in the console open <strong>Voice</strong>, <strong>Characters</strong>, and choose <strong>Import</strong>.
                </p>
            }
            submit={{ label: 'Share a character', href: submitUrl('add-persona') }}
            notice={
                <p>
                    An import shows what the file would change before it writes anything, and it puts nobody on air. A voice or a soundboard is your
                    station’s own: a character naming one you do not have arrives without it, and the import says so. What a character has said on
                    another station does not travel with it.
                </p>
            }
            entries={personas}
            empty={
                <p>
                    No characters shared yet. Export one from <strong>Voice</strong>, <strong>Characters</strong> in your console and{' '}
                    <Link href={submitUrl('add-persona')}>share it</Link>.
                </p>
            }
        >
            {entry => {
                const { persona } = entry;
                return (
                    <CatalogCard
                        key={entry.slug}
                        eyebrow={persona.kind === 'caller' ? 'Caller' : 'Host'}
                        title={persona.djName ?? persona.label}
                        subtitle={entry.summary}
                        listing={entry.listing}
                        actions={<DownloadLink href={`${community?.origin}/${entry.download}`} filename={`${entry.slug}.json`} />}
                    >
                        <p>{sentence(persona.style)}</p>
                        <Facts
                            facts={[
                                ['Written by', entry.author],
                                ['Talks', persona.chattiness],
                                ['Says', persona.brevity === undefined ? undefined : persona.brevity === 'one-line' ? 'one line' : 'a little'],
                                ['Latitude', persona.latitude],
                                [
                                    'Stories',
                                    persona.stories.length > 0
                                        ? `${persona.stories.length}, told ${persona.storytelling ?? 'occasionally'}`
                                        : undefined,
                                ],
                            ]}
                        />
                        <More persona={persona} />
                    </CatalogCard>
                );
            }}
        </CommunityDirectory>
    );
}
