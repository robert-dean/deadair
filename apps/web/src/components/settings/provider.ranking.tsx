import { useState } from 'react';
import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { useUpdateSettings } from '../../api/settings.queries';
import { notifySaved } from '../shared/notify';
import { StatusLamp } from '../shared/status.lamp';
import { statusOf } from '../plugins/plugin.status';
import { RowControls } from './config.fields.form';

/**
 * The order the station asks a capability's plugins in, as a list of the plugins themselves.
 *
 * ## It starts filled in
 *
 * The generic `list` field this replaces starts EMPTY, with a placeholder saying that sources are
 * asked alphabetically. So an operator who wants one source moved up has to first rebuild the
 * order they already have — add three rows, pick a plugin in each, from a dropdown of ids —
 * before they can depart from it. This draws the order the station is actually using, which is
 * what the endpoint answers, and moving something is one click on the thing itself.
 *
 * Saving therefore writes the WHOLE list rather than a subset. That is a real change in meaning
 * and it is the right one: an operator looking at a list of four and moving the second to the top
 * has said something about all four, and storing only the one they touched would leave the rest
 * to a fallback they cannot see.
 *
 * ## Names, not ids
 *
 * The stored value is plugin ids, because that is what the station resolves. Nothing here shows
 * one: a row is the plugin's own name, which is what the operator knows it by, and a cell reading
 * `deadair.musicbrainz` was the old field's most visible tell that it was a text box wearing a
 * table's clothes.
 *
 * ## Arrows rather than dragging
 *
 * The console has no drag anywhere, a table row is a small target, and these lists are short. The
 * controls are `RowControls`, shared with the generic field, labelled with the plugin's name.
 */
export function ProviderRanking({ state }: { state: ProviderCapabilityState }) {
    const update = useUpdateSettings();

    // Only the plugins that can currently answer are orderable: the rest are not in any asking
    // order, so there is no position to give them. They are still drawn, below.
    const asked = state.candidates.filter(candidate => candidate.position !== undefined);
    const idle = state.candidates.filter(candidate => candidate.position === undefined);

    // The server's answer is the truth about this list, and it changes under the component for
    // reasons other than this form: a plugin enabled on another tab, a save that reordered it.
    const serverOrder = asked.map(candidate => candidate.pluginId).join('\n');

    const [order, setOrder] = useState<string[]>(() => asked.map(candidate => candidate.pluginId));
    // Adjusted during render rather than in an effect, which is React's own pattern for "this
    // state derives from a prop and has to follow it": an effect would draw the stale order once,
    // then re-render, and `react-hooks/set-state-in-effect` says so.
    const [seen, setSeen] = useState(serverOrder);
    if (seen !== serverOrder) {
        setSeen(serverOrder);
        setOrder(serverOrder.length === 0 ? [] : serverOrder.split('\n'));
    }

    const byId = new Map(state.candidates.map(candidate => [candidate.pluginId, candidate]));
    const dirty = order.join('\n') !== serverOrder;
    // Whether the operator has said anything at all, as opposed to looking at the station's own
    // default. The raw stored value rather than `listed`, so an order that happens to match the
    // default still reads as theirs.
    const theirs = state.configured.trim().length > 0;

    const move = (index: number, by: -1 | 1) => {
        setOrder(current => {
            const next = [...current];
            const target = index + by;
            if (target < 0 || target >= next.length) return current;
            [next[index], next[target]] = [next[target] as string, next[index] as string];
            return next;
        });
    };

    const save = () => {
        update.mutate(
            { [state.settingKey]: JSON.stringify(order.map(source => ({ source }))) },
            { onSuccess: () => notifySaved('The order') },
        );
    };

    const reset = () => {
        // `null` clears the row rather than storing an empty list, so the station falls back to
        // the order it had before anybody set one. An empty list would mean the same thing today
        // and reads as a decision rather than the absence of one.
        update.mutate({ [state.settingKey]: null }, { onSuccess: () => notifySaved('The order') });
    };

    return (
        <Stack gap="sm">
            <Group gap="xs">
                <Badge size="sm" variant="light" color={theirs ? 'teal' : 'gray'} tt="none">
                    {theirs ? 'Your order' : 'Default order'}
                </Badge>
                {state.stale.length > 0 && (
                    <Badge size="sm" variant="light" color="yellow" tt="none">
                        {state.stale.length === 1 ? '1 listed plugin is not running' : `${state.stale.length} listed plugins are not running`}
                    </Badge>
                )}
            </Group>

            <Table verticalSpacing="xs" horizontalSpacing="xs">
                <Table.Tbody>
                    {order.map((pluginId, index) => {
                        const candidate = byId.get(pluginId);
                        return (
                            <Table.Tr key={pluginId}>
                                <Table.Td w={32}>
                                    <Text size="sm" c="dimmed" className="da-num">
                                        {index + 1}
                                    </Text>
                                </Table.Td>
                                <Table.Td>
                                    <Text size="sm">{candidate?.name ?? pluginId}</Text>
                                </Table.Td>
                                <Table.Td w={108}>
                                    <RowControls
                                        index={index}
                                        last={order.length - 1}
                                        disabled={update.isPending}
                                        name={candidate?.name ?? pluginId}
                                        onMove={move}
                                    />
                                </Table.Td>
                            </Table.Tr>
                        );
                    })}
                </Table.Tbody>
            </Table>

            {idle.length > 0 && (
                <Stack gap="xxs">
                    {idle.map(candidate => (
                        <Group key={candidate.pluginId} gap="xs" wrap="nowrap">
                            <Text size="sm" c="dimmed">
                                {candidate.name}
                            </Text>
                            <StatusLamp tone={statusOf(candidate.status).tone} label={statusOf(candidate.status).label} />
                            <Text size="xs" c="dimmed">
                                {candidate.enabled ? 'switched on and not answering, so it is not asked' : 'not switched on, so it is not asked'}
                            </Text>
                        </Group>
                    ))}
                </Stack>
            )}

            {state.stale.length > 0 && (
                // Ordering never gates, so these cost the station nothing — which is exactly why
                // they have to be said. A line in a saved order that does nothing is one an
                // operator cannot tell from one that works.
                <Text size="xs" c="dimmed">
                    Your saved order also names {state.stale.join(', ')}, which nothing installed answers to. It is ignored. Saving this list again
                    drops it.
                </Text>
            )}

            <Group gap="xs">
                <Button size="xs" onClick={save} loading={update.isPending} disabled={!dirty}>
                    Save order
                </Button>
                {theirs && (
                    <Button size="xs" variant="subtle" color="gray" onClick={reset} disabled={update.isPending}>
                        Reset to default
                    </Button>
                )}
            </Group>
        </Stack>
    );
}
