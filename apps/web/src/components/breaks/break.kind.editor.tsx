import { Button, Checkbox, Divider, Group, Modal, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import type { BreakKind, BreakKindInput } from '@deadair/sdk';

import { ErrorAlert } from '../shared/error.alert';
import { usePhone } from '../shared/use.phone';

/** The shape a key must have, as the contract and the table both hold it: lowercase words joined by single hyphens. */
const KEY_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Writing one kind of break.
 *
 * Three halves: what the console calls it and what the clock calls it, the brief and its rules in
 * the operator's words, and what the presenter is shown while writing one. The four switches are the
 * row's four `shows*` fields and nothing else, because those are the only parts of a break's shape a
 * row may set; everything else about a kind is the station's to decide.
 *
 * ## The key is fixed once saved
 *
 * A band on the format clock names the kind by it, and every break it planted carries it, so the
 * station refuses a change. The field is shown and locked rather than hidden, so an operator can see
 * what to type into a band.
 *
 * ## Rules are lines
 *
 * The contract holds a list, and a list an operator types is a box of lines, which is how Phrasings
 * are written next door. A blank line is dropped rather than kept as an empty instruction, here and
 * again by the station.
 */
export function BreakKindEditor({ target, onClose, onSubmit, pending, error }: Props) {
    const { t } = useTranslation(['breaks', 'common']);
    const phone = usePhone();
    const breakKind = target.kind === 'edit' ? target.breakKind : undefined;

    const form = useForm<FormValues>({
        // Read once per mount, so the page keys this component on what it is open on.
        initialValues: valuesOf(target),
        validate: {
            name: value => (value.trim().length === 0 ? t('editor.required') : undefined),
            key: value => (value.trim().length === 0 ? t('editor.required') : KEY_SHAPE.test(value.trim()) ? undefined : t('editor.key.invalid')),
            brief: value => (value.trim().length === 0 ? t('editor.required') : undefined),
        },
    });

    const submit = form.onSubmit(values => {
        void onSubmit({
            key: breakKind?.key ?? values.key.trim(),
            name: values.name.trim(),
            brief: values.brief.trim(),
            rules: values.rules
                .split('\n')
                .map(rule => rule.trim())
                .filter(rule => rule.length > 0),
            showsPrevious: values.showsPrevious,
            showsPlayed: values.showsPlayed,
            showsFacts: values.showsFacts,
            showsNotebook: values.showsNotebook,
            enabled: values.enabled,
            // A new kind's place is the page's to work out when it is saved; see `BreakKindsPage`.
            position: breakKind?.position ?? 0,
        }).catch(() => undefined);
    });

    return (
        <Modal
            opened
            onClose={onClose}
            title={breakKind ? t('editor.editTitle', { name: breakKind.name }) : t('editor.newTitle')}
            size="lg"
            fullScreen={phone}
        >
            <form onSubmit={submit}>
                <Stack gap="md">
                    {error ? <ErrorAlert title={t('editor.failureTitle')} error={error} fallback={t('editor.failureFallback')} /> : undefined}

                    <TextInput
                        label={t('editor.name.label')}
                        description={t('editor.name.description')}
                        placeholder={t('editor.name.placeholder')}
                        {...form.getInputProps('name')}
                    />

                    <TextInput
                        label={t('editor.key.label')}
                        description={breakKind ? t('editor.key.fixed') : t('editor.key.description')}
                        placeholder={t('editor.key.placeholder')}
                        // Read-only rather than disabled: a disabled input is greyed nearly out, and this is
                        // the word an operator copies into a band, so it has to stay legible.
                        readOnly={breakKind !== undefined}
                        variant={breakKind === undefined ? 'default' : 'filled'}
                        // The input only: `ff` on the field would set the label and description in it too.
                        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                        {...form.getInputProps('key')}
                    />

                    <Textarea
                        label={t('editor.brief.label')}
                        description={t('editor.brief.description')}
                        placeholder={t('editor.brief.placeholder')}
                        autosize
                        minRows={3}
                        maxRows={10}
                        {...form.getInputProps('brief')}
                    />

                    <Textarea
                        label={t('editor.rules.label')}
                        description={t('editor.rules.description')}
                        placeholder={t('editor.rules.placeholder')}
                        autosize
                        minRows={2}
                        maxRows={8}
                        {...form.getInputProps('rules')}
                    />

                    <Stack gap="xs">
                        <Text size="sm" fw={500}>
                            {t('editor.sees.title')}
                        </Text>
                        <Checkbox label={t('editor.sees.previous')} {...form.getInputProps('showsPrevious', { type: 'checkbox' })} />
                        <Checkbox label={t('editor.sees.played')} {...form.getInputProps('showsPlayed', { type: 'checkbox' })} />
                        <Checkbox label={t('editor.sees.facts')} {...form.getInputProps('showsFacts', { type: 'checkbox' })} />
                        <Checkbox label={t('editor.sees.notebook')} {...form.getInputProps('showsNotebook', { type: 'checkbox' })} />
                    </Stack>

                    <Switch
                        label={t('editor.enabled.label')}
                        description={t('editor.enabled.description')}
                        {...form.getInputProps('enabled', { type: 'checkbox' })}
                    />

                    <Divider />

                    <Group justify="flex-end" gap="xs">
                        <Button variant="default" onClick={onClose}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button type="submit" loading={pending}>
                            {t('editor.save')}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}

/** What the editor is open on: a kind to change, or a new one. */
export type BreakKindTarget = { kind: 'edit'; breakKind: BreakKind } | { kind: 'new' };

interface Props {
    target: BreakKindTarget;
    onClose: () => void;
    onSubmit: (draft: BreakKindInput) => Promise<unknown>;
    pending: boolean;
    error?: unknown;
}

interface FormValues {
    key: string;
    name: string;
    brief: string;
    /** One rule per line, as typed. */
    rules: string;
    showsPrevious: boolean;
    showsPlayed: boolean;
    showsFacts: boolean;
    showsNotebook: boolean;
    enabled: boolean;
}

/** The form's starting values: the kind's own, or the table's defaults for a new one. */
function valuesOf(target: BreakKindTarget): FormValues {
    if (target.kind === 'new') {
        return {
            key: '',
            name: '',
            brief: '',
            rules: '',
            showsPrevious: true,
            showsPlayed: false,
            showsFacts: true,
            showsNotebook: true,
            enabled: false,
        };
    }

    const kind = target.breakKind;
    return {
        key: kind.key,
        name: kind.name,
        brief: kind.brief,
        rules: kind.rules.join('\n'),
        showsPrevious: kind.showsPrevious,
        showsPlayed: kind.showsPlayed,
        showsFacts: kind.showsFacts,
        showsNotebook: kind.showsNotebook,
        enabled: kind.enabled,
    };
}
