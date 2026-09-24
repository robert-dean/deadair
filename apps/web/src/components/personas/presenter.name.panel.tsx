import { useState } from 'react';
import { Button, Card, Collapse, Group, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import type { Persona } from '@deadair/sdk';

import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { i18n } from '../../i18n/i18n.setup';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The setting this writes, which every break writer and the production caster read behind a
 * persona's own `djName`. Named here rather than taken from the descriptors, as `SustainingPanel`
 * names its own: this panel draws its own control and its own sentence about the roster.
 */
const KEY = 'station.djName';

/**
 * What a host without a name of its own is called, above the roster whose names override it.
 *
 * ## Why it is here and not on the station card
 *
 * It sat beside the station's name for as long as it existed, where it read as THE presenter's
 * name. It is not: any host with a name of its own wins while it is on air, so an operator could
 * fill it in, put a named character on air, and hear the station call itself something else with
 * nothing on that page saying why. Here the override is in view, and the sentence above the fold
 * names the hosts it actually reaches.
 *
 * ## Behind a fold, with the summary in view
 *
 * The same shape as `SustainingPanel`: what stays on the screen is who the setting reaches, which
 * is also the affordance for changing it. An operator on this page has nearly always come for a
 * character, not for this.
 */
export function PresenterNamePanel({ hosts }: PresenterNamePanelProps) {
    const settings = useSettings();
    const save = useUpdateSettings();
    const { t } = useTranslation('personas');
    const [opened, setOpened] = useState(false);

    const stored = storedName(settings.data?.values ?? {});
    const unnamed = hosts.filter(host => (host.djName ?? '').trim() === '');

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2}>
                        <Eyebrow>{t('presenterName.eyebrow')}</Eyebrow>
                        {/* Nothing is claimed until the settings have answered: an unanswered read
                            and a station with no name set are the same empty map. */}
                        <Text size="sm" c="dimmed" maw={620}>
                            {settings.data === undefined ? ' ' : summaryOf(stored, unnamed)}
                        </Text>
                    </Stack>
                    <Button size="xs" variant="light" onClick={() => setOpened(open => !open)}>
                        {opened ? t('shared.done') : t('shared.change')}
                    </Button>
                </Group>

                {settings.error ? (
                    <ErrorAlert title={t('presenterName.readError')} error={settings.error} fallback={t('shared.settingsUnavailable')} />
                ) : undefined}

                <Collapse expanded={opened}>
                    {/* Keyed on what the server last said, so the form is built from the answer
                        rather than from the empty map the first render has. As `SustainingPanel`. */}
                    <PresenterNameForm
                        key={stored}
                        initial={stored}
                        // `null` rather than `''` for an emptied box: an explicit null deletes the
                        // row, which is how a setting goes back to unset.
                        onSubmit={name => save.mutate({ [KEY]: name.trim() === '' ? null : name.trim() })}
                        saving={save.isPending}
                        succeeded={save.isSuccess}
                        failure={save.isError ? apiErrorMessage(save.error, t('presenterName.saveFallback')) : undefined}
                    />
                </Collapse>
            </Stack>
        </Card>
    );
}

export interface PresenterNamePanelProps {
    /** The roster's hosts. Callers are left out by the caller: they are never the station. */
    hosts: readonly Persona[];
}

interface PresenterNameFormProps {
    initial: string;
    onSubmit: (name: string) => void;
    saving: boolean;
    succeeded: boolean;
    failure?: string;
}

function PresenterNameForm({ initial, onSubmit, saving, succeeded, failure }: PresenterNameFormProps) {
    const { t } = useTranslation('personas');
    const form = useForm<{ name: string }>({ initialValues: { name: initial } });

    return (
        <form onSubmit={form.onSubmit(values => onSubmit(values.name))}>
            <Stack gap="md" pt="sm">
                {failure ? <ErrorAlert title={t('shared.saveFailedTitle')}>{failure}</ErrorAlert> : undefined}

                <TextInput label={t('presenterName.label')} description={t('presenterName.description')} maw={360} {...form.getInputProps('name')} />

                <Group justify="flex-end" gap="md">
                    {succeeded && !form.isDirty() ? (
                        <Text size="sm" c="dimmed">
                            {t('shared.saved')}
                        </Text>
                    ) : undefined}
                    <Button type="submit" loading={saving}>
                        {t('shared.save')}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

/** The stored name as the string the field holds, where absent and empty are the same thing. */
function storedName(values: Record<string, unknown>): string {
    const value = values[KEY];
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Who the setting reaches, as one line.
 *
 * Named by label rather than counted, because "one host" leaves the operator to work out which,
 * and the answer is nearly always the Classic host a fresh station starts with.
 */
export function summaryOf(name: string, unnamed: readonly Persona[]): string {
    const who = unnamed.map(host => host.label).join(', ');
    const count = unnamed.length;

    if (name !== '') {
        if (count === 0) return i18n.t('personas:presenterName.summary.namedAllOwn', { name });
        return i18n.t('personas:presenterName.summary.namedFor', { count, who, name });
    }

    if (count === 0) return i18n.t('personas:presenterName.summary.allOwn');
    return i18n.t('personas:presenterName.summary.unnamed', { count, who });
}
