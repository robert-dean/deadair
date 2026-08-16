import { SegmentedControl, Stack, Text } from '@mantine/core';
import type { GrantDecision, PluginGrant } from '@deadair/sdk';

import { useDecidePluginGrant, usePluginGrants } from '../../api/plugins.queries';
import type { StatusTone } from '../shared/status';

/**
 * One reading of a grant, shared by every surface that draws one.
 *
 * Two of them: the settings table and the plugin's own page. `plugin.status.tsx` exists for exactly
 * this reason one level up — a card and a detail header must not be able to disagree about what a
 * state means — and a permission is the last thing that should be described two ways in one console.
 */

/**
 * The tone each answer is drawn in.
 *
 * `off` rather than `fault` for denied, and that is the whole reason there are two states here and
 * not three. A refused capability is a decision the station is respecting, not a fault to chase:
 * denied is the DEFAULT, so drawing it as a problem would put a warning on every plugin that has
 * ever asked for anything, including the ones an operator deliberately said no to.
 */
export const GRANT_TONES: Record<GrantDecision, StatusTone> = { allowed: 'ok', denied: 'off' };

export const GRANT_WORDS: Record<GrantDecision, string> = { allowed: 'Allowed', denied: 'Denied' };

/** Every capability one plugin is asking for, out of the one list the API answers with. */
export function usePluginGrantsFor(pluginId: string): PluginGrant[] {
    const grants = usePluginGrants();
    return (grants.data?.grants ?? []).filter(grant => grant.pluginId === pluginId);
}

export interface GrantAnswerProps {
    grant: PluginGrant;
    size?: 'xs' | 'sm';
}

/**
 * The control that answers one request.
 *
 * Two positions, because there are two answers and denied is where everything starts. A third
 * "later" position was tried and removed: nothing in the station ever asks again, so it promised a
 * reminder that does not exist, and the only other thing it bought was un-deciding — which an
 * operator does by clicking Deny, the more honest thing to leave on the record anyway.
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
