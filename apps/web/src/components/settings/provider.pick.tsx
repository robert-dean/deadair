import { Group, Select, Stack, Text } from '@mantine/core';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { useUpdateSettings } from '../../api/settings.queries';
import { ErrorAlert } from '../shared/error.alert';
import { notifySaved } from '../shared/notify';
import { StatusLamp } from '../shared/status.lamp';
import { statusOf } from '../plugins/plugin.status';

/** What the empty setting is called. Its own constant because two places below have to agree. */
const AUTOMATIC = '';

/**
 * The one plugin a capability uses, chosen by name.
 *
 * ## Automatic is a real choice and says what it resolves to
 *
 * An empty setting means the station takes the first candidate by id, which is a sensible default
 * and was previously explained only in a sentence of help text under a free-text box. Here it is
 * the first option and it names the plugin it currently resolves to, so "Automatic (currently
 * Kokoro)" is a thing an operator can read rather than infer.
 *
 * ## The dangerous state is loud
 *
 * Naming a plugin is an INSTRUCTION, and `selectPlugin` never falls back from one: a station
 * whose `render.speechPluginId` names a plugin that is disabled, quarantined or uninstalled has
 * no speech at all, silently, until somebody reads a log. It was invisible in the console, which
 * showed the id sitting in a text box looking exactly like a working one. This says it in red,
 * and keeps the named id in the list so the operator can see what they are looking at.
 */
export function ProviderPick({ state }: { state: ProviderCapabilityState }) {
    const update = useUpdateSettings();

    const active = state.candidates.filter(candidate => candidate.position !== undefined);
    const idle = state.candidates.filter(candidate => candidate.position === undefined);
    const inUse = active.find(candidate => candidate.inUse);
    const named = state.configured.trim();

    const options = [
        { value: AUTOMATIC, label: inUse && named.length === 0 ? `Automatic (currently ${inUse.name})` : 'Automatic' },
        ...active.map(candidate => ({ value: candidate.pluginId, label: candidate.name })),
        // A plugin that is named and cannot answer is still the stored value, so it has to be in
        // the list or the Select would draw as if nothing were set — which is the one thing this
        // state must not look like.
        ...idle
            .filter(candidate => candidate.pluginId === named)
            .map(candidate => ({ value: candidate.pluginId, label: `${candidate.name} (not running)` })),
        // And an id naming nothing installed at all, for the same reason.
        ...(state.stale.includes(named) && !idle.some(candidate => candidate.pluginId === named) ? [{ value: named, label: `${named} (not installed)` }] : []),
    ];

    return (
        <Stack gap="sm">
            {state.unanswered && (
                <ErrorAlert
                    title="Nothing is doing this job"
                    fallback={`${named} is named here and is not running, and naming a plugin means the station uses that one or none. Choose one that is running, or set this back to Automatic.`}
                />
            )}

            <Select
                label="Doing this job"
                data={options}
                value={named}
                allowDeselect={false}
                disabled={update.isPending}
                w={320}
                onChange={value => {
                    if (value === null) return;
                    update.mutate({ [state.settingKey]: value }, { onSuccess: () => notifySaved('The plugin') });
                }}
            />

            {idle.length > 0 && (
                <Stack gap="xxs">
                    {idle.map(candidate => (
                        <Group key={candidate.pluginId} gap="xs" wrap="nowrap">
                            <Text size="sm" c="dimmed">
                                {candidate.name}
                            </Text>
                            <StatusLamp tone={statusOf(candidate.status).tone} label={statusOf(candidate.status).label} />
                            <Text size="xs" c="dimmed">
                                {candidate.enabled ? 'switched on and not answering' : 'not switched on'}
                            </Text>
                        </Group>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}
