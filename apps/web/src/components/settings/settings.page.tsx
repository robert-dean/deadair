import { Card, Stack, Text, Title } from '@mantine/core';
import type { StationSettingDescriptor, StationSettings } from '@deadair/sdk';

import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { ConfigFieldsForm } from './config.fields.form';

/** The sections, in the order an operator should meet them, and what each one is for. */
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
    { key: 'render', title: 'Voice', blurb: 'How the station speaks.' },
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
        return <Text c="dimmed">Loading…</Text>;
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
                <Stack gap={4}>
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
