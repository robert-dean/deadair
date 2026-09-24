import { Button, Group, List, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { CatalogPlaylist } from '@deadair/sdk';

import { playlistsListOptions, useRefreshPlaylists } from '../../api/playlists.queries';
import { stationPlaylistsListOptions } from '../../api/station.playlists.queries';
import { i18n } from '../../i18n/i18n.setup';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { notifyQueued } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PlaylistCard } from './playlist.card';
import { PlaylistImportModal } from './playlist.import.modal';
import { StationPlaylistCard } from './station.playlist.card';

/** The same grid every group of cards on this page is drawn in. */
function PlaylistGrid({ playlists }: { playlists: CatalogPlaylist[] }) {
    return (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {playlists.map(playlist => (
                <PlaylistCard key={`${playlist.pluginId}:${playlist.id}`} playlist={playlist} />
            ))}
        </SimpleGrid>
    );
}

/**
 * A group of playlists folded away behind a button that says how many there are.
 *
 * Folded rather than removed, on the card's own argument that a playlist which quietly vanishes is
 * more confusing than one that says why it is not usable: the count is always on screen, so nothing
 * is ever missing without a trace. The cards are only drawn once the group is opened, because the
 * one group this exists for first is Spotify's own, which on a real account runs to dozens of
 * playlists nobody asked to see. "Collapse" rather than "Hide" to close it, because hiding is a
 * different thing a card can have done to it, and it persists.
 */
function FoldedPlaylists({ playlists, show, collapse }: { playlists: CatalogPlaylist[]; show: string; collapse: string }) {
    const [open, setOpen] = useState(false);

    if (playlists.length === 0) {
        return undefined;
    }

    return (
        <Stack gap="md" align="stretch">
            <Button
                variant="subtle"
                size="compact-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                    setOpen(current => !current);
                }}
            >
                {open ? collapse : show}
            </Button>
            {open ? <PlaylistGrid playlists={playlists} /> : undefined}
        </Stack>
    );
}

/** "Spotify", or "Spotify and Tidal": whoever made the playlists in a group, for its button. */
function makers(playlists: CatalogPlaylist[]): string {
    return [...new Set(playlists.map(playlist => playlist.pluginName))].join(i18n.t('playlists:page.makersJoin'));
}

/**
 * The header's count. A provider's playlists alone when the station keeps none, which is what it has
 * always said; both halves once it does, because "0 available" above a playlist the station owns
 * reads as a page that has lost count.
 */
function availability(fromSources: number, own: number): string {
    if (own === 0) return i18n.t('playlists:page.available', { count: fromSources });
    return i18n.t('playlists:page.availableWithOwn', { own, count: fromSources });
}

export function PlaylistsPage() {
    const { t } = useTranslation('playlists');
    const playlists = useQuery(playlistsListOptions);
    const refresh = useRefreshPlaylists();
    const station = useQuery(stationPlaylistsListOptions);
    // Its own dialog, because taking a source in is three steps: choose it, read what it would do,
    // do it. None of them belongs among the cards.
    const [importing, setImporting] = useState(false);
    const sourceErrors = playlists.data?.errors ?? [];

    // What a person chose is the page; what the service made for the account (Discover Weekly, a
    // Daily Mix, an editorial list) is folded under it. On Spotify those are also the playlists it
    // refuses to share, so left inline they bury the operator's own under cards that cannot be used.
    // Whatever the operator hid is folded last, and hiding wins: a hidden Daily Mix is in that group
    // and not the other, since that is the one an operator looks in to take a decision back.
    const all = playlists.data?.playlists ?? [];
    const hidden = all.filter(playlist => playlist.hidden === true);
    const providerMade = all.filter(playlist => playlist.hidden !== true && playlist.madeByProvider === true);
    const chosen = all.filter(playlist => playlist.hidden !== true && playlist.madeByProvider !== true);

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('page.title')}
                description={
                    <Text c="dimmed" size="sm">
                        {playlists.data ? availability(chosen.length, station.data?.playlists.length ?? 0) : t('page.loading')}
                    </Text>
                }
                actions={
                    <Group gap="xs">
                        <Button size="xs" variant="default" onClick={() => setImporting(true)}>
                            {t('page.import')}
                        </Button>
                        <Button
                            size="xs"
                            variant="default"
                            loading={refresh.isPending}
                            onClick={() =>
                                refresh.mutate(undefined, {
                                    onSuccess: () => notifyQueued(t('page.refreshQueued')),
                                })
                            }
                        >
                            {t('page.refresh')}
                        </Button>
                    </Group>
                }
            />

            <PlaylistImportModal opened={importing} onClose={() => setImporting(false)} />

            {station.error ? <ErrorAlert title={t('page.stationFailed')} error={station.error} /> : undefined}

            {/* The station's own come first, since they are the ones it holds rather than borrows. The
                heading exists only when there is something under it: a fresh install has none, and an
                empty section would be a second empty state above the one that matters. */}
            {station.data && station.data.playlists.length > 0 ? (
                <Stack gap="sm">
                    <Title order={2} size="h4">
                        {t('page.stationOwn')}
                    </Title>
                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                        {station.data.playlists.map(playlist => (
                            <StationPlaylistCard key={playlist.id} playlist={playlist} />
                        ))}
                    </SimpleGrid>
                    <Title order={2} size="h4" mt="sm">
                        {t('page.fromSources')}
                    </Title>
                </Stack>
            ) : undefined}

            {refresh.error ? <ErrorAlert title={t('page.refreshFailed')} error={refresh.error} /> : undefined}

            {playlists.error ? (
                <ErrorAlert title={t('page.loadFailed')} error={playlists.error} fallback={t('page.loadFailedFallback')} />
            ) : undefined}

            {sourceErrors.length > 0 ? (
                <ErrorAlert tone="warning" title={t('page.sourceErrors')}>
                    <List size="sm">
                        {sourceErrors.map(error => (
                            <List.Item key={error.pluginId}>{t('page.sourceError', { plugin: error.pluginName, message: error.message })}</List.Item>
                        ))}
                    </List>
                </ErrorAlert>
            ) : undefined}

            {playlists.isPending ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {[0, 1, 2].map(index => (
                        <PageSkeleton key={index} variant="card" />
                    ))}
                </SimpleGrid>
            ) : undefined}

            {playlists.data && all.length === 0 ? (
                <EmptyState title={t('page.emptyTitle')}>
                    {/* Never both stories at once. Telling an operator to enable a plugin
                        directly under a warning that their enabled plugin has failed sends
                        them to the wrong screen; the alert above already says what to do. */}
                    {sourceErrors.length > 0 ? (
                        t('page.emptyWithErrors')
                    ) : (
                        <Trans t={t} i18nKey="page.emptyEnable" components={{ code: <Text span ff="monospace" /> }} />
                    )}
                </EmptyState>
            ) : undefined}

            {chosen.length > 0 ? <PlaylistGrid playlists={chosen} /> : undefined}

            <FoldedPlaylists
                playlists={providerMade}
                show={t('page.madeBy.show', { count: providerMade.length, makers: makers(providerMade) })}
                collapse={t('page.madeBy.collapse', { count: providerMade.length, makers: makers(providerMade) })}
            />

            <FoldedPlaylists
                playlists={hidden}
                show={t('page.hidden.show', { count: hidden.length })}
                collapse={t('page.hidden.collapse', { count: hidden.length })}
            />
        </Stack>
    );
}
