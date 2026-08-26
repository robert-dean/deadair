import { Card, Stack, Text, Title } from '@mantine/core';
import type { StationSettingDescriptor, StationSettings } from '@deadair/sdk';

import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { ConfigFieldsForm } from './config.fields.form';
import { PluginGrantsCard } from './plugin.grants.card';
import { StorageCard } from './storage.card';

/**
 * The sections, in the order an operator should meet them, and what each one is for.
 *
 * Not every declared group is here, and the omission is the mechanism rather than a gap: a group
 * this list does not name is drawn by whichever page claimed it. `schedule` is the one — what the
 * station plays between blocks is edited beside the timetable that makes sense of it, by
 * `SustainingPanel`, so adding it back here would draw those five settings twice.
 */
const GROUPS: { key: StationSettingDescriptor['group']; title: string; blurb: string }[] = [
    {
        key: 'station',
        title: 'Station',
        blurb: 'What the station is called and where it publishes. Icecast and Liquidsoap read these from files rendered on save, so a change reaches them on their next restart.',
    },
    {
        key: 'rotation',
        title: 'Rotation',
        blurb: 'How the station programmes itself when nothing more specific is asked for. A lineup can override any of these for itself, and a setlist or a feature ignores all of them.',
    },
    {
        key: 'playout',
        title: 'Playout',
        blurb: 'What puts the station on air, and the secret the playout bridge is gated on.',
    },
    { key: 'render', title: 'Voice and audio', blurb: 'How the station speaks, and how a programme written in parts is put together.' },
    {
        key: 'llm',
        title: 'Words',
        blurb: 'Which plugin the station asks for words. With none set up it still writes its own breaks, from what is either side of them in the running order.',
    },
    {
        key: 'analysis',
        title: 'Measurement',
        blurb: 'Which plugin measures records, so the station can trim the dead air off each one and know how long it may talk over an intro. With none set up every track still plays, unmeasured.',
    },
];

/**
 * Everything an operator can change about the station that is not a plugin's own business.
 *
 * One form per section rather than one for the page, and one save per section with it. A settings
 * page whose single button writes forty keys makes every change feel consequential; this way the
 * operator saves the thing they came to change. The API is partial either way, so a section knows
 * nothing about the others and cannot clear them.
 *
 * The rendering is `ConfigFieldsForm`, shared with the plugin settings form: same descriptors, same
 * partial-update contract, same write-only rules for secrets.
 */
export function SettingsPage() {
    const settings = useSettings();

    if (settings.isPending) {
        // The width matters as much as the shape: this page is a column of cards inside `maw={720}`,
        // and a full-width placeholder is a different page than the one that replaces it.
        return (
            <Stack gap="lg" maw={720}>
                <PageSkeleton variant="rows" count={4} />
            </Stack>
        );
    }

    if (settings.error || !settings.data) {
        return <ErrorAlert title="Settings unavailable" error={settings.error} fallback="The station settings could not be read." />;
    }

    const data = settings.data;

    return (
        <Stack gap="lg" maw={720}>
            <PageHeader
                title="Settings"
                description={
                    <Text size="sm" c="dimmed">
                        The station itself. A plugin&rsquo;s own configuration lives on that plugin&rsquo;s page.
                    </Text>
                }
            />

            {GROUPS.map(group => (
                <SettingsGroupCard key={group.key} group={group} settings={data} />
            ))}

            {/* Below the station's own settings, because these are questions somebody else asked:
                every card above is a decision the operator went looking for, and this is one waiting
                for them. Draws nothing when no plugin has asked for anything. */}
            <PluginGrantsCard />

            {/* Last, and read-only: everything above is something to change, and this is the number
                the one limit up there is set against. */}
            <StorageCard />
        </Stack>
    );
}

interface SettingsGroupCardProps {
    group: { key: StationSettingDescriptor['group']; title: string; blurb: string };
    settings: StationSettings;
}

function SettingsGroupCard({ group, settings }: SettingsGroupCardProps) {
    // A mutation per section, so a save in one does not put another section's button into a
    // pending state or show it somebody else's error.
    const save = useUpdateSettings();
    const fields = settings.descriptors.filter(descriptor => descriptor.group === group.key);

    // A group with nothing in it is not an empty card: it is a group whose settings have not been
    // built yet, and drawing a heading over nothing invites the operator to look for them.
    if (fields.length === 0) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {group.title}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {group.blurb}
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
                    submitLabel={`Save ${group.title.toLowerCase()}`}
                    failureTitle="Save failed"
                    failureMessage="The settings could not be saved."
                />
            </Stack>
        </Card>
    );
}
