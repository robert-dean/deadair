import { useState } from 'react';
import { Alert, Anchor, Button, Group, NumberInput, PasswordInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useForm, type GetInputPropsReturnType } from '@mantine/form';
import type { ConfigFieldDescriptor, PluginDetail } from '@deadair/sdk';

import { useUpdatePluginConfig } from '../../api/plugins.queries';
import { apiErrorDetails, apiErrorMessage } from '../../api/sdk.error';

type FieldValue = string | number | boolean;
type FormValues = Record<string, FieldValue>;

/** `note` fields are static help text: they are never inputs and never submitted. */
const isInput = (field: ConfigFieldDescriptor): boolean => field.type !== 'note';

/** Whether a value counts as answered, for `required` and for `dependsOn`. */
const isAnswered = (value: FieldValue | undefined): boolean => value !== undefined && value !== '' && value !== false;

/**
 * The form as the plugin's own schema will see it.
 *
 * Secrets are never prefilled — the API reports only whether one is stored, never its value — so a
 * secret input always starts empty regardless of what the server holds.
 */
function initialValues(plugin: PluginDetail): FormValues {
    const values: FormValues = {};
    for (const field of plugin.configFields.filter(isInput)) {
        if (field.type === 'secret') {
            values[field.key] = '';
            continue;
        }
        const stored = plugin.config[field.key] ?? field.default;
        if (field.type === 'boolean') {
            values[field.key] = stored === true;
        } else if (field.type === 'number') {
            values[field.key] = typeof stored === 'number' ? stored : '';
        } else {
            values[field.key] = stored === undefined || stored === null ? '' : String(stored);
        }
    }
    return values;
}

/** A field whose `dependsOn` target is still unanswered is not part of this form yet. */
function isVisible(field: ConfigFieldDescriptor, values: FormValues): boolean {
    return field.dependsOn === undefined || isAnswered(values[field.dependsOn]);
}

/**
 * The submission, built to the server's partial-update contract
 * (`PluginConfigService.saveConfig`): a key that is present is written, a key that is absent keeps
 * whatever is stored.
 *
 * That is what makes the secret rules work. An untouched secret is left out, so an operator can
 * save the rest of the form without retyping it, and a secret the operator cleared is sent as
 * `null` — present, and explicitly empty. `null` rather than `''` because clearing is a deliberate
 * act: `undefined` would vanish from the JSON and read as "keep", and `''` is what a half-typed
 * field looks like. A blanked number that had a stored value is cleared the same way; one that
 * never had a value is simply omitted, since there is nothing to remove.
 */
function buildSubmission(plugin: PluginDetail, values: FormValues, cleared: ReadonlySet<string>): Record<string, unknown> {
    const submission: Record<string, unknown> = {};
    for (const field of plugin.configFields.filter(isInput)) {
        if (!isVisible(field, values)) continue;
        const value = values[field.key];

        if (field.type === 'secret') {
            if (cleared.has(field.key)) {
                submission[field.key] = null;
            } else if (typeof value === 'string' && value.length > 0) {
                submission[field.key] = value;
            }
            continue;
        }

        if (field.type === 'number') {
            if (value === '') {
                if (plugin.config[field.key] !== undefined) submission[field.key] = null;
            } else {
                submission[field.key] = Number(value);
            }
            continue;
        }

        submission[field.key] = value;
    }
    return submission;
}

export interface PluginConfigFormProps {
    plugin: PluginDetail;
}

/**
 * The settings form, generated from the plugin's own `configFields`.
 *
 * There is no per-plugin code here on purpose: a plugin nobody has written yet gets a working
 * settings screen the moment the host can read its manifest. The plugin's zod schema stays the
 * authority on what is valid — the checks below only spare the operator a round trip — and its
 * `422` field messages are handed straight back to the inputs they name.
 */
export function PluginConfigForm({ plugin }: PluginConfigFormProps) {
    const save = useUpdatePluginConfig(plugin.id);
    const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());

    // Controlled: `dependsOn` decides visibility from the current values, so the form has to
    // re-render as they change. The app's other forms are uncontrolled because nothing in them
    // watches anything else.
    const form = useForm<FormValues>({
        mode: 'controlled',
        initialValues: initialValues(plugin),
        validate: values => {
            const errors: Record<string, string> = {};
            for (const field of plugin.configFields.filter(isInput)) {
                if (!field.required || !isVisible(field, values)) continue;
                // A stored secret satisfies `required` without being retyped; one being cleared
                // does not, since after the save there would be nothing there.
                if (field.type === 'secret' && plugin.secretsConfigured[field.key] && !cleared.has(field.key)) continue;
                if (!isAnswered(values[field.key])) errors[field.key] = 'This is required';
            }
            return errors;
        },
    });

    function toggleCleared(key: string): void {
        setCleared(current => {
            const next = new Set(current);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
                form.setFieldValue(key, '');
            }
            return next;
        });
    }

    async function submit(values: FormValues): Promise<void> {
        try {
            await save.mutateAsync(buildSubmission(plugin, values, cleared));
            setCleared(new Set());
            // Secrets are write-only: whatever was typed has been stored, and leaving it in the
            // input would suggest the form still knows it.
            for (const field of plugin.configFields.filter(field => field.type === 'secret')) {
                form.setFieldValue(field.key, '');
            }
            form.resetDirty();
        } catch (caught) {
            const details = apiErrorDetails(caught);
            if (details) {
                form.setErrors(details);
            }
        }
    }

    function renderField(field: ConfigFieldDescriptor) {
        if (field.type === 'note') {
            return (
                <Text key={field.key} size="sm" c="dimmed">
                    {field.help ?? field.label}
                </Text>
            );
        }
        if (!isVisible(field, form.getValues())) {
            return undefined;
        }

        const common = {
            label: field.label,
            description: field.help,
            withAsterisk: field.required,
            disabled: save.isPending,
        };

        switch (field.type) {
            case 'secret':
                return (
                    <SecretField
                        key={field.key}
                        field={field}
                        inputProps={form.getInputProps(field.key)}
                        stored={plugin.secretsConfigured[field.key] === true}
                        cleared={cleared.has(field.key)}
                        onToggleCleared={toggleCleared}
                        disabled={save.isPending}
                    />
                );
            case 'boolean':
                return <Switch key={field.key} {...common} description={undefined} {...form.getInputProps(field.key, { type: 'checkbox' })} />;
            case 'number':
                return <NumberInput key={field.key} {...common} placeholder={field.placeholder} {...form.getInputProps(field.key)} />;
            case 'select':
                return (
                    <Select
                        key={field.key}
                        {...common}
                        placeholder={field.placeholder}
                        data={(field.options ?? []).map(option => ({ value: option.value, label: option.label }))}
                        {...form.getInputProps(field.key)}
                    />
                );
            case 'url':
                return <TextInput key={field.key} {...common} inputMode="url" placeholder={field.placeholder ?? 'https://'} {...form.getInputProps(field.key)} />;
            default:
                return <TextInput key={field.key} {...common} placeholder={field.placeholder} {...form.getInputProps(field.key)} />;
        }
    }

    // A 422's field messages have already gone to the inputs; anything else needs saying out loud.
    const failure = save.error && !apiErrorDetails(save.error) ? apiErrorMessage(save.error, 'The configuration could not be saved.') : undefined;

    return (
        <form
            onSubmit={form.onSubmit(values => {
                void submit(values);
            })}
        >
            <Stack gap="md">
                {failure ? (
                    <Alert color="red" title="Save failed">
                        {failure}
                    </Alert>
                ) : undefined}

                {plugin.configFields.map(renderField)}

                <Group justify="flex-end" gap="md">
                    {save.isSuccess && !form.isDirty() ? (
                        <Text size="sm" c="dimmed">
                            Saved.
                        </Text>
                    ) : undefined}
                    <Button type="submit" loading={save.isPending}>
                        Save configuration
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

interface SecretFieldProps {
    field: ConfigFieldDescriptor;
    inputProps: GetInputPropsReturnType;
    /** Whether the server currently holds a value for this field. Never the value itself. */
    stored: boolean;
    cleared: boolean;
    disabled: boolean;
    onToggleCleared: (key: string) => void;
}

/**
 * A write-only field. Nothing about a stored secret is displayed, because nothing about it is ever
 * sent: the API reports one as a boolean and no more.
 */
function SecretField({ field, inputProps, stored, cleared, disabled, onToggleCleared }: SecretFieldProps) {
    return (
        <Stack gap={4}>
            <PasswordInput
                label={field.label}
                description={field.help}
                withAsterisk={field.required}
                disabled={disabled || cleared}
                placeholder={stored && !cleared ? '••••••••' : field.placeholder}
                {...inputProps}
            />
            {stored ? (
                // The state of the stored value sits below the input rather than in its
                // description, which the plugin's own help text already has a claim on.
                <Group justify="space-between" gap="sm" wrap="nowrap">
                    <Text size="xs" c={cleared ? 'red' : 'dimmed'}>
                        {cleared ? 'Will be removed when you save.' : 'Stored — leave blank to keep it.'}
                    </Text>
                    <Anchor
                        component="button"
                        type="button"
                        size="xs"
                        c={cleared ? undefined : 'red'}
                        onClick={() => {
                            onToggleCleared(field.key);
                        }}
                    >
                        {cleared ? 'Keep the stored value' : 'Clear the stored value'}
                    </Anchor>
                </Group>
            ) : undefined}
        </Stack>
    );
}
