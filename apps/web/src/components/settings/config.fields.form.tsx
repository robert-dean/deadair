import { useState } from 'react';
import {
    Alert,
    Anchor,
    Autocomplete,
    Button,
    Group,
    Loader,
    MultiSelect,
    NumberInput,
    PasswordInput,
    Select,
    Stack,
    Switch,
    Text,
    TextInput,
    type ComboboxItem,
    type ComboboxParsedItem,
    type OptionsFilter,
} from '@mantine/core';
import { useForm, type GetInputPropsReturnType } from '@mantine/form';
import type { ConfigFieldDescriptor, ConfigFieldOption } from '@deadair/sdk';

import { apiErrorDetails, apiErrorMessage } from '../../api/sdk.error';

type FieldValue = string | number | boolean;
type FormValues = Record<string, FieldValue>;

/**
 * A `multiselect`'s chosen values, out of the JSON array it is stored and submitted as.
 *
 * Duplicated from the plugin SDK's `parseMultiSelect` rather than imported, because the console
 * has no business depending on the plugin SDK: it never loads a plugin, and the encoding is four
 * lines. Kept deliberately tolerant for the same reason the original is — a hand-edited value
 * should cost the field, not the page.
 */
function parseChosen(value: FieldValue | undefined): string[] {
    if (typeof value !== 'string' || value.trim().length === 0) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * Which suggestions an autocomplete shows for what is currently typed.
 *
 * Mantine's default narrows to what matches the input, which is right while somebody is typing and
 * wrong the rest of the time: a field already holding a chosen value matches only itself, so opening
 * the list shows the one option you already have and hides every alternative. That is the exact
 * moment an operator is trying to CHANGE it.
 *
 * So: an input that exactly equals one of the options is a settled choice rather than a search, and
 * the whole list is shown. Anything else narrows as usual.
 */
const showAllWhenSettled: OptionsFilter = ({ options, search }) => {
    // Mantine allows grouped options; nothing here builds any, so a group is passed through
    // untouched rather than being reached into.
    const isItem = (option: ComboboxParsedItem): option is ComboboxItem => 'value' in option;

    const typed = search.trim().toLowerCase();
    if (typed.length === 0) return options;
    if (options.some(option => isItem(option) && option.value.toLowerCase() === typed)) return options;

    return options.filter(option => !isItem(option) || `${option.label} ${option.value}`.toLowerCase().includes(typed));
};

/** `note` fields are static help text: they are never inputs and never submitted. */
const isInput = (field: ConfigFieldDescriptor): boolean => field.type !== 'note';

/**
 * The name a field goes under INSIDE the form, which is not its key.
 *
 * Mantine reads a dot in a field name as a path into a nested object, so a form field literally
 * named `stream.title` writes and reads `values.stream` `.title` — and every station setting is
 * dot-keyed. The symptom is quiet and total: every input renders empty and every save submits
 * nothing that was typed.
 *
 * Positional rather than an escaped form of the key, because any escaping scheme can be collided
 * with by a key that already contains the escape character, and this cannot. The key never leaves
 * this file's reach, so nothing outside this file sees these names.
 */
const nameOf = (index: number): string => `f${index}`;

/** Whether a value counts as answered, for `required` and for `dependsOn`. */
const isAnswered = (value: FieldValue | undefined): boolean => value !== undefined && value !== '' && value !== false;

/**
 * The form as the server will see it.
 *
 * Secrets are never prefilled — both APIs report only whether one is stored, never its value — so a
 * secret input always starts empty regardless of what is held.
 */
function initialValues(fields: readonly ConfigFieldDescriptor[], stored: Record<string, unknown>): FormValues {
    const values: FormValues = {};
    fields.forEach((field, index) => {
        if (!isInput(field)) return;
        const name = nameOf(index);
        if (field.type === 'secret') {
            values[name] = '';
            return;
        }
        const current = stored[field.key] ?? field.default;
        if (field.type === 'boolean') {
            values[name] = current === true;
        } else if (field.type === 'number') {
            values[name] = typeof current === 'number' ? current : '';
        } else {
            values[name] = current === undefined || current === null ? '' : String(current);
        }
    });
    return values;
}

/**
 * A field whose `dependsOn` target is still unanswered is not part of this form yet.
 *
 * `dependsOn` names another field's KEY, so it is resolved back to a form name here. A target that
 * is not in this form at all — a settings section rendering one group of a larger set — counts as
 * answered: hiding a field because its condition is on a different page would be worse than
 * showing it.
 */
function isVisible(field: ConfigFieldDescriptor, fields: readonly ConfigFieldDescriptor[], values: FormValues): boolean {
    if (field.dependsOn === undefined) return true;
    const target = fields.findIndex(candidate => candidate.key === field.dependsOn);
    if (target === -1) return true;
    return isAnswered(values[nameOf(target)]);
}

/**
 * The submission, built to the partial-update contract both servers implement
 * (`PluginConfigService.saveConfig`, `SettingsService.write`): a key that is present is written, a
 * key that is absent keeps whatever is stored.
 *
 * That is what makes the secret rules work. An untouched secret is left out, so an operator can
 * save the rest of the form without retyping it, and a secret the operator cleared is sent as
 * `null` — present, and explicitly empty. `null` rather than `''` because clearing is a deliberate
 * act: `undefined` would vanish from the JSON and read as "keep", and `''` is what a half-typed
 * field looks like. A blanked number that had a stored value is cleared the same way; one that
 * never had a value is simply omitted, since there is nothing to remove.
 */
function buildSubmission(
    fields: readonly ConfigFieldDescriptor[],
    stored: Record<string, unknown>,
    values: FormValues,
    cleared: ReadonlySet<string>,
): Record<string, unknown> {
    const submission: Record<string, unknown> = {};
    fields.forEach((field, index) => {
        if (!isInput(field) || !isVisible(field, fields, values)) return;
        const value = values[nameOf(index)];

        if (field.type === 'secret') {
            if (cleared.has(field.key)) {
                submission[field.key] = null;
            } else if (typeof value === 'string' && value.length > 0) {
                submission[field.key] = value;
            }
            return;
        }

        if (field.type === 'number') {
            if (value === '') {
                if (stored[field.key] !== undefined) submission[field.key] = null;
            } else {
                submission[field.key] = Number(value);
            }
            return;
        }

        submission[field.key] = value;
    });
    return submission;
}

export interface ConfigFieldsFormProps {
    /** What to render, in the order to render it. */
    fields: readonly ConfigFieldDescriptor[];
    /** The stored NON-secret values, keyed by field key. */
    stored: Record<string, unknown>;
    /** One entry per `secret` field: whether a value is stored. Never the value. */
    secretsConfigured: Record<string, boolean>;
    /**
     * Save. Throws to fail; a 422 carrying field messages has them routed to the inputs it names,
     * and anything else is reported above the form.
     */
    onSubmit: (submission: Record<string, unknown>) => Promise<unknown>;
    pending: boolean;
    /** Whether the last save succeeded, for the quiet confirmation beside the button. */
    succeeded: boolean;
    /** Whatever the last save threw, if anything. */
    error?: unknown;
    submitLabel: string;
    failureTitle: string;
    failureMessage: string;

    /**
     * Live choices, keyed by field key, from whatever is being configured.
     *
     * What a descriptor's own `options` cannot be: fixed when the manifest was written, where these
     * are whatever the operator's own server currently says. A key present here replaces a
     * `select`'s or `multiselect`'s declared options, and turns a `string` or `url` into free text
     * WITH suggestions — free text on purpose, so a value the source could not enumerate stays
     * reachable.
     *
     * Absent for the station's own settings page, which configures nothing that could be asked.
     */
    suggestions?: Record<string, readonly ConfigFieldOption[]>;

    /**
     * Whether asking for suggestions would do anything.
     *
     * Distinct from an empty {@link suggestions}: this is "there is something to ask" rather than
     * "we asked and got nothing", and it is what decides whether a refresh control appears at all.
     * A control that cannot change anything is worse than no control.
     */
    suggestionsSupported?: boolean;

    /** Ask again. Absent means no refresh control, however {@link suggestionsSupported} reads. */
    onRefreshSuggestions?: () => void;

    suggestionsPending?: boolean;
}

/**
 * A settings form generated from field descriptors, with no knowledge of what it is configuring.
 *
 * Shared by the plugin settings form and the station settings page, because they are the same
 * problem: the same descriptor type, the same partial-update contract, and the same write-only
 * rules for secrets. Two renderers would drift, and the way they would drift is a secret being
 * displayed on one of them.
 *
 * The server stays the authority on what is valid — the checks here only spare the operator a
 * round trip — and its `422` field messages are handed straight back to the inputs they name.
 */
export function ConfigFieldsForm({
    fields,
    stored,
    secretsConfigured,
    onSubmit,
    pending,
    succeeded,
    error,
    submitLabel,
    failureTitle,
    failureMessage,
    suggestions,
    suggestionsSupported = false,
    onRefreshSuggestions,
    suggestionsPending = false,
}: ConfigFieldsFormProps) {
    const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());

    /** What to offer for one field: whatever was suggested for it, else whatever it declared. */
    const optionsFor = (field: ConfigFieldDescriptor): { value: string; label: string }[] => {
        const suggested = suggestions?.[field.key];
        const source = suggested !== undefined && suggested.length > 0 ? suggested : (field.options ?? []);
        return source.map(option => ({ value: option.value, label: option.label }));
    };

    /** Whether a free-text field has anything to suggest, which is what makes it an autocomplete. */
    const hasSuggestions = (field: ConfigFieldDescriptor): boolean => (suggestions?.[field.key]?.length ?? 0) > 0;

    // Controlled: `dependsOn` decides visibility from the current values, so the form has to
    // re-render as they change. The app's other forms are uncontrolled because nothing in them
    // watches anything else.
    const form = useForm<FormValues>({
        mode: 'controlled',
        initialValues: initialValues(fields, stored),
        validate: values => {
            const errors: Record<string, string> = {};
            fields.forEach((field, index) => {
                if (!isInput(field) || !field.required || !isVisible(field, fields, values)) return;
                // A stored secret satisfies `required` without being retyped; one being cleared
                // does not, since after the save there would be nothing there.
                if (field.type === 'secret' && secretsConfigured[field.key] && !cleared.has(field.key)) return;
                if (!isAnswered(values[nameOf(index)])) errors[nameOf(index)] = 'This is required';
            });
            return errors;
        },
    });

    function toggleCleared(key: string, name: string): void {
        setCleared(current => {
            const next = new Set(current);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
                form.setFieldValue(name, '');
            }
            return next;
        });
    }

    async function submit(values: FormValues): Promise<void> {
        try {
            await onSubmit(buildSubmission(fields, stored, values, cleared));
            setCleared(new Set());
            // Secrets are write-only: whatever was typed has been stored, and leaving it in the
            // input would suggest the form still knows it.
            fields.forEach((field, index) => {
                if (field.type === 'secret') form.setFieldValue(nameOf(index), '');
            });
            form.resetDirty();
        } catch (caught) {
            const details = apiErrorDetails(caught);
            if (details) {
                // The server names the fields it refused by KEY; the form knows them by position.
                const errors: Record<string, string> = {};
                fields.forEach((field, index) => {
                    const message = details[field.key];
                    if (message !== undefined) errors[nameOf(index)] = message;
                });
                form.setErrors(errors);
            }
        }
    }

    function renderField(field: ConfigFieldDescriptor, index: number) {
        const name = nameOf(index);
        if (field.type === 'note') {
            return (
                <Text key={field.key} size="sm" c="dimmed">
                    {field.help ?? field.label}
                </Text>
            );
        }
        if (!isVisible(field, fields, form.getValues())) {
            return undefined;
        }

        const common = {
            label: field.label,
            description: field.help,
            withAsterisk: field.required,
            disabled: pending,
        };

        switch (field.type) {
            case 'secret':
                return (
                    <SecretField
                        key={field.key}
                        field={field}
                        inputProps={form.getInputProps(name)}
                        stored={secretsConfigured[field.key] === true}
                        cleared={cleared.has(field.key)}
                        onToggleCleared={() => {
                            toggleCleared(field.key, name);
                        }}
                        disabled={pending}
                    />
                );
            case 'boolean':
                return <Switch key={field.key} {...common} description={undefined} {...form.getInputProps(name, { type: 'checkbox' })} />;
            case 'number':
                return <NumberInput key={field.key} {...common} placeholder={field.placeholder} {...form.getInputProps(name)} />;
            case 'select':
                return <Select key={field.key} {...common} placeholder={field.placeholder} data={optionsFor(field)} {...form.getInputProps(name)} />;
            case 'multiselect': {
                // Held in the form as the JSON array it is stored and submitted as, so nothing in
                // `initialValues` or `buildSubmission` has to know this type exists.
                const { error: fieldError } = form.getInputProps(name);
                return (
                    <MultiSelect
                        key={field.key}
                        {...common}
                        placeholder={field.placeholder}
                        data={optionsFor(field)}
                        searchable
                        clearable
                        error={fieldError}
                        value={parseChosen(form.getValues()[name])}
                        onChange={chosen => {
                            form.setFieldValue(name, JSON.stringify(chosen));
                        }}
                    />
                );
            }
            case 'url':
                return suggestionInput(field, name, { inputMode: 'url', placeholder: field.placeholder ?? 'https://' });
            default:
                return suggestionInput(field, name, { placeholder: field.placeholder });
        }

        /**
         * A free-text field, as an autocomplete when there is something to suggest.
         *
         * Autocomplete rather than a dropdown deliberately: the source enumerating a value is not
         * the same as the value being valid, and a model behind a proxy that does not list it, or a
         * device that was offline when we asked, has to stay typeable. The suggestions are help,
         * not a whitelist.
         */
        function suggestionInput(suggestable: ConfigFieldDescriptor, fieldName: string, extra: { inputMode?: 'url'; placeholder?: string }) {
            if (!hasSuggestions(suggestable)) {
                return <TextInput key={suggestable.key} {...common} {...extra} {...form.getInputProps(fieldName)} />;
            }

            return (
                <Autocomplete
                    key={suggestable.key}
                    {...common}
                    {...extra}
                    data={optionsFor(suggestable)}
                    filter={showAllWhenSettled}
                    limit={Infinity}
                    {...form.getInputProps(fieldName)}
                />
            );
        }
    }

    // A 422's field messages have already gone to the inputs; anything else needs saying out loud.
    const failure = error && !apiErrorDetails(error) ? apiErrorMessage(error, failureMessage) : undefined;

    return (
        <form
            onSubmit={form.onSubmit(values => {
                void submit(values);
            })}
        >
            <Stack gap="md">
                {failure ? (
                    <Alert color="red" title={failureTitle}>
                        {failure}
                    </Alert>
                ) : undefined}

                {fields.map((field, index) => renderField(field, index))}

                <Group justify="space-between" gap="md">
                    {/* One control for the form rather than one per field, because the suggestions
                        are one call. Only shown when asking would do something. */}
                    {suggestionsSupported && onRefreshSuggestions ? (
                        <Group gap="xs">
                            <Button variant="subtle" size="compact-sm" onClick={onRefreshSuggestions} disabled={suggestionsPending}>
                                Refresh options
                            </Button>
                            {suggestionsPending ? <Loader size="xs" /> : undefined}
                        </Group>
                    ) : (
                        <span />
                    )}

                    <Group justify="flex-end" gap="md">
                        {succeeded && !form.isDirty() ? (
                            <Text size="sm" c="dimmed">
                                Saved.
                            </Text>
                        ) : undefined}
                        <Button type="submit" loading={pending}>
                            {submitLabel}
                        </Button>
                    </Group>
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
    onToggleCleared: () => void;
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
                // description, which the field's own help text already has a claim on.
                <Group justify="space-between" gap="sm" wrap="nowrap">
                    <Text size="xs" c={cleared ? 'red' : 'dimmed'}>
                        {cleared ? 'Will be removed when you save.' : 'Stored — leave blank to keep it.'}
                    </Text>
                    <Anchor component="button" type="button" size="xs" c={cleared ? undefined : 'red'} onClick={onToggleCleared}>
                        {cleared ? 'Keep the stored value' : 'Clear the stored value'}
                    </Anchor>
                </Group>
            ) : undefined}
        </Stack>
    );
}
