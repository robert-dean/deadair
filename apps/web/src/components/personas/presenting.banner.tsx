import { Button, Card, Divider, Group, Popover, Stack, Text } from '@mantine/core';
import { IconAdjustmentsHorizontal } from '@tabler/icons-react';
import type { Persona } from '@deadair/sdk';
import { Trans, useTranslation } from 'react-i18next';

import { useRecastStation, useStationOrder } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { useSignedIn } from '../../auth/session.store';
import { Eyebrow } from '../shared/eyebrow';
import { presents } from './persona.kind';
import { PresenterNamePanel } from './presenter.name.panel';
import { StoryWaitPanel } from './story.wait.panel';

/**
 * Who is presenting right now, as one strip above the roster, and the settings that reach every host.
 *
 * ## One strip, always drawn
 *
 * The page used to stack three cards above the roster: this banner (only during a show with its own
 * host), the presenter name, and the story wait. The two settings were each a full-width card for
 * one value an operator changes perhaps once, sitting between them and the characters they came
 * for. Now the strip says who is on air in every state, and the two settings open from it in a
 * popover, as the same forms with the same save footers.
 *
 * ## When the broadcast named its own host
 *
 * A show may name its own host — from a schedule slot, or from the box beside the brief — and it
 * keeps it, deliberately, so the presenter cannot drift back halfway through. That is the whole
 * precedence `PersonaRepository.presenting` applies: this broadcast's host, then the station's
 * active one, then nobody. The roster's "On air now" badge already follows that, but the station's
 * own host keeps its badge too, and nothing said why the two differ. So in that state the strip says
 * which show named whom, and offers the one action that resolves it: handing the show back is the
 * same unbound recast the on-air page's menu posts. Choosing a DIFFERENT host for the show stays on
 * the page about what is on air, where the rest of that vocabulary lives.
 */
export function PresentingBanner({ roster }: PresentingBannerProps) {
    const order = useStationOrder(useSignedIn());
    const recast = useRecastStation();
    const { t } = useTranslation('personas');

    // The broadcast having named somebody is the fact worth drawing, and the label is only how it is
    // said. A show whose host was deleted out from under it keeps the id and loses the label, which
    // is still a discrepancy an operator wants told about.
    const named = order.data?.personaId !== undefined;
    const failure = recast.isError ? apiErrorMessage(recast.error, t('presenting.failure')) : undefined;
    const speaking = roster.find(persona => persona.presenting);
    const coHosts = roster.filter(persona => persona.coHosting).map(persona => persona.label);

    return (
        <Card>
            <Group justify="space-between" align="flex-start" gap="md">
                <Stack gap="xxs" style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <Eyebrow c={named ? 'grape' : undefined}>{t('presenting.eyebrow')}</Eyebrow>
                    <Text size="sm">
                        {/* The name goes in as the element's own child rather than as a value, so a name
                            with a `<` in it is never parsed as markup. */}
                        {named ? (
                            <Trans
                                t={t}
                                i18nKey="presenting.body"
                                components={{ strong: <strong>{order.data?.personaLabel ?? t('presenting.unknownHost')}</strong> }}
                            />
                        ) : speaking === undefined ? (
                            t('presenting.nobody')
                        ) : (
                            <Trans
                                t={t}
                                i18nKey={speaking.defaultHost ? 'presenting.speakingOwn' : 'presenting.speaking'}
                                components={{ strong: <strong>{speaking.label}</strong> }}
                            />
                        )}
                    </Text>
                    {coHosts.length > 0 ? (
                        <Text size="xs" c="dimmed">
                            {t('presenting.coHosts', { count: coHosts.length, names: coHosts.join(', ') })}
                        </Text>
                    ) : undefined}
                    {named ? (
                        failure ? (
                            <Text size="xs" c="red.4">
                                {failure}
                            </Text>
                        ) : (
                            <Text size="xs" c="dimmed">
                                {t('presenting.note')}
                            </Text>
                        )
                    ) : undefined}
                </Stack>

                <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                    {named ? (
                        <Button variant="default" size="compact-sm" loading={recast.isPending} onClick={() => recast.mutate({})}>
                            {t('presenting.handBack')}
                        </Button>
                    ) : undefined}
                    <PresenterSettings hosts={roster.filter(presents)} />
                </Group>
            </Group>
        </Card>
    );
}

export interface PresentingBannerProps {
    /** The whole roster, as the page already holds it: who is speaking is read off its flags. */
    roster: readonly Persona[];
}

/**
 * The two settings that are about every host rather than one: what an unnamed host is called, and
 * how long a story rests between tellings. A popover rather than a dialog, because each is one field
 * and an operator should still see the strip it hangs from.
 */
function PresenterSettings({ hosts }: { hosts: readonly Persona[] }) {
    const { t } = useTranslation('personas');

    return (
        <Popover position="bottom-end" width={440} withinPortal shadow="md" trapFocus>
            <Popover.Target>
                <Button variant="light" size="compact-sm" leftSection={<IconAdjustmentsHorizontal size={14} />}>
                    {t('presenting.settings')}
                </Button>
            </Popover.Target>
            <Popover.Dropdown maw="calc(100vw - 32px)">
                <Stack gap="md">
                    <PresenterNamePanel hosts={hosts} />
                    <Divider />
                    <StoryWaitPanel />
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
}
