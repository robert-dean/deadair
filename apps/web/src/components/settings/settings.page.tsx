import { useState } from 'react';
import { Card, Stack, Text, Title } from '@mantine/core';
import type { ConfigFieldDescriptor, StationSettings } from '@deadair/sdk';

import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { AppearanceCard } from './appearance.card';
import { ConfigFieldsForm } from './config.fields.form';
import { PluginGrantsCard } from './plugin.grants.card';
import { SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionId } from './settings.shell';
import { UnsavedGuard } from './unsaved.guard';
import { StorageCard } from './storage.card';

/**
 * One section of Settings, as its own page.
 *
 * It was the whole page: nine cards in one scroll with a list of anchors beside them. What that
 * cost was not layout — an operator who came to change the mount read four sections they did not
 * want on the way, and the lit entry in the list came from a scroll spy that could disagree with
 * the address bar. A section is a place, so it is a route, and the URL is the only state.
 *
 * Still one form per section and one save with it, which is what it always was: the API write is
 * partial, so a section knows nothing about the others and cannot clear them. That was already true
 * when they shared a page; now nothing about the page suggests otherwise.
 */
export function SettingsSectionPage({ section: id }: SettingsSectionPageProps) {
    const section = SETTINGS_SECTIONS.find(candidate => candidate.id === id);

    // Unreachable from a route file, which names its section as a literal the union checks. Here
    // for the hand-edited URL and for the reader: `find` answers `undefined` and this says what
    // that would mean rather than letting it fall through as an empty page.
    if (section === undefined) return <ErrorAlert title="No such section" fallback={`Settings has no section called ${id}.`} />;

    // The three that answer to nothing in the registry do not need the settings read at all, so
    // they do not wait on it. Split into its own component rather than branched inside one, because
    // the difference between them IS whether a hook runs.
    if (section.group === undefined) return <StandaloneSection section={section} />;

    return <GroupSection section={section} group={section.group} />;
}

export interface SettingsSectionPageProps {
    /** Which section this page is. Every settings route names its own. */
    section: SettingsSectionId;
}

/**
 * A section whose contents are a card of its own rather than declared settings.
 *
 * Appearance writes to this browser, Storage is read-only, and Grants is somebody else's question.
 * None of them reads `GET /settings`, so none of them shows a skeleton waiting for it.
 */
function StandaloneSection({ section }: { section: SettingsSection }) {
    if (section.id === 'appearance') return <AppearanceCard />;
    if (section.id === 'storage') return <StorageCard />;
    if (section.id === 'grants') return <PluginGrantsCard />;

    // A section with no group and no card of its own is a list entry nobody finished. Said out
    // loud rather than rendered as a blank page.
    return <EmptyState title="Nothing here yet">This section is in the list but has nothing to draw yet.</EmptyState>;
}

/** A section that draws its declared settings, which is six of them. */
function GroupSection({ section, group }: { section: SettingsSection; group: NonNullable<SettingsSection['group']> }) {
    const settings = useSettings();

    // One flag rather than the set this held while every section shared a page: there is one form
    // here now, so there is nothing to aggregate.
    const [unsaved, setUnsaved] = useState(false);

    if (settings.isPending) {
        // The width matters as much as the shape: this is a card inside `maw={720}`, and a
        // full-width placeholder is a different page than the one that replaces it.
        return (
            <Stack gap="lg">
                <PageSkeleton variant="rows" count={4} />
            </Stack>
        );
    }

    if (settings.error || !settings.data) {
        return <ErrorAlert title="Settings unavailable" error={settings.error} fallback="The station settings could not be read." />;
    }

    const fields = settings.data.descriptors.filter(descriptor => descriptor.group === group);

    // A group with nothing in it is not an empty card: it is a group whose settings have not been
    // built yet, and drawing a heading over nothing invites the operator to look for them. The
    // section list leaves it out for the same reason, so this is only reachable by typing the URL.
    if (fields.length === 0) {
        return <EmptyState title={`No ${section.label.toLowerCase()} settings yet`}>Nothing declares a setting in this section yet.</EmptyState>;
    }

    return (
        <Stack gap="lg">
            <UnsavedGuard dirty={unsaved} />
            <SettingsGroupCard section={section} fields={fields} settings={settings.data} onDirtyChange={setUnsaved} />
        </Stack>
    );
}

interface SettingsGroupCardProps {
    section: SettingsSection;
    /** This section's declared fields, already filtered by the caller that checked there are any. */
    fields: readonly ConfigFieldDescriptor[];
    settings: StationSettings;
    onDirtyChange: (dirty: boolean) => void;
}

function SettingsGroupCard({ section, fields, settings, onDirtyChange }: SettingsGroupCardProps) {
    // A mutation per section, so a save in one does not put another section's button into a
    // pending state or show it somebody else's error. It reads oddly now that a section is a page
    // on its own, and it is still the right shape: the write is partial, and this is what says so.
    const save = useUpdateSettings();

    return (
        // No anchor and no `scrollMarginTop`: the section list used to jump to this card, and it
        // navigates to this page instead.
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {section.label}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {section.blurb}
                    </Text>
                </Stack>

                <ConfigFieldsForm
                    fields={fields}
                    stored={settings.values}
                    secretsConfigured={settings.configured}
                    onSubmit={submission => save.mutateAsync(submission)}
                    pending={save.isPending}
                    succeeded={save.isSuccess}
                    error={save.error}
                    submitLabel={`Save ${section.label.toLowerCase()}`}
                    failureTitle="Save failed"
                    failureMessage="The settings could not be saved."
                    onDirtyChange={onDirtyChange}
                />
            </Stack>
        </Card>
    );
}
