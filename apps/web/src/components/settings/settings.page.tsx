import { Box, Card, Stack, Text, Title } from '@mantine/core';
import type { StationSettings } from '@deadair/sdk';

import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { AppearanceCard } from './appearance.card';
import { ConfigFieldsForm } from './config.fields.form';
import { PluginGrantsCard } from './plugin.grants.card';
import { SETTINGS_SECTIONS, type SettingsSection } from './settings.shell';
import { StorageCard } from './storage.card';

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
            <Stack gap="lg">
                <PageSkeleton variant="rows" count={4} />
            </Stack>
        );
    }

    if (settings.error || !settings.data) {
        return <ErrorAlert title="Settings unavailable" error={settings.error} fallback="The station settings could not be read." />;
    }

    const data = settings.data;

    return (
        <Stack gap="lg">
            {SETTINGS_SECTIONS.map(section => (
                <SettingsSectionCard key={section.id} section={section} settings={data} />
            ))}
        </Stack>
    );
}

interface SettingsSectionCardProps {
    section: SettingsSection;
    settings: StationSettings;
}

/**
 * One section of the page, whichever of the three kinds it is.
 *
 * The three used to be laid out by hand — six from a list, Appearance wedged in after Station by a
 * key comparison, Storage and Grants tacked on at the end — which is why the order of the page and
 * the order of the section list beside it were two facts that had to be kept the same by reading
 * them both. Now there is one order and this switches on what the section says it is.
 */
function SettingsSectionCard({ section, settings }: SettingsSectionCardProps) {
    // A section that is a whole route is not drawn here at all. It is in the list because the list
    // is navigation; the page is only the part of it that is cards.
    if (section.route !== undefined) return undefined;

    // The cards that answer to nothing in the registry, each with its own reason for being on this
    // page. See `SettingsSection`.
    if (section.id === 'appearance') return <AppearanceCard />;

    // Read-only: everything else is something to change, and this is the number the one limit up
    // there is set against.
    if (section.id === 'storage')
        return (
            <Box id={section.id} style={{ scrollMarginTop: 76 }}>
                <StorageCard />
            </Box>
        );

    // Questions somebody else asked, where every card above is a decision the operator went looking
    // for. Draws nothing when no plugin has asked for anything.
    if (section.id === 'grants')
        return (
            <Box id={section.id} style={{ scrollMarginTop: 76 }}>
                <PluginGrantsCard />
            </Box>
        );

    if (section.group === undefined) return undefined;

    return <SettingsGroupCard section={section} group={section.group} settings={settings} />;
}

interface SettingsGroupCardProps {
    section: SettingsSection;
    group: NonNullable<SettingsSection['group']>;
    settings: StationSettings;
}

function SettingsGroupCard({ section, group, settings }: SettingsGroupCardProps) {
    // A mutation per section, so a save in one does not put another section's button into a
    // pending state or show it somebody else's error.
    const save = useUpdateSettings();
    const fields = settings.descriptors.filter(descriptor => descriptor.group === group);

    // A group with nothing in it is not an empty card: it is a group whose settings have not been
    // built yet, and drawing a heading over nothing invites the operator to look for them.
    if (fields.length === 0) return undefined;

    return (
        // The anchor the section list jumps to. `scrollMarginTop` clears the sticky header, which
        // would otherwise land on top of the heading it just scrolled to.
        <Card padding="lg" id={section.id} style={{ scrollMarginTop: 76 }}>
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
                />
            </Stack>
        </Card>
    );
}
