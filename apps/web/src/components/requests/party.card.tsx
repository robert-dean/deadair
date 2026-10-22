import { useState } from 'react';
import { Alert, Button, Card, Group, Modal, NumberInput, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';

import { isLoopback, partyLink, useEndParty, useParty, useStartParty } from '../../api/party.queries';
import { isForbidden } from '../../api/sdk.error';
import { formatClock } from '../../i18n/format.locale';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { notifyDone } from '../shared/notify';

/** How long a pass lasts unless the operator says otherwise, matching the station's own default. */
const DEFAULT_HOURS = 6;

/**
 * A party, from the operator's side: start one, show its code, put it on a TV, end it.
 *
 * At the top of Requests because what a party produces is requests, and an operator watching a party
 * is watching this list. The code is drawn black on white whatever the theme, as the check-up draws
 * its own, because a phone's camera reads contrast and not intent. Nothing here is shown to somebody
 * without the operator's role: the route answers 403, and the card draws nothing rather than an error,
 * because the requests list below already says so in a sentence.
 */
export function PartyCard() {
    const { t } = useTranslation('requests');
    const party = useParty();
    const start = useStartParty();
    const end = useEndParty();
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const [hours, setHours] = useState<number | string>(DEFAULT_HOURS);

    if (isForbidden(party.error) || party.isPending) return undefined;

    const live = party.data?.party;

    return (
        <Card>
            <Stack gap="sm">
                <Eyebrow>{t('party.title')}</Eyebrow>
                {party.error ? <ErrorAlert title={t('party.error.title')} error={party.error} fallback={t('party.error.fallback')} /> : undefined}

                {live === undefined ? (
                    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                        <Text size="sm" c="dimmed" maw={560}>
                            {t('party.off')}
                        </Text>
                        <Button variant="light" onClick={() => setStarting(true)}>
                            {t('party.start')}
                        </Button>
                    </Group>
                ) : (
                    <Group align="flex-start" gap="lg" wrap="wrap">
                        <QRCodeSVG
                            value={partyLink(live.token)}
                            size={152}
                            marginSize={2}
                            bgColor="#ffffff"
                            fgColor="#000000"
                            title={t('party.qrTitle')}
                        />
                        <Stack gap="xs" style={{ flex: '1 1 260px' }}>
                            <Text size="sm">{t('party.on', { time: formatClock(live.expiresAt.toJSDate()) })}</Text>
                            <Text size="sm" c="dimmed" className="da-num">
                                {t('party.guests', { count: live.guests })}
                            </Text>
                            {isLoopback() ? (
                                <Alert color="yellow" variant="light" p="xs">
                                    <Text size="xs">{t('party.loopback', { origin: window.location.origin })}</Text>
                                </Alert>
                            ) : undefined}
                            <Group gap="xs">
                                <Button size="compact-sm" renderRoot={(props: object) => <Link to="/party-poster" {...props} />}>
                                    {t('party.poster')}
                                </Button>
                                <CopyButton value={partyLink(live.token)} />
                                <Button size="compact-sm" variant="subtle" color="red" onClick={() => setEnding(true)}>
                                    {t('party.end')}
                                </Button>
                            </Group>
                            <Text size="xs" c="dimmed">
                                {t('party.tv')}
                            </Text>
                        </Stack>
                    </Group>
                )}
            </Stack>

            <Modal opened={starting} onClose={() => setStarting(false)} title={t('party.startTitle')}>
                <Stack gap="md">
                    <NumberInput
                        label={t('party.hours')}
                        description={t('party.hoursHint')}
                        min={1}
                        max={24}
                        step={1}
                        allowDecimal={false}
                        value={hours}
                        onChange={setHours}
                    />
                    {start.error ? <ErrorAlert title={t('party.startError')} error={start.error} fallback={t('party.unchanged')} /> : undefined}
                    <Button
                        loading={start.isPending}
                        onClick={() =>
                            void start.mutateAsync(Math.min(24, Math.max(1, Math.round(Number(hours) || DEFAULT_HOURS)))).then(() => {
                                setStarting(false);
                                notifyDone(t('party.started'));
                            })
                        }
                    >
                        {t('party.start')}
                    </Button>
                </Stack>
            </Modal>

            <ConfirmModal
                opened={ending}
                onClose={() => setEnding(false)}
                onConfirm={() =>
                    void end.mutateAsync().then(() => {
                        setEnding(false);
                        notifyDone(t('party.ended'));
                    })
                }
                title={t('party.endTitle')}
                confirmLabel={t('party.end')}
                confirming={end.isPending}
                error={end.error}
                errorTitle={t('party.endError')}
                errorFallback={t('party.unchanged')}
            >
                <Text size="sm">{t('party.endBody')}</Text>
            </ConfirmModal>
        </Card>
    );
}
