import { SegmentedControl, Stack, Text } from '@mantine/core';
import type { GrantDecision, PluginGrant } from '@deadair/sdk';

import { useDecidePluginGrant, usePluginGrants } from '../../api/plugins.queries';
import type { StatusTone } from '../shared/status';

/**
 * One reading of a grant, shared by every surface that draws one.
 *
 * There are three: the settings table, the plugin's own page, and the catalogue card that only says
 * whether something is waiting. `plugin.status.tsx` exists for exactly this reason one level up — a
 * card and a detail header must not be able to disagree about what a state means — and a permission
 * is the last thing that should be described two ways in one console.
 */

/**
 * The tone each answer is drawn in.
 *
 * `fault` for undecided is the same call the silence badge makes: a plugin waiting on an answer is
 * not broken, but it is a reason something is not working, and that is what an operator scanning a
 * page is looking for. `off` for denied, because a settled decision is not an outstanding one.
 */
export const GRANT_TONES: Record<GrantDecision, StatusTone> = { allowed: 'ok', denied: 'off', undecided: 'fault' };

export const GRANT_WORDS: Record<GrantDecision, string> = { allowed: 'Allowed', denied: 'Denied', undecided: 'Waiting on you' };

/** Every capability one plugin is asking for, out of the one list the API answers with. */
export function usePluginGrantsFor(pluginId: string): PluginGrant[] {
    const grants = usePluginGrants();
    return (grants.data?.grants ?? []).filter(grant => grant.pluginId === pluginId);
}

/** Whether this plugin is waiting on an answer, which is the only thing a catalogue card says. */
export function useHasUndecidedGrant(pluginId: string): boolean {
    return usePluginGrantsFor(pluginId).some(grant => grant.decision === 'undecided');
}

export interface GrantAnswerProps {
    grant: PluginGrant;
    size?: 'xs' | 'sm';
}

/**
 * The control that answers one request.
 *
 * Three positions rather than a switch, and the third is the point: to the host, denied and
 * unanswered are the same and both refuse, but to a person they are opposite facts. A two-position
 * control would make every fresh install look like a set of deliberate refusals, and would leave an
 * operator who wants to think about it no way to say so.
 */
export function GrantAnswer({ grant, size = 'xs' }: GrantAnswerProps) {
    const decide = useDecidePluginGrant();

    return (
        <Stack gap={4} align="flex-end">
            <SegmentedControl
                size={size}
                value={grant.decision}
                disabled={decide.isPending}
                aria-label={`${grant.label} for ${grant.pluginName}`}
                onChange={value => decide.mutate({ id: grant.pluginId, capability: grant.capability, decision: value as GrantDecision })}
                data={[
                    { value: 'allowed', label: 'Allow' },
                    { value: 'denied', label: 'Deny' },
                    // Answering is not required, and taking an answer back should not mean leaving a
                    // refusal on the record.
                    { value: 'undecided', label: 'Ask later' },
                ]}
            />
            {decide.error ? (
                <Text size="xs" c="red">
                    That could not be saved.
                </Text>
            ) : undefined}
        </Stack>
    );
}

export interface GrantDescriptionProps {
    grant: PluginGrant;
}

/**
 * What was asked for, in both voices.
 *
 * Two sentences from two different authors, and they are not interchangeable. The plugin says why it
 * wants this and may say anything it likes, so it is drawn as the quotation it is; the host says
 * what allowing it actually does, in words the plugin does not get to choose. An operator weighing a
 * request needs both, and needs to know which is which.
 */
export function GrantDescription({ grant }: GrantDescriptionProps) {
    return (
        <Stack gap={2}>
            <Text size="sm" fw={500}>
                {grant.label}
            </Text>
            <Text size="sm" c="dimmed">
                &ldquo;{grant.reason}&rdquo;
            </Text>
            <Text size="xs" c="dimmed">
                {grant.describes}
            </Text>
        </Stack>
    );
}
