import { useState } from 'react';
import { Button, Group, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PluginSummary } from '@deadair/sdk';
import { useQuery } from '@tanstack/react-query';

import { pluginsListOptions, useRescanPlugins } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { CatalogSearch } from '../catalog/catalog.search';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { usePhone } from '../shared/use.phone';
import { PluginAttentionStrip } from './plugin.attention';
import { PluginCard } from './plugin.card';
import { PluginImportModal } from './plugin.import.modal';
import {
    defaultShow,
    matchesSearch,
    matchesShow,
    PLUGIN_SHOWS,
    PLUGIN_VIEWS,
    PLUGINS_PAGE_DEFAULTS,
    type PluginShow,
    type PluginsPageParams,
} from './plugin.page.params';
import { groupByRole } from './plugin.roles';
import { PluginTable } from './plugin.table';

/** What a rescan refusal means, in the operator's terms rather than the transport's. */
function rescanError(error: unknown, t: TFunction<'plugins'>): string {
    if (sdkError(error)?.status === 403) {
        return t('page.rescanError.forbidden');
    }
    return apiErrorMessage(error, t('page.rescanError.fallback'));
}

/**
 * The status filter, each choice labelled with how many it would show.
 *
 * The counts honour the search and not the filter itself, so every segment answers "what would I
 * see if I clicked this" rather than all but the chosen one reading as zero.
 */
function ShowFilter({ plugins, value, onChange }: { plugins: PluginSummary[]; value: PluginShow; onChange: (show: PluginShow) => void }) {
    const { t } = useTranslation('plugins');
    return (
        <SegmentedControl
            size="xs"
            aria-label={t('page.show.ariaLabel')}
            value={value}
            onChange={next => {
                onChange(PLUGIN_SHOWS.find(known => known === next) ?? 'all');
            }}
            data={PLUGIN_SHOWS.map(show => ({
                value: show,
                label: t(`page.show.${show}`, { count: plugins.filter(plugin => matchesShow(plugin, show)).length }),
            }))}
        />
    );
}

export interface PluginsPageProps {
    params: PluginsPageParams;
    onParamsChange: (next: Partial<PluginsPageParams>) => void;
}

export function PluginsPage({ params, onParamsChange }: PluginsPageProps) {
    const { t } = useTranslation('plugins');
    const plugins = useQuery(pluginsListOptions);
    const rescan = useRescanPlugins();
    const [importing, setImporting] = useState(false);
    // The search box reads its value once and owns it from then on, so clearing the filters from
    // outside it is done by giving it a fresh mount rather than by writing into it.
    const [searchKey, setSearchKey] = useState(0);
    const phone = usePhone();

    // Decided over every plugin rather than the searched ones: the search is what the operator is
    // looking for, and the default is about the state of the station.
    const show = params.show ?? defaultShow(plugins.data ?? []);
    const searched = (plugins.data ?? []).filter(plugin => matchesSearch(plugin, params.q));
    const shown = searched.filter(plugin => matchesShow(plugin, show));

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('page.title')}
                description={
                    <Text c="dimmed" size="sm">
                        {plugins.data ? t('page.installed', { count: plugins.data.length }) : t('page.description')}
                    </Text>
                }
                actions={
                    <Group gap="xs">
                        <Button variant="default" size="compact-sm" onClick={() => setImporting(true)}>
                            {t('page.import')}
                        </Button>
                        <Button
                            variant="default"
                            size="compact-sm"
                            loading={rescan.isPending}
                            onClick={() => {
                                rescan.mutate();
                            }}
                        >
                            {t('page.rescan')}
                        </Button>
                    </Group>
                }
            />

            <PluginImportModal opened={importing} onClose={() => setImporting(false)} />

            {rescan.error ? (
                <ErrorAlert tone="warning" title={t('page.rescanError.title')}>
                    {rescanError(rescan.error, t)}
                </ErrorAlert>
            ) : undefined}

            {plugins.error ? (
                <ErrorAlert title={t('page.loadFailedTitle')} error={plugins.error} fallback={t('page.loadFailedFallback')} />
            ) : undefined}

            {plugins.isPending ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {[0, 1, 2].map(index => (
                        <PageSkeleton key={index} variant="card" />
                    ))}
                </SimpleGrid>
            ) : undefined}

            {plugins.data?.length === 0 ? <EmptyState title={t('page.empty.title')}>{t('page.empty.body')}</EmptyState> : undefined}

            {/* Over the search rather than under it, and blind to it: this is the page saying what is
                wrong, not a view of what was asked for. Hidden where the cards already are that list,
                or where the operator asked for the plugins they switched off. */}
            {plugins.data && (show === 'all' || show === 'enabled') ? <PluginAttentionStrip plugins={plugins.data} /> : undefined}

            {plugins.data && plugins.data.length > 0 ? (
                <Group gap="sm" align="center">
                    <CatalogSearch
                        key={searchKey}
                        value={params.q}
                        placeholder={t('page.search')}
                        onChange={q => {
                            onParamsChange({ q });
                        }}
                    />
                    <ShowFilter
                        plugins={searched}
                        value={show}
                        onChange={show => {
                            onParamsChange({ show });
                        }}
                    />
                    {/* No table on a phone, so no choice of one: it would be a row of five columns
                        scrolled sideways, which the cards already say better. */}
                    {phone ? undefined : (
                        <SegmentedControl
                            size="xs"
                            ml="auto"
                            aria-label={t('page.view.ariaLabel')}
                            value={params.view}
                            onChange={next => {
                                onParamsChange({ view: PLUGIN_VIEWS.find(known => known === next) ?? 'cards' });
                            }}
                            data={[
                                { value: 'cards', label: t('page.view.cards') },
                                { value: 'table', label: t('page.view.table') },
                            ]}
                        />
                    )}
                </Group>
            ) : undefined}

            {plugins.data && plugins.data.length > 0 && shown.length === 0 ? (
                <EmptyState
                    title={t('page.noMatch.title')}
                    action={
                        <Button
                            variant="default"
                            size="compact-sm"
                            onClick={() => {
                                setSearchKey(key => key + 1);
                                // The filters, not the layout: somebody reading the table wants the
                                // table back with everything in it.
                                onParamsChange({ q: PLUGINS_PAGE_DEFAULTS.q, show: 'all' });
                            }}
                        >
                            {t('page.noMatch.clear')}
                        </Button>
                    }
                >
                    {t('page.noMatch.body')}
                </EmptyState>
            ) : undefined}

            {shown.length > 0 && params.view === 'table' && !phone ? <PluginTable groups={groupByRole(shown)} /> : undefined}

            {shown.length > 0 && (params.view === 'cards' || phone)
                ? groupByRole(shown).map(({ role, plugins: members }) => (
                      <Stack key={role.key} gap="xs" component="section" aria-label={role.title}>
                          <Eyebrow>
                              {role.title} · {members.length}
                          </Eyebrow>
                          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                              {members.map(plugin => (
                                  <PluginCard key={plugin.id} plugin={plugin} />
                              ))}
                          </SimpleGrid>
                      </Stack>
                  ))
                : undefined}
        </Stack>
    );
}
