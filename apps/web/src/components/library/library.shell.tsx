import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';

import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmbeddedPage } from '../shared/page.header';

/**
 * The tabs, and the route each one IS.
 *
 * Unlike Voice, these are not one route with a search param. Every one of them already carries its
 * own URL state — the catalog's page, search, sort and state filter, a playlist's plugin — with its
 * own validation and its own loader warming its own cache. Folding five routes into one would have
 * meant one `validateSearch` holding the union of five pages' parameters, and every one of those
 * pages losing the loader that makes it arrive warm. The destination is what changed; the pages
 * underneath are still pages.
 */
const LIBRARY_TABS = [
    { key: 'tracks', label: 'Tracks' },
    { key: 'artists', label: 'Artists' },
    { key: 'playlists', label: 'Playlists' },
    { key: 'charts', label: 'Charts' },
    { key: 'news', label: 'News' },
] as const satisfies readonly DestinationTab<string>[];

export type LibraryTab = (typeof LIBRARY_TABS)[number]['key'];

export interface LibraryShellProps {
    active: LibraryTab;
    children: ReactNode;
}

/**
 * Everything there is to play, behind one destination.
 *
 * Four nav links became one. They are all answers to "what can this station put on", and an
 * operator arriving with that question had to already know whether the answer was a record, a
 * playlist, a chart or a story.
 *
 * **Releases is not a tab, because there is no releases list.** The design draws one, and draws it
 * with the tracks table as its body — its own logic makes Tracks, Artists and Releases the same
 * screen — so there is nothing there to build from. The console has release DETAIL at
 * `/catalog/albums/$albumId`, reached from a track or an artist, and no page that lists them. A tab
 * leading to a list that does not exist would be worse than the gap.
 */
export function LibraryShell({ active, children }: LibraryShellProps) {
    const navigate = useNavigate();

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                <Title order={1}>Library</Title>
                <Text size="sm" c="dimmed" maw={720}>
                    Everything there is to play. Records, the artists behind them, the playlists a plugin can offer, the charts, and the stories a
                    bulletin is written from.
                </Text>
            </Stack>

            <DestinationTabs
                tabs={LIBRARY_TABS}
                active={active}
                label="Library"
                onSelect={key => {
                    // Each tab is its own route, so this is a real navigation rather than a state
                    // change: the back button steps between them and every page keeps the loader
                    // that makes it arrive warm.
                    void navigate({ to: ROUTES[key] });
                }}
            />

            {/* Stops each hosted page drawing a second `<h1>` under the destination's own. */}
            <EmbeddedPage>{children}</EmbeddedPage>
        </Stack>
    );
}

/** Where each tab goes. Separate from the tab list so the labels stay free of route strings. */
const ROUTES: Record<LibraryTab, '/catalog/tracks' | '/catalog' | '/playlists' | '/charts' | '/news'> = {
    tracks: '/catalog/tracks',
    artists: '/catalog',
    playlists: '/playlists',
    charts: '/charts',
    news: '/news',
};
