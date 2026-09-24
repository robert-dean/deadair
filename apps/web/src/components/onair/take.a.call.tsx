import { Button, Group, Popover, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRequestProduction } from '../../api/productions.queries';
import { apiErrorMessage } from '../../api/sdk.error';

/**
 * Put somebody on the phone, now.
 *
 * ## Why this is a production and not a break
 *
 * Every other way the station talks is a BREAK: one segment, one script, one voice. A phone-in is
 * two people, and two voices is two segments — so what this asks for is a short production, which is
 * the only shape on the station that airs as several contiguous turns and enters the running order
 * whole. That is also why it cannot be instant: the turns are written and spoken one at a time, over
 * minutes, and the block drops in when the last of them is ready.
 *
 * ## It inherits the show rather than asking about it again
 *
 * The broadcast's own host presents the call, and the broadcast's brief is what the call is about
 * unless the operator says otherwise. Both are already on the running order, so passing them is the
 * difference between a phone-in that belongs to this programme and one that belongs to nothing.
 *
 * ## A popover, for the same reason Replan has one
 *
 * The subject belongs in the same gesture. Somebody taking a call usually has one in mind — and the
 * box is seeded with the show's brief rather than left empty, so pressing straight through is the
 * ordinary case and typing over it is the deliberate one.
 */
export interface TakeACallProps {
    /** What this broadcast was asked to play, which is what the call is about unless it is changed. */
    brief: string;
    /** Who is hosting the broadcast, when it named somebody. Absent presents it as the station's own host. */
    personaId?: string;
    disabled?: boolean;
}

export function TakeACall({ brief, personaId, disabled = false }: TakeACallProps) {
    const { t } = useTranslation(['onair', 'common']);
    const [open, setOpen] = useState(false);
    const [about, setAbout] = useState(brief);
    const request = useRequestProduction();

    const failure = request.isError ? apiErrorMessage(request.error, t('call.failed')) : undefined;

    const send = () => {
        const subject = about.trim();
        request.mutate({
            // The kind is what decides there is a caller at all: `render.dialogueKinds` names it,
            // and a kind that is not in that list produces one voice reading for three minutes.
            kind: 'callin',
            // No title. The station names it after its kind and the moment, which is what somebody
            // pressing this wants rather than a box standing between them and the button.
            ...(subject.length === 0 ? {} : { brief: subject }),
            ...(personaId === undefined ? {} : { personaId }),
        });
        setOpen(false);
    };

    return (
        <Popover opened={open} onChange={setOpen} position="bottom-start" width={380} withArrow shadow="md" trapFocus>
            <Popover.Target>
                <Tooltip label={failure ?? t('call.hint')} color={failure ? 'red' : undefined} multiline maw={320}>
                    <Button
                        variant="light"
                        color={failure ? 'red' : undefined}
                        loading={request.isPending}
                        disabled={disabled}
                        onClick={() => setOpen(current => !current)}
                    >
                        {t('call.take')}
                    </Button>
                </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
                <Stack gap="sm">
                    <Text size="sm">{t('call.intro')}</Text>
                    <TextInput
                        label={t('call.aboutLabel')}
                        placeholder={t('call.aboutPlaceholder')}
                        value={about}
                        maxLength={4000}
                        onChange={event => setAbout(event.currentTarget.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') send();
                        }}
                    />
                    <Text size="xs" c="dimmed">
                        {t('call.seeded')}
                    </Text>
                    <Group justify="flex-end">
                        <Button variant="subtle" color="gray" onClick={() => setOpen(false)}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button onClick={send}>{t('call.take')}</Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                        {t('call.wait')}
                    </Text>
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
}
