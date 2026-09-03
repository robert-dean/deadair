import { useState } from 'react';
import { Anchor, Box, Button, Card, Collapse, Divider, Group, Stack, Text } from '@mantine/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { AttentionEvidence, AttentionItem } from '@deadair/sdk';

import { attentionDestinationOf } from '../shell/attention.destination';
import { useDisclosureIds } from '../shared/disclosure';
import { EmptyState } from '../shared/empty.state';
import { severityColor, type Severity } from '../shared/status';

/**
 * Everything wrong or waiting, worst first.
 *
 * ## Why it is a page rather than a badge on each page
 *
 * Every fact here was already visible somewhere — a benched copy on the catalog, a plugin that will
 * not start on its own card, the silence cause on the transport strip. What none of them could do is
 * tell an operator who has not opened that page. So the list is the one surface that answers "is
 * anything wrong" without knowing where to look, and every row carries the page that can act on it.
 *
 * ## Nothing here is derived
 *
 * The station composes this, orders it and writes the sentences, so what the console decides is how
 * to draw a severity and where a route points. That is deliberate: the silence wording in particular
 * belongs to `silence.diagnosis.ts`, and a second phrasing on the landing page would be a second
 * thing to disagree with the badge and the activity feed.
 *
 * That extends to the evidence a row may carry. "4 records have no copy left that will play" is a
 * category, and the four records and the four reasons behind it are the station's own sentences
 * about each one — not this component reaching for `lastError` and composing a second account of it.
 *
 * ## An unknown route draws no link rather than a broken one
 *
 * The router's `to` is typed against the registered routes, which is what stops a link pointing at a
 * page that does not exist — the failure this console has already had once. A path from the API is a
 * string, so it is matched against the routes that exist and a row whose destination is not one of
 * them keeps its sentence and loses its link.
 */
export interface AttentionListProps {
    items: readonly AttentionItem[];
    /**
     * The route this list is being drawn on, so a row does not offer a button to the page you are
     * reading it on.
     *
     * The desk is the case: it draws this list AND is where `/onair` resolves to, so every row about
     * the broadcast carried a `Desk →` button that went nowhere. Passed rather than read off the
     * router because "would this move me" is not the same question as "does this route match" — the
     * Tracks list is a legitimate destination from the Tracks list when the filter differs.
     */
    here?: LinkProps['to'];
}

export function AttentionList({ items, here }: AttentionListProps) {
    if (items.length === 0) {
        return (
            <EmptyState>
                Nothing needs you. The station is airing, its plugins are up, and every record in front of it can be fetched. Anything that changes
                shows up here.
            </EmptyState>
        );
    }

    return (
        <Card withBorder padding={0}>
            <Stack gap={0}>
                {items.map((item, index) => (
                    <Box key={`${item.code}:${item.route}`}>
                        {index === 0 ? undefined : <Divider />}
                        <Row item={item} here={here} />
                    </Box>
                ))}
            </Stack>
        </Card>
    );
}

function Row({ item, here }: { item: AttentionItem; here?: LinkProps['to'] }) {
    const destination = attentionDestinationOf(item.route);
    const elsewhere = destination !== undefined && destination.link.to !== here;

    return (
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md" p="md">
            <Group align="flex-start" wrap="nowrap" gap="sm" style={{ minWidth: 0 }}>
                {/* A severity, not a status: this dot says how bad, and `StatusLamp` says what state
                    a thing is in. `status.ts` keeps the two vocabularies apart on purpose, because
                    they disagree about red — red on a lamp means ON AIR. */}
                <Box w={8} h={8} mt={7} bg={`${severityColor[item.severity as Severity]}.6`} style={{ borderRadius: '50%', flexShrink: 0 }} />
                <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text fw={600} size="sm">
                        {item.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {item.detail}
                    </Text>
                    <Evidence item={item} />
                </Stack>
            </Group>

            {/* The fix, ON the row that reports the problem, which is the whole reason this list is
                worth landing on: a sentence saying spotify will not start, with the page that can
                reconnect it a nav-hunt away, is a sentence an operator reads and then goes looking.
                A button rather than a text link for the same reason — it is the row's action.

                It is deliberately labelled with the DESTINATION rather than with the remedy. The
                station sends a route and no verb, so a button reading "Reconnect Spotify" would be
                this console inventing a claim about what the click does; "Plugin →" is exactly what
                it does. See the note in `desk.page.tsx`. */}
            {elsewhere ? (
                <Button
                    variant="light"
                    size="compact-sm"
                    style={{ flexShrink: 0 }}
                    // Spread whole rather than picked apart into three branches, one per shape a
                    // destination might have. The branches existed because `params` and `search`
                    // were loose records here and could not be handed to a typed `Link` together;
                    // they are the router's own props now, so there is one shape and one arm.
                    renderRoot={(props: object) => <Link {...destination.link} {...props} />}
                >
                    {destination.label} →
                </Button>
            ) : undefined}
        </Group>
    );
}

/**
 * The records a row is actually about, and what happened to each.
 *
 * Closed by default and closed on purpose: the row above it is the answer most visits want, and four
 * rows each unfolding five sentences is a desk nobody scans. What it removes is the walk — the fetch
 * error behind "4 records are failing to download" was stored, contracted and rendered all along, and
 * reachable only by narrowing the library, finding the record, opening it and hovering a table cell.
 *
 * Nothing is drawn when the station sent none, which is every row that has no list behind it: a
 * silence, a plugin that will not start.
 */
function Evidence({ item }: { item: AttentionItem }) {
    const [open, setOpen] = useState(false);
    const { trigger, panelId } = useDisclosureIds(open);
    const evidence = item.evidence ?? [];

    if (evidence.length === 0) return undefined;

    // The station caps what it sends and `count` stays the true figure, so a row saying four and
    // showing two has to say so rather than letting the shorter list read as the whole of it.
    const more = Math.max(0, (item.count ?? evidence.length) - evidence.length);

    return (
        <Box pt={4}>
            <Anchor component="button" type="button" size="xs" onClick={() => setOpen(current => !current)} {...trigger}>
                {open ? 'Hide what failed' : 'Show what failed'}
            </Anchor>
            {/* Mounted only while open, the way `track.expansion.tsx` mounts its panel: a closed
                row costs nothing, and a reason nobody has asked for is not in the document to be
                read out or searched. */}
            <Collapse id={panelId} expanded={open}>
                {open ? (
                    <Stack gap="xs" pt="xs">
                        {evidence.map((piece, index) => (
                            <Piece key={`${piece.route ?? piece.label}:${index}`} piece={piece} />
                        ))}
                        {more > 0 ? (
                            <Text size="xs" c="dimmed">
                                … and {more} more
                            </Text>
                        ) : undefined}
                    </Stack>
                ) : undefined}
            </Collapse>
        </Box>
    );
}

/** One record, its reason, and the page holding the whole of it where there is one. */
function Piece({ piece }: { piece: AttentionEvidence }) {
    const destination = piece.route === undefined ? undefined : attentionDestinationOf(piece.route);

    return (
        <Stack gap={1} style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
                <Text size="xs" fw={500} style={{ minWidth: 0 }}>
                    {piece.label}
                </Text>
                {/* `renderRoot` rather than `component={Link}`, and the `: object` is the rule rather
                    than decoration: the polymorphic form erases the router's own types and with them
                    the check that `params` matches the path. */}
                {destination ? (
                    <Anchor renderRoot={(props: object) => <Link {...destination.link} {...props} />} size="xs" style={{ flexShrink: 0 }}>
                        {destination.label} →
                    </Anchor>
                ) : undefined}
            </Group>
            <Text size="xs" c="dimmed">
                {piece.reason}
            </Text>
        </Stack>
    );
}
