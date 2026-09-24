import { useState } from 'react';
import { Button, Group, Menu, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { useClearTrack, type TrackClear } from '../../api/catalog.queries';
import { ErrorAlert } from '../shared/error.alert';

/**
 * The five things an operator can do about a record, and what each one costs.
 *
 * `consequence` is the sentence on the confirmation, and it is the point of having one: every verb
 * here makes the station go and do work again, and the only question worth asking before pressing is
 * "what happens next". None of the four clears destroys anything the station cannot rebuild, which is
 * why the copy says what will be rebuilt rather than warning about loss.
 *
 * The fifth throws nothing away and is the only one that OVERRIDES the station: putting a refused
 * copy back on offer contradicts a provider's own answer, which nothing automatic is allowed to do.
 * Its consequence sentence says exactly that, because an operator pressing it is taking that on.
 */
// Each entry's label, title, consequence and confirm are `clear.<what>` in the catalog namespace.
const CLEARS: TrackClear[] = ['audio', 'analysis', 'enrichment', 'retry', 'offer'];

/**
 * What an operator can throw away about one record.
 *
 * A menu rather than four buttons on the page, because none of these is a thing somebody arrives
 * wanting to do: they come to find out why a record will not air, and this is what they reach for
 * once they know. Behind a confirmation each, since every one of them sends the station off to do
 * work — and the confirmation says what work, which is the part worth reading.
 *
 * The answer stays on screen after the fact. "Dropped 2 copies" and "The station was not holding any
 * copies of this record" are different facts about the record, and a menu that closed silently would
 * throw away the more interesting one.
 */
export function TrackClearMenu({ trackId }: { trackId: string }) {
    const { t } = useTranslation(['catalog', 'common']);
    const [asking, setAsking] = useState<TrackClear | undefined>();
    const [answer, setAnswer] = useState<string | undefined>();
    const clear = useClearTrack();

    return (
        <>
            <Stack gap="xs" align="flex-end">
                <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                        {/* "Clear…" named the mechanism and not the reason anyone opens this: every
                            entry here is about getting a record that will not play to play. */}
                        <Button variant="default" size="xs">
                            {t('clear.button')}
                        </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                        {/* No longer only about throwing things away: the last entry puts something
                            back. "What the station can work out again" was the label when all four
                            were clears and would be a lie over a re-offer. */}
                        <Menu.Label>{t('clear.menuLabel')}</Menu.Label>
                        {CLEARS.map(entry => (
                            <Menu.Item
                                key={entry}
                                onClick={() => {
                                    setAnswer(undefined);
                                    clear.reset();
                                    setAsking(entry);
                                }}
                            >
                                {t(`clear.${entry}.label`)}
                            </Menu.Item>
                        ))}
                    </Menu.Dropdown>
                </Menu>

                {answer ? (
                    <Text size="xs" c="dimmed" maw={420} ta="right">
                        {answer}
                    </Text>
                ) : undefined}
            </Stack>

            <Modal
                opened={asking !== undefined}
                onClose={() => setAsking(undefined)}
                title={asking === undefined ? undefined : t(`clear.${asking}.title`)}
                centered
            >
                <Stack gap="md">
                    <Text size="sm">{asking === undefined ? undefined : t(`clear.${asking}.consequence`)}</Text>

                    {/* The 409 is the one refusal worth reading in full: a record about to air is
                        left alone deliberately, and the message says what to do instead. */}
                    {clear.error ? (
                        <ErrorAlert tone="warning" title={t('clear.error.title')} error={clear.error} fallback={t('clear.error.fallback')} />
                    ) : undefined}

                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setAsking(undefined)} disabled={clear.isPending}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button
                            color="red"
                            loading={clear.isPending}
                            onClick={() => {
                                if (asking === undefined) return;
                                clear.mutate(
                                    { id: trackId, what: asking },
                                    {
                                        onSuccess: result => {
                                            setAnswer(result.detail);
                                            setAsking(undefined);
                                        },
                                    },
                                );
                            }}
                        >
                            {asking === undefined ? undefined : t(`clear.${asking}.confirm`)}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
