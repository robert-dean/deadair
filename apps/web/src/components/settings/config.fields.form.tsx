import { useState } from 'react';
import {
    ActionIcon,
    Anchor,
    Autocomplete,
    Button,
    Group,
    Input,
    Loader,
    MultiSelect,
    NumberInput,
    PasswordInput,
    Select,
    Stack,
    Switch,
    Table,
    Text,
    Textarea,
    TextInput,
    type ComboboxItem,
    type ComboboxParsedItem,
    type OptionsFilter,
} from '@mantine/core';
import { useForm, type GetInputPropsReturnType } from '@mantine/form';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { ConfigFieldColumn, ConfigFieldDescriptor, ConfigFieldOption } from '@deadair/sdk';

import { apiErrorDetails, apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { columnSuggestionKey, useDeclaredOptions } from './declared.options';

/** One row of a `list` field. Every cell is a string; the column decides the control, not the value. */
type FieldRow = Record<string, string>;

type FieldValue = string | number | boolean | FieldRow[];
type FormValues = Record<string, FieldValue>;

/**
 * The name a CELL goes under inside the form, which is not its column key.
 *
 * {@link nameOf}'s rule, one level down and for exactly the same reason: a cell is addressed by a
 * path (`f3.0.c2`), so a column key carrying a dot would read as a path into a nested object and the
 * cell would draw empty and submit nothing, in silence. Positional rather than an escaped form of
 * the key, because every escaping scheme can be collided with by a key that already contains the
 * escape character — translating `.` to `-` would quietly merge a plugin's `a.b` and `a-b` into one
 * cell — and this cannot.
 *
 * The consequence worth stating: a plugin picks whatever column keys suit it, including dotted ones,
 * and the STORED row still holds those keys. Only this form's internal names are positional, and
 * {@link rowsForSubmission} puts the real ones back.
 */
const cellNameOf = (column: number): string => `c${column}`;

/**
 * A `list`'s rows, out of the JSON array it is stored as, under the form's own cell names.
 *
 * Duplicated from the plugin SDK's `parseRows` for {@link parseChosen}'s reason, and tolerant in the
 * same way: a hand-edited value should cost the field rather than the page. Unlike the SDK's reader
 * this keeps a row whose cells are all empty, because the form has to be able to hold the blank row
 * an operator has just added and not yet typed into. `buildSubmission` is what drops those.
 *
 * A stored cell whose column the manifest no longer declares is dropped rather than carried through
 * invisibly, which is the treatment `PluginConfigService.saveConfig` already gives a stored key with
 * no descriptor behind it.
 */
function parseStoredRows(value: unknown, columns: readonly ConfigFieldColumn[]): FieldRow[] {
    if (typeof value !== 'string' || value.trim().length === 0) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];

        return parsed.flatMap(entry => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];

            const stored = entry as Record<string, unknown>;
            const row: FieldRow = {};
            columns.forEach((column, at) => {
                const cell = stored[column.key];
                row[cellNameOf(at)] = typeof cell === 'string' ? cell : '';
            });
            return [row];
        });
    } catch {
        return [];
    }
}

/** A field's value as rows, for the one type that holds an array rather than a scalar. */
const rowsOf = (value: FieldValue | undefined): FieldRow[] => (Array.isArray(value) ? value : []);

/** A row nobody filled in. The form leaves one behind whenever somebody adds a row and thinks better of it. */
const isBlankRow = (row: FieldRow): boolean => Object.values(row).every(cell => cell.trim().length === 0);

/**
 * The rows as they are stored: the columns' own keys back, blank rows dropped, every cell trimmed.
 *
 * A cell nobody filled in is left OUT of its row rather than stored as an empty string, which is
 * the same rule the rest of the submission follows and the one the plugin SDK reads rows under:
 * absent means not set.
 */
const rowsForSubmission = (rows: readonly FieldRow[], columns: readonly ConfigFieldColumn[]): FieldRow[] =>
    rows
        .map(
            row =>
                Object.fromEntries(
                    columns.flatMap((column, at) => {
                        const cell = (row[cellNameOf(at)] ?? '').trim();
                        return cell.length === 0 ? [] : [[column.key, cell]];
                    }),
                ) as FieldRow,
        )
        .filter(row => !isBlankRow(row));

/** An empty row of the declared columns, so a new row draws every cell rather than growing them as it is typed into. */
const emptyRow = (columns: readonly ConfigFieldColumn[]): FieldRow => Object.fromEntries(columns.map((_, at) => [cellNameOf(at), '']));

/** The columns a `list` declared. A field of another type has none, and a `list` with none draws nothing to fill in. */
const columnsOf = (field: ConfigFieldDescriptor): readonly ConfigFieldColumn[] => field.columns ?? [];

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
const isAnswered = (value: FieldValue | undefined): boolean => {
    // A list of blank rows is a list nobody has filled in, which is what `required` is asking about.
    if (Array.isArray(value)) return value.some(row => !isBlankRow(row));
    return value !== undefined && value !== '' && value !== false;
};

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
        if (field.type === 'list') {
            // A real array in the form's own state, which is what lets the row editor use Mantine's
            // list handlers and address a cell by path. It is turned back into the JSON string it is
            // stored as on the way out, in `buildSubmission`.
            values[name] = parseStoredRows(current, columnsOf(field));
        } else if (field.type === 'boolean') {
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

        if (field.type === 'list') {
            submission[field.key] = JSON.stringify(rowsForSubmission(Array.isArray(value) ? value : [], columnsOf(field)));
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

    // The one thing this form reads for itself, and it still knows nothing about what it is
    // configuring: a column declaring `optionsFrom` names a STATION vocabulary, which neither the
    // plugin nor the settings page is in a position to answer. Resolved here rather than at the two
    // call sites so neither grows its own copy, and nothing is fetched for a form that asks for none.
    const declared = useDeclaredOptions(fields);
    const offered = (key: string): readonly ConfigFieldOption[] => {
        const suggested = suggestions?.[key];
        return suggested !== undefined && suggested.length > 0 ? suggested : (declared[key] ?? []);
    };

    /** What to offer for one field: whatever was suggested for it, else whatever it declared. */
    const optionsFor = (field: ConfigFieldDescriptor): { value: string; label: string }[] => {
        const suggested = offered(field.key);
        const source = suggested.length > 0 ? suggested : (field.options ?? []);
        return source.map(option => ({ value: option.value, label: option.label }));
    };

    /** The same, for one cell of a `list`: what was suggested or resolved for it, else the column's own. */
    const columnOptionsFor = (field: ConfigFieldDescriptor, column: ConfigFieldColumn): { value: string; label: string }[] => {
        const suggested = offered(columnSuggestionKey(field.key, column.key));
        const source = suggested.length > 0 ? suggested : (column.options ?? []);
        return source.map(option => ({ value: option.value, label: option.label }));
    };

    /** Whether a free-text field has anything to suggest, which is what makes it an autocomplete. */
    const hasSuggestions = (field: ConfigFieldDescriptor): boolean => offered(field.key).length > 0;

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
                return field.unit === 'bytes' ? (
                    <BytesField key={field.key} common={common} field={field} inputProps={form.getInputProps(name)} />
                ) : (
                    <NumberInput key={field.key} {...common} placeholder={field.placeholder} {...form.getInputProps(name)} />
                );
            // Stored and submitted exactly like a `string`, so nothing outside this line knows it
            // is different. What it buys is that a setting somebody WRITES — a list of phrasings, a
            // persona, a prompt — is editable here rather than in psql, which is where a paragraph
            // in a one-line box always ends up being edited.
            case 'text':
                return <Textarea key={field.key} {...common} placeholder={field.placeholder} rows={8} {...form.getInputProps(name)} />;
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
            case 'list': {
                const { error: fieldError } = form.getInputProps(name);
                return (
                    <RowsField
                        key={field.key}
                        field={field}
                        name={name}
                        rows={rowsOf(form.getValues()[name])}
                        error={typeof fieldError === 'string' ? fieldError : undefined}
                        disabled={pending}
                        cellProps={path => form.getInputProps(path)}
                        cellKey={path => form.key(path)}
                        optionsFor={column => columnOptionsFor(field, column)}
                        onAdd={() => {
                            form.insertListItem(name, emptyRow(columnsOf(field)));
                        }}
                        onRemove={index => {
                            form.removeListItem(name, index);
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
                {failure ? <ErrorAlert title={failureTitle}>{failure}</ErrorAlert> : undefined}

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

interface RowsFieldProps {
    field: ConfigFieldDescriptor;
    /** The field's name inside the form, which every cell path is built from. */
    name: string;
    rows: readonly FieldRow[];
    error?: string;
    disabled: boolean;
    cellProps: (path: string) => GetInputPropsReturnType;
    cellKey: (path: string) => string;
    optionsFor: (column: ConfigFieldColumn) => { value: string; label: string }[];
    onAdd: () => void;
    onRemove: (index: number) => void;
}

/**
 * A list of rows, drawn as a table an operator adds to.
 *
 * The control a `text` field with a separator in it was always a stand-in for. A list whose entries
 * have PARTS — a feed with a name and a category — is a line format the moment it is one box, and a
 * line format is a thing that can be mistyped into silence: the station reads the operator's list,
 * drops the line it could not parse, and says so in a log nobody is reading at the time.
 *
 * Every cell is addressed by path (`f3.0.c1`, see {@link cellNameOf}) so the form's own list handlers
 * do the inserting and removing. Nothing here holds state of its own, which is what keeps a row that
 * was removed from leaving its typed-in values behind on the row that took its place.
 */
function RowsField({ field, name, rows, error, disabled, cellProps, cellKey, optionsFor, onAdd, onRemove }: RowsFieldProps) {
    const columns = columnsOf(field);

    return (
        <Input.Wrapper label={field.label} description={field.help} withAsterisk={field.required} error={error}>
            <Stack gap="xs" mt={field.help === undefined ? 'xxs' : 'xs'}>
                {rows.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {field.placeholder ?? 'Nothing here yet.'}
                    </Text>
                ) : (
                    <Table verticalSpacing="xs" horizontalSpacing="xs" withRowBorders={false}>
                        <Table.Thead>
                            <Table.Tr>
                                {columns.map(column => (
                                    <Table.Th key={column.key}>{column.label}</Table.Th>
                                ))}
                                {/* The remove control's column. Headed by nothing, because a heading
                                    over a row of buttons reads as a third piece of data. */}
                                <Table.Th w={40} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.map((row, index) => (
                                <Table.Tr key={cellKey(`${name}.${index}`)}>
                                    {columns.map((column, at) => {
                                        const path = `${name}.${index}.${cellNameOf(at)}`;
                                        const choices = optionsFor(column);
                                        return (
                                            <Table.Td key={column.key}>
                                                {choices.length > 0 ? (
                                                    <Autocomplete
                                                        aria-label={column.label}
                                                        placeholder={column.placeholder}
                                                        disabled={disabled}
                                                        data={choices}
                                                        filter={showAllWhenSettled}
                                                        limit={Infinity}
                                                        {...cellProps(path)}
                                                    />
                                                ) : (
                                                    <TextInput
                                                        aria-label={column.label}
                                                        placeholder={column.placeholder}
                                                        disabled={disabled}
                                                        {...(column.type === 'url' ? { inputMode: 'url' as const } : {})}
                                                        {...cellProps(path)}
                                                    />
                                                )}
                                            </Table.Td>
                                        );
                                    })}
                                    <Table.Td>
                                        <ActionIcon
                                            variant="subtle"
                                            color="red"
                                            aria-label={`Remove row ${index + 1}`}
                                            disabled={disabled}
                                            onClick={() => {
                                                onRemove(index);
                                            }}
                                        >
                                            <IconTrash size={16} />
                                        </ActionIcon>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                )}

                <Group justify="flex-start">
                    <Button variant="light" size="compact-sm" leftSection={<IconPlus size={14} />} disabled={disabled} onClick={onAdd}>
                        Add
                    </Button>
                </Group>
            </Stack>
        </Input.Wrapper>
    );
}

/** One gigabyte, as the operator means it and as the figures beside it are drawn. */
const BYTES_PER_GB = 1024 * 1024 * 1024;

interface BytesFieldProps {
    field: ConfigFieldDescriptor;
    inputProps: GetInputPropsReturnType;
    common: { label: string; description?: string; withAsterisk?: boolean; disabled: boolean };
}

/**
 * A byte count, typed in gigabytes.
 *
 * The value stored and submitted is BYTES, unchanged — the conversion lives here and nowhere else,
 * so every reader on the server compares against the unit the row holds. What it buys is that a
 * cache limit is "20" rather than 21474836480, which is a number nobody can type correctly or check
 * at a glance.
 *
 * Driven by `unit` on the descriptor rather than by the field's key, which is the whole reason the
 * SDK grew that property: a form that special-cased one setting by name would be a thing nobody
 * finds when the second one arrives.
 *
 * Fractions are allowed and rounded to whole bytes on the way out, because half a gigabyte is a
 * perfectly ordinary thing to want and the alternative is asking for it in a unit the label does not
 * mention. Empty stays empty rather than becoming zero: for a cap, "unset" is a real answer and it
 * is the default one.
 */
function BytesField({ field, inputProps, common }: BytesFieldProps) {
    const { value, onChange, ...rest } = inputProps;
    const bytes = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));

    return (
        <NumberInput
            {...common}
            {...rest}
            suffix=" GB"
            min={0}
            step={1}
            decimalScale={2}
            placeholder={field.placeholder ?? 'No limit'}
            value={Number.isFinite(bytes) && bytes > 0 ? bytes / BYTES_PER_GB : ''}
            onChange={next => {
                const gigabytes = typeof next === 'number' ? next : Number.parseFloat(next);
                onChange(Number.isFinite(gigabytes) && gigabytes > 0 ? Math.round(gigabytes * BYTES_PER_GB) : 0);
            }}
        />
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
        <Stack gap="xxs">
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
