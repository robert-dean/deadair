import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Modal, Stack, Text, TextInput, Textarea, Tooltip, UnstyledButton } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import type { ListenerRequest, RequestableTrack } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useCreateRequest, useRequestSearch } from '../../api/requests.queries';
import { EMPTY_FORM, PARTY_RULES, outcomeOf, requestBody, rowKey, searchTerm, type PartyForm } from '../../party/party.rules';
import { ErrorAlert } from '../shared/error.alert';
import { notifyQueued } from '../shared/notify';

export interface RequestARecordProps {
    /** Open the dialog as the page arrives, because the address asked for it. */
    openOnArrival?: boolean;
    /** Told once the dialog has opened for the address, to take the ask back out of it. */
    onArrived?: () => void;
}

/**
 * Ask for a record from the desk, the way a listener would.
 *
 * ## Why a request and not Play next
 *
 * The running order can already take a record directly. This is the other door: the request goes
 * through the same desk as one from an app or a chat, so it is held to the station's rules, carries
 * a name and a dedication the presenter can pass on, and lands in the Requests list with everybody
 * else's. An operator taking a request down the phone, or one shouted across the room, wants that,
 * and not a record that slips in unannounced.
 *
 * ## The rules are the party page's
 *
 * Search, the form and its caps are `party.rules.ts`, which is already held to the listener apps'
 * own, so a request typed here is the same request a guest would send. A refusal is a 201 like any
 * other answer: it stays in the dialog with the station's reason, because the operator is still
 * looking at it, and only a request that is on its way closes it.
 */
export function RequestARecord({ openOnArrival = false, onArrived }: RequestARecordProps) {
    const { t } = useTranslation(['requests', 'common']);
    // Arriving at `/?request=1` (the Stream Deck's Request key with no record of its own) opens the
    // dialog, on first render or when the ask arrives on a Desk already showing. It is adjusted while
    // rendering rather than in an effect, as React asks, so the dialog is open in the first frame. The
    // page then takes the parameter back out of the address, so a reload or the back button does not
    // open it again behind the operator's back.
    const [open, setOpen] = useState(openOnArrival);
    const [asked, setAsked] = useState(openOnArrival);
    if (openOnArrival !== asked) {
        setAsked(openOnArrival);
        if (openOnArrival) setOpen(true);
    }
    useEffect(() => {
        if (openOnArrival) onArrived?.();
    }, [openOnArrival, onArrived]);
    const [typed, setTyped] = useState('');
    const [settled] = useDebouncedValue(typed, PARTY_RULES.searchDebounceMs);
    const term = searchTerm(settled);
    const [chosen, setChosen] = useState<RequestableTrack | undefined>();
    const [form, setForm] = useState<PartyForm>(EMPTY_FORM);
    const [refused, setRefused] = useState<ListenerRequest | undefined>();
    const search = useRequestSearch(open ? term : undefined, PARTY_RULES.searchLimit);
    const create = useCreateRequest();

    const close = () => {
        if (create.isPending) return;
        setOpen(false);
        setTyped('');
        setChosen(undefined);
        // The name is who is asking, so it stays for the next one; the rest was for this record.
        setForm({ ...EMPTY_FORM, name: form.name });
        setRefused(undefined);
        create.reset();
    };

    const send = (track: RequestableTrack) =>
        create.mutate(requestBody(track, form), {
            onSuccess: request => {
                const outcome = outcomeOf(request);
                if (outcome.kind === 'refused') {
                    setRefused(request);
                    return;
                }
                notifyQueued(outcome.kind === 'waiting' ? t('ask.waiting', { title: outcome.title }) : t('ask.onItsWay', { title: outcome.title }));
                close();
            },
        });

    const field = (key: keyof PartyForm, max: number) => ({
        value: form[key],
        onChange: (event: { currentTarget: { value: string } }) => setForm({ ...form, [key]: event.currentTarget.value.slice(0, max) }),
    });

    const nameField = field('name', PARTY_RULES.nameMax);
    const dedicateField = field('dedicateTo', PARTY_RULES.dedicateMax);
    const messageField = field('message', PARTY_RULES.messageMax);

    return (
        <>
            <Tooltip label={t('ask.hint')} multiline maw={320}>
                <Button variant="light" onClick={() => setOpen(true)}>
                    {t('ask.action')}
                </Button>
            </Tooltip>
            <Modal
                opened={open}
                onClose={close}
                title={chosen === undefined ? t('ask.title') : t('ask.chosenTitle', { title: chosen.title })}
                size="lg"
            >
                {chosen === undefined ? (
                    <Stack gap="sm">
                        <TextInput
                            data-autofocus
                            aria-label={t('ask.search.label')}
                            placeholder={t('ask.search.placeholder')}
                            value={typed}
                            onChange={event => setTyped(event.currentTarget.value)}
                            rightSection={search.isFetching ? <Loader size="xs" /> : undefined}
                            autoComplete="off"
                        />
                        {term === undefined ? (
                            <Text size="sm" c="dimmed">
                                {t('ask.search.intro')}
                            </Text>
                        ) : search.isError ? (
                            <ErrorAlert title={t('ask.search.failed')} error={search.error} fallback={t('ask.search.failedFallback')} />
                        ) : search.data?.tracks.length === 0 ? (
                            <Text size="sm" c="dimmed">
                                {t('ask.search.nothing')}
                            </Text>
                        ) : (
                            <Stack gap={0}>
                                {search.data?.tracks.map(track => (
                                    <UnstyledButton
                                        key={rowKey(track)}
                                        onClick={() => setChosen(track)}
                                        aria-label={t('ask.search.choose', { title: track.title, artist: track.artist })}
                                        py="xs"
                                        style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
                                    >
                                        <Text size="sm" lineClamp={1}>
                                            {track.title}
                                        </Text>
                                        <Text size="xs" c="dimmed" lineClamp={1}>
                                            {track.album === undefined
                                                ? track.artist
                                                : t('ask.search.detail', { artist: track.artist, album: track.album })}
                                        </Text>
                                        {track.sourceName === undefined ? undefined : (
                                            <Text size="xs" c="dimmed">
                                                {t('ask.search.from', { source: track.sourceName })}
                                            </Text>
                                        )}
                                    </UnstyledButton>
                                ))}
                            </Stack>
                        )}
                    </Stack>
                ) : (
                    <Stack gap="sm">
                        <Text size="sm" c="dimmed">
                            {t('row.record', { title: chosen.title, artist: chosen.artist })}
                        </Text>
                        <TextInput label={t('ask.form.name')} description={t('ask.form.nameHint')} {...nameField} />
                        <TextInput label={t('ask.form.dedicateTo')} {...dedicateField} />
                        <Textarea
                            label={t('ask.form.message')}
                            description={t('ask.form.messageHint')}
                            autosize
                            minRows={2}
                            maxRows={5}
                            {...messageField}
                        />
                        {refused === undefined ? undefined : (
                            <Alert color="red" title={t('ask.refused')}>
                                {refused.reason ?? t('ask.refusedPlain')}
                            </Alert>
                        )}
                        {create.isError ? <ErrorAlert title={t('ask.failed')} error={create.error} fallback={t('ask.failedFallback')} /> : undefined}
                        <Group justify="space-between">
                            <Button
                                variant="subtle"
                                color="gray"
                                disabled={create.isPending}
                                onClick={() => {
                                    setChosen(undefined);
                                    setRefused(undefined);
                                    create.reset();
                                }}
                            >
                                {t('ask.back')}
                            </Button>
                            <Group gap="xs">
                                <Button variant="subtle" color="gray" disabled={create.isPending} onClick={close}>
                                    {t('common:action.cancel')}
                                </Button>
                                <Button loading={create.isPending} disabled={refused !== undefined} onClick={() => send(chosen)}>
                                    {t('ask.send')}
                                </Button>
                            </Group>
                        </Group>
                    </Stack>
                )}
            </Modal>
        </>
    );
}
