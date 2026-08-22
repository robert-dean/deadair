import { Button, Card, Group, Stack, Text } from '@mantine/core';

import { useRecastStation, useStationOrder } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { Eyebrow } from '../shared/eyebrow';

/**
 * What to say when the badge below is not who the listener is hearing.
 *
 * A show may name its own host — from a schedule slot, or from the box beside the brief — and it
 * keeps it, deliberately, so the presenter cannot drift back halfway through. That is the whole
 * precedence `PersonaRepository.presenting` applies: this broadcast's host, then the station's
 * active one, then nobody. The roster under this banner can only ever draw the SECOND of those, so
 * on a station running a show with its own host, "On air" sits on a card whose character is not
 * speaking, and nothing anywhere said why.
 *
 * ## It appears only when the two answers actually differ
 *
 * A banner drawn on every visit is chrome; this one is drawn when there is a discrepancy to explain,
 * which is exactly when a broadcast named somebody of its own. A show running under the station's
 * host needs no sentence, because then the badge below is the truth.
 *
 * ## The one action it offers is the one that resolves the discrepancy
 *
 * Handing the show back is the same unbound recast the on-air page's menu posts, and putting it here
 * is not a second way to steer the broadcast: it is the way out of the state this banner exists to
 * describe. Everything else about the show — choosing a DIFFERENT host for it, the brief, the order
 * — stays on the page about what is on air, where the rest of that vocabulary lives.
 */
export function PresentingBanner() {
    const order = useStationOrder();
    const recast = useRecastStation();

    const personaLabel = order.data?.personaLabel;
    // The broadcast having named somebody is the fact worth drawing, and the label is only how it is
    // said. A show whose host was deleted out from under it keeps the id and loses the label, which
    // is still a discrepancy an operator wants told about.
    if (order.data?.personaId === undefined) return undefined;

    const failure = recast.isError ? apiErrorMessage(recast.error, 'The show kept the host it had.') : undefined;

    return (
        <Card withBorder>
            <Stack gap="xs">
                <Eyebrow c="grape">Presenting now</Eyebrow>
                <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
                    <Text size="sm">
                        The show on air is presented by <strong>{personaLabel ?? 'a character this station no longer has'}</strong>, which the
                        broadcast named for itself. Putting a persona on air below changes the station&apos;s own host, which takes over when this
                        show ends.
                    </Text>
                    <Button
                        variant="default"
                        size="compact-sm"
                        loading={recast.isPending}
                        style={{ flexShrink: 0 }}
                        onClick={() => recast.mutate({})}
                    >
                        Hand it back
                    </Button>
                </Group>

                {failure ? (
                    <Text size="xs" c="red.4">
                        {failure}
                    </Text>
                ) : (
                    <Text size="xs" c="dimmed">
                        Handing it back re-writes the breaks already written for this show and not yet aired, in whoever&apos;s character it lands in.
                    </Text>
                )}
            </Stack>
        </Card>
    );
}
