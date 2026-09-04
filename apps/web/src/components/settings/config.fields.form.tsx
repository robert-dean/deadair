import { useEffect, useState } from 'react';
import {
    ActionIcon,
    Box,
    Anchor,
    Autocomplete,
    Button,
    Group,
    Input,
    Loader,
    MultiSelect,
    NumberInput,
    PasswordInput,
    Pill,
    RangeSlider,
    Select,
    Slider,
    Stack,
    Switch,
    Table,
    TagsInput,
    Text,
    Textarea,
    TextInput,
    type ComboboxItem,
    type ComboboxParsedItem,
    type RenderAutocompleteOption,
    type OptionsFilter,
} from '@mantine/core';
import { useForm, type GetInputPropsReturnType } from '@mantine/form';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import type { ConfigFieldColumn, ConfigFieldDescriptor, ConfigFieldOption } from '@deadair/sdk';

import { apiErrorDetails, apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PhoneCard } from '../shared/phone.card';
import { usePhone } from '../shared/use.phone';
import { columnSuggestionKey, useDeclaredOptions } from './declared.options';
import classes from './config.fields.form.module.css';

/**
 * The cell a row's own identity lives under, and how a credential inside a row is addressed.
 *
 * Both are spelled out here rather than imported, for the reason `declared.options.ts` spells the
 * plugin capabilities out: this console has no dependency on `@deadair/plugin-sdk`, and these are
 * part of the wire contract rather than something that moves without a contract change of its own.
 * The API mints the id and reports each cell's configured-ness under the joined key; the form's job
 * is to send the id back and never to show what it addresses.
 */
const ROW_ID_KEY = '$id';
const rowSecretKey = (fieldKey: string, rowId: string, columnKey: string): string => `${fieldKey}/${rowId}/${columnKey}`;

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

            // Carried through untouched and never drawn. It is what a stored credential hangs off,
            // so a row that loses it on the way through this form is a row whose key is orphaned.
            const rowId = stored[ROW_ID_KEY];
            if (typeof rowId === 'string' && rowId.length > 0) row[ROW_ID_KEY] = rowId;

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

/**
 * A row nobody filled in. The form leaves one behind whenever somebody adds a row and thinks better
 * of it.
 *
 * The id does not count as filling one in: it is the form's bookkeeping rather than the operator's
 * answer, and counting it would keep every emptied row alive forever.
 */
const isBlankRow = (row: FieldRow): boolean => Object.entries(row).every(([name, cell]) => name === ROW_ID_KEY || cell.trim().length === 0);

/**
 * The rows as they are sent: the columns' own keys back, blank rows dropped, every cell trimmed, and
 * each row's id carried through so the server can keep a credential attached to it.
 *
 * A cell nobody filled in is left OUT of its row rather than sent as an empty string, which is the
 * same rule the rest of the submission follows and the one the plugin SDK reads rows under: absent
 * means not set.
 *
 * A `secret` cell follows the three-way rule a secret FIELD does, for the same reasons. Typed sets
 * it. Absent keeps whatever is stored, which is what lets an operator rename a row without retyping
 * the key beside it. `null` clears it — present and explicitly empty, rather than `''`, which is
 * what a half-typed field looks like. A row is only ever emptied of its credential deliberately.
 */
const rowsForSubmission = (
    rows: readonly FieldRow[],
    columns: readonly ConfigFieldColumn[],
    fieldKey: string,
    cleared: ReadonlySet<string>,
): Record<string, unknown>[] =>
    rows
        .filter(row => !isBlankRow(row))
        .map(row => {
            const rowId = row[ROW_ID_KEY];
            const submitted: Record<string, unknown> = rowId === undefined ? {} : { [ROW_ID_KEY]: rowId };

            for (const [at, column] of columns.entries()) {
                const cell = (row[cellNameOf(at)] ?? '').trim();

                if (column.type === 'secret') {
                    if (rowId !== undefined && cleared.has(rowSecretKey(fieldKey, rowId, column.key))) submitted[column.key] = null;
                    else if (cell.length > 0) submitted[column.key] = cell;
                    continue;
                }

                if (cell.length > 0) submitted[column.key] = cell;
            }

            return submitted;
        });

/** An empty row of the declared columns, so a new row draws every cell rather than growing them as it is typed into. */
const emptyRow = (columns: readonly ConfigFieldColumn[]): FieldRow => Object.fromEntries(columns.map((_, at) => [cellNameOf(at), '']));

/** The columns a `list` declared. A field of another type has none, and a `list` with none draws nothing to fill in. */
const columnsOf = (field: ConfigFieldDescriptor): readonly ConfigFieldColumn[] => field.columns ?? [];

/**
 * A `tags` field's entries, out of the one comma-separated line it is stored as.
 *
 * NOT the JSON a `multiselect` uses, and deliberately: this control is drawn over a setting that
 * was already a comma-separated string and is read as one on the server, so changing the encoding
 * would be changing the setting rather than the control. Trimmed and emptied exactly as
 * `dialogueKinds()` trims and empties on the other side, so what the operator sees as a chip is
 * what the station sees as a kind.
 */
function tagsOf(value: FieldValue | undefined): string[] {
    if (typeof value !== 'string') return [];
    return value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

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
 * An autocomplete's options, as the values themselves plus a way to draw the names beside them.
 *
 * **What is INSERTED has to be what the field takes.** Mantine's `Autocomplete` is a string input:
 * hand it `{ value, label }` pairs and picking one puts the LABEL in the box, because the box holds
 * text rather than a selection. Where a source names a thing twice — a speech engine listing
 * `Connor.wav` as "Connor" — that quietly stores the display name in a field the engine will answer
 * 404 for, and the failure surfaces as a voice that cannot speak with a settings page that looks
 * correctly filled in. This station had exactly that: `defaultVoice` reading `Connor`, chosen from a
 * menu, rejected by the server every time it was used.
 *
 * So the data is the values, and the label is drawn in the dropdown instead — visible while
 * choosing, absent from what the choice writes. A source whose two halves agree draws one line, so
 * nothing changes for the engines that name a voice once.
 */
function suggestionsAsValues(options: { value: string; label: string }[]) {
    const labels = new Map(options.map(option => [option.value, option.label]));

    return {
        data: options.map(option => option.value),
        renderOption: (({ option }) => {
            const label = labels.get(option.value);
            if (label === undefined || label === option.value) return <span>{option.value}</span>;

            return (
                <span>
                    {label}{' '}
                    <Text component="span" c="dimmed" size="xs">
                        {option.value}
                    </Text>
                </span>
            );
        }) satisfies RenderAutocompleteOption,
        filter: showAllWhenSettled(labels),
    };
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
 *
 * It takes the labels rather than reading them off the options, because the options are now the
 * values alone — and somebody typing "Connor" is looking for the clip that is DISPLAYED that way,
 * which is the only name they have been shown.
 */
const showAllWhenSettled =
    (labels: Map<string, string>): OptionsFilter =>
    ({ options, search }) => {
        // Mantine allows grouped options; nothing here builds any, so a group is passed through
        // untouched rather than being reached into.
        const isItem = (option: ComboboxParsedItem): option is ComboboxItem => 'value' in option;

        const typed = search.trim().toLowerCase();
        if (typed.length === 0) return options;
        if (options.some(option => isItem(option) && option.value.toLowerCase() === typed)) return options;

        return options.filter(option => !isItem(option) || `${labels.get(option.value) ?? ''} ${option.value}`.toLowerCase().includes(typed));
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
            submission[field.key] = JSON.stringify(rowsForSubmission(Array.isArray(value) ? value : [], columnsOf(field), field.key, cleared));
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

    /**
     * Told whenever this form starts or stops holding an edit nobody has saved.
     *
     * Optional, and the plugin config form passes nothing: this exists for the settings page, where
     * a section is a route and navigating away discards whatever is typed with no sign it happened.
     * Reporting the bit rather than exposing the form is what keeps this component generic — it
     * still knows nothing about what it is configuring, or about who is asking.
     *
     * **Pass a stable function.** It is an effect dependency, so a fresh closure every render costs
     * a run every render. `false` is reported on unmount, so a caller cannot be left blocking on a
     * form that is gone.
     */
    onDirtyChange?: (dirty: boolean) => void;
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
    onDirtyChange,
}: ConfigFieldsFormProps) {
    const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());

    // Read here rather than inside `RowsField`, so one answer serves every rows field in a form.
    // This form mounts only once its descriptors have arrived, which means a phone pays the hook's
    // documented one corrected frame; a `rows` field is rare enough, and the alternative — threading
    // a media query through the public props of a form shared by three pages — is worse than the
    // frame.
    const phone = usePhone();

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

    /**
     * What a `secret` cell in a row needs beyond its value.
     *
     * `undefined` for every column that is not one, and for a row the server has never seen: a new
     * row has no id, so there is nothing stored against it and nothing to describe. The key is the
     * one the API reports configured-ness under, which is also the one `cleared` is tracked by, so
     * the same string addresses both halves.
     */
    const secretCellState = (field: ConfigFieldDescriptor, row: FieldRow, column: ConfigFieldColumn): RowSecretState | undefined => {
        if (column.type !== 'secret') return undefined;

        const rowId = row[ROW_ID_KEY];
        if (rowId === undefined || rowId.length === 0) return undefined;

        const key = rowSecretKey(field.key, rowId, column.key);
        const at = fields.findIndex(candidate => candidate.key === field.key);
        const index = rows(field).indexOf(row);

        return {
            stored: secretsConfigured[key] === true,
            cleared: cleared.has(key),
            onToggleCleared: () => {
                toggleCleared(key, `${nameOf(at)}.${index}.${cellNameOf(columnsOf(field).indexOf(column))}`);
            },
        };
    };

    /** The rows a list field currently holds, for addressing one of them by position. */
    const rows = (field: ConfigFieldDescriptor): readonly FieldRow[] => rowsOf(form.getValues()[nameOf(fields.indexOf(field))]);

    /** The same, for one cell of a `list`: what was suggested or resolved for it, else the column's own. */
    const columnOptionsFor = (field: ConfigFieldDescriptor, column: ConfigFieldColumn): { value: string; label: string }[] => {
        const suggested = offered(columnSuggestionKey(field.key, column.key));
        const source = suggested.length > 0 ? suggested : (column.options ?? []);
        return source.map(option => ({ value: option.value, label: option.label }));
    };

    /**
     * Whether a free-text field has anything to suggest, which is what makes it an autocomplete.
     *
     * `field.options` counts, which it did not before: a `string` declaring choices rendered as a
     * plain text box and silently dropped them, so the only way to offer any was to become a
     * `select` and stop accepting anything else. That is the wrong trade for a value like the MP3
     * bitrate, where 128 and 192 are what nearly everybody wants and `radio.liq` interpolates
     * whatever is typed — `%mp3(bitrate=…)` takes an `int_of_string`, unlike the Opus and AAC
     * encoders next to it, which is exactly why those two ARE closed sets and this one is not.
     * Suggestions rather than a whitelist is what `suggestionInput` below already argues for.
     */
    const hasSuggestions = (field: ConfigFieldDescriptor): boolean => offered(field.key).length > 0 || (field.options ?? []).length > 0;

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

    // The one thing this form reads for itself, and it still knows nothing about what it is
    // configuring: a column declaring `optionsFrom` names a STATION vocabulary, which neither the
    // plugin nor the settings page is in a position to answer. Resolved here rather than at the two
    // call sites so neither grows its own copy, and nothing is fetched for a form that asks for none.
    //
    // The reader is how one source answers a question about ANOTHER field: `llm.models` offers the
    // models of whichever plugin `llm.pluginId` names, and that value lives in this form. Positional
    // names are this form's own business, so the lookup is by KEY and the translation happens here.
    //
    // BELOW `useForm` and not above it, which is not a tidiness point: the reader closes over `form`
    // and is called synchronously during this same render, so declared any earlier it reads a `const`
    // in its temporal dead zone and the whole settings page renders as "this page did not load".
    const declared = useDeclaredOptions(fields, key => {
        const index = fields.findIndex(field => field.key === key);
        if (index < 0) return undefined;
        const value = form.getValues()[nameOf(index)];
        return typeof value === 'string' ? value : undefined;
    });

    /**
     * Whether anything here is unsaved, which is NOT the same question as `form.isDirty()`.
     *
     * Clearing a stored secret is an unsaved change that the form itself cannot see: `toggleCleared`
     * writes `''` into an input whose initial value was already `''`, so nothing about the values
     * moved. The set is the other half of what a save would send, and a guard reading only the form
     * would wave through the one change that erases a credential.
     */
    const dirty = form.isDirty() || cleared.size > 0;

    useEffect(() => {
        onDirtyChange?.(dirty);
        // Reported on the way out as well, so a caller cannot be left blocking on a form that has
        // been unmounted — which on the settings page is every navigation between sections.
        return () => onDirtyChange?.(false);
    }, [dirty, onDirtyChange]);

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

                // The same for a credential typed into a row. Left in the cell it would suggest the
                // form still knows it, and the server has just told us it does not have to.
                for (const [at, column] of columnsOf(field).entries()) {
                    if (column.type !== 'secret') continue;
                    rowsOf(form.getValues()[nameOf(index)]).forEach((_row, row) => {
                        form.setFieldValue(`${nameOf(index)}.${row}.${cellNameOf(at)}`, '');
                    });
                }
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
        // Drawn already, by the field that opened the range it closes. Nothing else changes for it:
        // it keeps its own entry in the form and its own key in the submission, so this is only a
        // statement about where its input is, which is inside somebody else's control.
        if (isRangeEnd(field, fields)) {
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
            case 'number': {
                if (field.unit === 'bytes') return <BytesField key={field.key} common={common} field={field} inputProps={form.getInputProps(name)} />;
                // Before the single-handled case, because a field may reasonably declare both and
                // a pair is the more specific answer.
                const rangeEnd = rangeEndOf(field, fields);
                if (rangeEnd !== -1) {
                    return (
                        <RangeField
                            key={field.key}
                            common={common}
                            field={field}
                            lower={form.getInputProps(name)}
                            upper={form.getInputProps(nameOf(rangeEnd))}
                        />
                    );
                }
                // A control the field ASKED for, and only where it declared the range one needs.
                // Falling through rather than failing is deliberate: this is a hint about drawing,
                // and a spinner is a worse form than a slider but an infinitely better one than a
                // blank space where a setting should be.
                if (isSlider(field)) return <SliderField key={field.key} common={common} field={field} inputProps={form.getInputProps(name)} />;
                return (
                    // The declared range, which Mantine clamps to on blur. Clamping is right HERE
                    // and wrong on the server for the same reason: here the number changes in front
                    // of the person who typed it, so nothing is stored that they did not see. The
                    // route refuses instead, because by then nobody is looking.
                    <NumberInput
                        key={field.key}
                        {...common}
                        min={field.min}
                        max={field.max}
                        placeholder={field.placeholder}
                        {...form.getInputProps(name)}
                    />
                );
            }
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
                        phone={phone}
                        rows={rowsOf(form.getValues()[name])}
                        error={typeof fieldError === 'string' ? fieldError : undefined}
                        disabled={pending}
                        cellProps={path => form.getInputProps(path)}
                        cellKey={path => form.key(path)}
                        optionsFor={column => columnOptionsFor(field, column)}
                        secretCell={(row, column) => secretCellState(field, row, column)}
                        onAdd={() => {
                            form.insertListItem(name, emptyRow(columnsOf(field)));
                        }}
                        onRemove={index => {
                            form.removeListItem(name, index);
                        }}
                        onMove={(index, by) => {
                            form.reorderListItem(name, { from: index, to: index + by });
                        }}
                    />
                );
            }
            case 'url':
                return suggestionInput(field, name, { inputMode: 'url', placeholder: field.placeholder ?? 'https://' });
            default: {
                // A `string` that is really a set. Split and joined here and nowhere else, so the
                // stored value is the same comma-separated line the reader behind it splits.
                if (field.control === 'tags') {
                    const { error: fieldError } = form.getInputProps(name);
                    return (
                        <TagsInput
                            key={field.key}
                            {...common}
                            placeholder={field.placeholder}
                            data={optionsFor(field)}
                            clearable
                            error={fieldError}
                            // Named for whatever reads the DOM rather than for a screen reader,
                            // exactly as the sustaining picker names its clear cross: Mantine marks
                            // a pill's remove button `aria-hidden` with `tabindex="-1"`, on the
                            // grounds that the combobox beside it is the control and Backspace is
                            // the keyboard path. It is still the only way a kind is dropped with a
                            // mouse, and unlabelled it is one of a row of identical buttons.
                            renderPill={({ value: tag, onRemove, disabled }) => (
                                <Pill withRemoveButton={!disabled} onRemove={onRemove} removeButtonProps={{ 'aria-label': `Remove ${tag}` }}>
                                    {tag}
                                </Pill>
                            )}
                            value={tagsOf(form.getValues()[name])}
                            onChange={chosen => {
                                form.setFieldValue(name, chosen.join(','));
                            }}
                        />
                    );
                }
                return suggestionInput(field, name, { placeholder: field.placeholder });
            }
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
                    {...suggestionsAsValues(optionsFor(suggestable))}
                    limit={Infinity}
                    {...form.getInputProps(fieldName)}
                />
            );
        }
    }

    // A 422's field messages have already gone to the inputs; anything else needs saying out loud.
    //
    // "Has details" is not the same as "was reported", and reading it as such is how a refused save
    // showed nothing whatsoever: a `details` carrying only the server's own sentence routed to no
    // input, and suppressed this alert on the strength of existing. So the question asked here is
    // whether any field actually took a message — and where none did, the sentence is said here.
    const routed = apiErrorDetails(error);
    const reachedAField = routed !== undefined && fields.some(field => routed[field.key] !== undefined);
    const failure = error && !reachedAField ? apiErrorMessage(error, failureMessage) : undefined;

    return (
        <form
            onSubmit={form.onSubmit(values => {
                void submit(values);
            })}
        >
            <Stack gap="md">
                {failure ? <ErrorAlert title={failureTitle}>{failure}</ErrorAlert> : undefined}

                {/* Two columns where there is room, which is what the wider settings layout bought.
                    `auto-fit` rather than a fixed two, so this is one rule for a wide window, a
                    narrow one, and a plugin form in a modal — all of which render this component.

                    A field that is WIDE by nature spans the row: a list, a table of rows, a note and
                    a multiselect are all things whose content is longer than a label, and halving
                    them to keep a grid tidy is the layout winning an argument against the content. */}
                <Box className={classes.fields}>
                    {fields.map((field, index) => {
                        const rendered = renderField(field, index);
                        if (rendered === undefined) return undefined;
                        return (
                            <Box key={field.key} className={FULL_WIDTH_TYPES.has(field.type) ? classes.wide : undefined}>
                                {rendered}
                            </Box>
                        );
                    })}
                </Box>

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
                        {succeeded && !dirty ? (
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

/**
 * The field types that take a whole row.
 *
 * Everything else is a label and one control and sits happily in half a card. These are the ones
 * whose CONTENT is wider than that: a note is a paragraph, a list and a rows table grow downward
 * and sideways, and a multiselect holds an unbounded number of pills.
 */
const FULL_WIDTH_TYPES = new Set(['note', 'list', 'rows', 'multiselect']);

interface RowsFieldProps {
    field: ConfigFieldDescriptor;
    /** The field's name inside the form, which every cell path is built from. */
    name: string;
    /** Whether to draw each row as a card of labelled controls rather than as a table row. */
    phone: boolean;
    rows: readonly FieldRow[];
    error?: string;
    disabled: boolean;
    cellProps: (path: string) => GetInputPropsReturnType;
    cellKey: (path: string) => string;
    optionsFor: (column: ConfigFieldColumn) => { value: string; label: string }[];
    /** What a `secret` cell has to know beyond its value, or nothing for a column that is not one. */
    secretCell: (row: FieldRow, column: ConfigFieldColumn) => RowSecretState | undefined;
    onAdd: () => void;
    onRemove: (index: number) => void;
    /** Move one row a single place, `-1` up and `1` down. See {@link RowsField}. */
    onMove: (index: number, by: -1 | 1) => void;
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
 *
 * ## The order of the rows is a decision, so it can be changed
 *
 * A list whose order MEANS something — the feeds a bulletin reads in turn, the sites worth quoting —
 * had exactly one way to reorder it: delete every row after the one in the wrong place and type them
 * again. So each row carries a pair of arrows that move it one place, which is `clock.panel.tsx`'s
 * control for the same problem one layer down. Deliberately not drag and drop: this console has no
 * drag anywhere, a table row is a small target, and the lists an operator actually keeps here are
 * short enough that one place at a time is the whole journey.
 *
 * The move goes through the form's own `reorderListItem` rather than through any state here, for the
 * reason the cells are addressed by path: the values move with the row, and a row that has been
 * typed into and not yet saved moves with its typing intact.
 *
 * ## On a phone it is a stack of cards, and every control grows a label
 *
 * A table of text boxes is the one shape that cannot survive a sideways scroll: an operator TYPING
 * has to see the box and the thing it is for at the same time, and half a row off the right edge is
 * a value entered under the wrong heading. So each row becomes a card of full-width controls, one
 * per column, and the column heading moves onto each control as its label — the heading was the only
 * thing saying what a cell held, so dropping the header row without moving it would leave a stack of
 * unlabelled boxes. Both shapes draw their cells through {@link RowCell}, so a column type only ever
 * decides its control once.
 */
function RowsField({
    field,
    name,
    phone,
    rows,
    error,
    disabled,
    cellProps,
    cellKey,
    optionsFor,
    secretCell,
    onAdd,
    onRemove,
    onMove,
}: RowsFieldProps) {
    const columns = columnsOf(field);

    return (
        <Input.Wrapper label={field.label} description={field.help} withAsterisk={field.required} error={error}>
            <Stack gap="xs" mt={field.help === undefined ? 'xxs' : 'xs'}>
                {rows.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {field.placeholder ?? 'Nothing here yet.'}
                    </Text>
                ) : phone ? (
                    <Stack gap="xs">
                        {rows.map((row, index) => (
                            <PhoneCard
                                key={cellKey(`${name}.${index}`)}
                                title={<Eyebrow>Row {index + 1}</Eyebrow>}
                                action={<RowControls index={index} last={rows.length - 1} disabled={disabled} onRemove={onRemove} onMove={onMove} />}
                                below={
                                    <Stack gap="xs" mt="xs">
                                        {columns.map((column, at) => (
                                            <RowCell
                                                key={column.key}
                                                column={column}
                                                labelled
                                                choices={optionsFor(column)}
                                                disabled={disabled}
                                                cell={cellProps(`${name}.${index}.${cellNameOf(at)}`)}
                                                secret={secretCell(row, column)}
                                            />
                                        ))}
                                    </Stack>
                                }
                            />
                        ))}
                    </Stack>
                ) : (
                    <Table.ScrollContainer minWidth={700}>
                        <Table verticalSpacing="xs" horizontalSpacing="xs" withRowBorders={false}>
                            <Table.Thead>
                                <Table.Tr>
                                    {columns.map(column => (
                                        <Table.Th key={column.key}>{column.label}</Table.Th>
                                    ))}
                                    {/* The row controls' column. Headed by nothing, because a heading
                                    over a row of buttons reads as a third piece of data. */}
                                    <Table.Th w={108} />
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {rows.map((row, index) => (
                                    <Table.Tr key={cellKey(`${name}.${index}`)}>
                                        {columns.map((column, at) => (
                                            <Table.Td key={column.key}>
                                                <RowCell
                                                    column={column}
                                                    choices={optionsFor(column)}
                                                    disabled={disabled}
                                                    cell={cellProps(`${name}.${index}.${cellNameOf(at)}`)}
                                                    secret={secretCell(row, column)}
                                                />
                                            </Table.Td>
                                        ))}
                                        <Table.Td>
                                            <RowControls
                                                index={index}
                                                last={rows.length - 1}
                                                disabled={disabled}
                                                onRemove={onRemove}
                                                onMove={onMove}
                                            />
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
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

/**
 * Whether a field asked for a slider AND declared the range one cannot be drawn without.
 *
 * Both halves matter. `control` is an ask, so nothing is a slider that did not request it — a rule
 * inferred from `min` and `max` being present would turn every millisecond pause in the registry
 * into a control nobody can land on 3500 with. And a slider with an open end has no track, so a
 * field that asks without bounding itself is drawn as the spinner it would have been.
 */
function isSlider(field: ConfigFieldDescriptor): boolean {
    return field.control === 'slider' && field.min !== undefined && field.max !== undefined;
}

/**
 * The position of the field that closes the range this one opens, or -1.
 *
 * Forgiving for `isVisible`'s reason and in the same shape: a `rangeWith` naming a key this form
 * does not hold is a settings page drawing one group of a larger set, not a mistake, and both ends
 * falling back to their own controls is a worse form rather than a broken one. Bounds are required
 * because a range with an open end has no track, exactly as for a single-handled one.
 */
function rangeEndOf(field: ConfigFieldDescriptor, fields: readonly ConfigFieldDescriptor[]): number {
    if (field.rangeWith === undefined || field.min === undefined || field.max === undefined) return -1;
    return fields.findIndex(candidate => candidate.key === field.rangeWith);
}

/** Whether some other field in this form has already drawn this one as the far end of its range. */
function isRangeEnd(field: ConfigFieldDescriptor, fields: readonly ConfigFieldDescriptor[]): boolean {
    return fields.some(candidate => candidate.key !== field.key && rangeEndOf(candidate, fields) !== -1 && candidate.rangeWith === field.key);
}

/** A form value as the number a slider sits at, where anything unreadable is the field's own default. */
function sliderValue(value: FieldValue | undefined, fallback: number): number {
    const typed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(typed) ? typed : fallback;
}

/**
 * A slider's label, with what it currently says on the end of it.
 *
 * Where the value lives, and it is not on the handle. Mantine's always-on bubble is absolutely
 * positioned over whatever is above the track, and two of them on one track collide: the production
 * length is 1 to 120 minutes and sits at 10 to 12, so both handles land in the first tenth and the
 * two bubbles overlap into a smudge that reads as neither number. On the label row the pair is
 * legible however close the handles are, and it stays legible for the single-handled case that
 * pushed its own value through the middle of its help text.
 *
 * The transient bubble is still on, so dragging shows the figure under the thumb where the eye
 * already is. This is the readout you can look up and find, rather than the one you have to hold a
 * mouse button down to see.
 */
function sliderLabel(text: string, reading: string) {
    return (
        <Group justify="space-between" gap="xs" wrap="nowrap">
            <span>{text}</span>
            {/* `.da-num` for the console's rule about columns of figures: a value that changes as a
                handle moves twitches the label in proportional digits. */}
            <Text component="span" size="sm" c="dimmed" className="da-num">
                {reading}
            </Text>
        </Group>
    );
}

interface SliderFieldProps {
    field: ConfigFieldDescriptor;
    inputProps: GetInputPropsReturnType;
    common: { label: string; description?: string; withAsterisk?: boolean; disabled: boolean };
}

/**
 * A bounded number as a track with a handle on it.
 *
 * For the values an operator arrives at rather than knows: how much of an hour comes from a chart,
 * how far under the music the DJ sits, how much of a library one sync may retire. A spinner asks
 * those questions by inviting a guess and then a correction; a track answers "how far along this
 * am I" in one glance, which is the actual question.
 *
 * `Input.Wrapper` rather than the label prop a Mantine input would take, because `Slider` has no
 * label of its own — that is what makes it a slider and not a field. The wrapper is also what puts
 * a server-side rejection under the right control, so a route refusing a number still names it.
 *
 * The marks are the declared ends and nothing between them. A scale reading `0 · 25 · 50 · 75 · 100`
 * is a ruler nobody measures against, where the two ends are the only numbers that answer the
 * question the operator has, which is "how much room do I have here". The value itself is on the
 * label row rather than over the handle, for {@link sliderLabel}'s reasons.
 *
 * Empty is not representable and does not need to be: a slider is only offered for a field that
 * declared both ends, so its own default is always a legal position and "unset" reads as the
 * default rather than as a blank. That is the one thing this control cannot do that a spinner can,
 * and it is why the track cache (where "no limit" is a real answer) is a `BytesField` instead.
 */
function SliderField({ field, inputProps, common }: SliderFieldProps) {
    const { value, onChange, error } = inputProps;
    // Bounded above by `isSlider`, which is the only caller.
    const min = field.min ?? 0;
    const max = field.max ?? 100;

    const at = sliderValue(value as FieldValue | undefined, typeof field.default === 'number' ? field.default : min);

    return (
        <Input.Wrapper
            label={sliderLabel(common.label, sliderText(at, field))}
            description={common.description}
            withAsterisk={common.withAsterisk}
            error={error}
        >
            <Slider
                // Room for the end marks, which Mantine does not give itself: they are absolutely
                // positioned, so the layout is the same height with or without them and they land
                // on top of whatever the form draws next.
                mt="xs"
                mb="lg"
                disabled={common.disabled}
                min={min}
                max={max}
                step={field.step ?? 1}
                marks={[
                    { value: min, label: sliderText(min, field) },
                    { value: max, label: sliderText(max, field) },
                ]}
                label={position => sliderText(position, field)}
                value={at}
                onChange={onChange}
            />
        </Input.Wrapper>
    );
}

interface RangeFieldProps {
    /** The LOWER end, which is the one that declared the pairing and whose label the control wears. */
    field: ConfigFieldDescriptor;
    common: { label: string; description?: string; withAsterisk?: boolean; disabled: boolean };
    lower: GetInputPropsReturnType;
    upper: GetInputPropsReturnType;
}

/**
 * Two settings that are the two ends of one range, as one control with two handles.
 *
 * Still two settings underneath: two keys, two rows, two independent validations, and
 * `buildSubmission` never learns this component exists because each end keeps its own entry in the
 * form. What changes is that the ends cannot cross, which is the entire reason for it.
 *
 * What it buys is LEGIBILITY rather than correctness, which is worth being exact about because the
 * other reason is the plausible one: every reader of a paired setting here sorts its two ends with
 * `Math.min`/`Math.max` before using them, so an inverted range was always tolerated rather than
 * obeyed. What two boxes cost is that the relationship between them lives only in their labels —
 * "fewest", "most", "the other end" — so the pair is read rather than seen. One track says it in
 * the shape of the control, and the handles not crossing comes free with that.
 *
 * `minRange={0}` because Mantine's default is 10, which for a story count of 1 to 8 is a control
 * that cannot be moved at all. Zero also allows both ends on the same number, which is a real
 * answer here: it is how an operator asks for a bulletin that is always the same length.
 *
 * A handle driven into the other one PUSHES it rather than stopping under it, which is Mantine's
 * behaviour and not a choice made here. Both satisfy the thing that matters — the ends cannot cross
 * — and the difference is worth knowing when reading the test that pins it: dragging the lower end
 * of a 4-to-5 range up by three lands both on 7, not both on 5.
 *
 * The pair is read off the label row rather than off the handles, which for a range is not a
 * refinement but the difference between legible and not: a production runs 10 to 12 minutes out of
 * a declared 1 to 120, so both handles sit in the first tenth of the track and two bubbles over
 * them overlap into one unreadable mark. See {@link sliderLabel}.
 */
function RangeField({ field, common, lower, upper }: RangeFieldProps) {
    // Bounded above by `rangeEndOf`, which is the only caller.
    const min = field.min ?? 0;
    const max = field.max ?? 100;

    const low = sliderValue(lower.value as FieldValue | undefined, typeof field.default === 'number' ? field.default : min);
    const high = sliderValue(upper.value as FieldValue | undefined, max);

    return (
        <Input.Wrapper
            label={sliderLabel(common.label, `${sliderText(low, field)}–${sliderText(high, field)}`)}
            description={common.description}
            withAsterisk={common.withAsterisk}
            // Either end may be the one the server refused, and there is one control to say so on.
            error={lower.error ?? upper.error}
        >
            <RangeSlider
                mt="xs"
                mb="lg"
                disabled={common.disabled}
                min={min}
                max={max}
                step={field.step ?? 1}
                minRange={0}
                marks={[
                    { value: min, label: sliderText(min, field) },
                    { value: max, label: sliderText(max, field) },
                ]}
                label={position => sliderText(position, field)}
                value={[low, high]}
                onChange={([nextLow, nextHigh]) => {
                    lower.onChange(nextLow);
                    upper.onChange(nextHigh);
                }}
            />
        </Input.Wrapper>
    );
}

/**
 * One position on a slider, said the way the label says it.
 *
 * The `fraction` conversion lives HERE and nowhere else, exactly as the gigabyte conversion lives
 * only in `BytesField`: the value that leaves this component is the share the row holds, so every
 * reader on the server still multiplies by a number between 0 and 1.
 *
 * Rounded because floating point makes 0.15000000000000002 out of three steps of 0.05, and a label
 * reading `15.000000000000002%` is worse than no label.
 */
function sliderText(position: number, field: ConfigFieldDescriptor): string {
    if (field.unit === 'fraction') return `${Math.round(position * 100)}%`;
    return String(Math.round(position * 1000) / 1000);
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
            // A declared range is in BYTES like the value it bounds, so it is converted here along
            // with everything else this control converts. Zero stays the floor when none is
            // declared, because "no limit" is stored as 0 rather than as an absent row.
            min={field.min === undefined ? 0 : field.min / BYTES_PER_GB}
            max={field.max === undefined ? undefined : field.max / BYTES_PER_GB}
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

/** The state of one stored credential in a row: everything about it except the value, which nothing here has. */
interface RowSecretState {
    /** Whether the server currently holds one for this cell. Never the value itself. */
    stored: boolean;
    cleared: boolean;
    onToggleCleared: () => void;
}

interface RowCellProps {
    column: ConfigFieldColumn;
    /** Present only for a `secret` column, and only once its row has been saved at least once. */
    secret?: RowSecretState;
    /**
     * Whether the control names itself. The desk's table says what a cell is for once, in the column
     * heading; the phone's card has no heading row, so the label rides the control. Either way the
     * `aria-label` is there, which is what every test and every screen reader reads.
     */
    labelled?: boolean;
    /** Whatever this column can be, which decides between free text and free text WITH suggestions. */
    choices: { value: string; label: string }[];
    disabled: boolean;
    cell: GetInputPropsReturnType;
}

/**
 * One cell of a rows field, whichever shape is drawing it.
 *
 * The column's type decides the control and does so in exactly one place. Drawn twice — once per a
 * table cell, once per a card — this was the pair most likely to drift, and the way it would drift
 * is a `url` column losing its keyboard on the surface where the keyboard is the whole point.
 */
function RowCell({ column, labelled, choices, disabled, cell, secret }: RowCellProps) {
    const common = {
        label: labelled ? column.label : undefined,
        'aria-label': column.label,
        placeholder: column.placeholder,
        disabled,
    };

    // Write-only, exactly as a `secret` FIELD is and for the same reason: the API reports one as a
    // boolean and no more, so there is never a value to draw. What differs is only where the state
    // lives — per cell rather than per field — and the affordance below is the same one `SecretField`
    // offers, squeezed into a cell: a filled placeholder for a stored value, and a way to say the
    // deliberate thing. A row nobody has saved yet has no `secret` at all, because there is nothing
    // stored for it to describe.
    if (column.type === 'secret') {
        const stored = secret?.stored === true;
        const cleared = secret?.cleared === true;

        return (
            <Stack gap={2}>
                <PasswordInput
                    {...common}
                    disabled={disabled || cleared}
                    placeholder={stored && !cleared ? '••••••••' : column.placeholder}
                    {...cell}
                />
                {stored ? (
                    <Anchor
                        component="button"
                        type="button"
                        size="xs"
                        ta="left"
                        c={cleared ? undefined : 'red'}
                        onClick={secret?.onToggleCleared}
                        aria-label={`${cleared ? 'Keep' : 'Clear'} the stored ${column.label.toLowerCase()}`}
                    >
                        {cleared ? 'Will be removed — keep it instead' : 'Stored — clear it'}
                    </Anchor>
                ) : undefined}
            </Stack>
        );
    }

    if (choices.length > 0) {
        return <Autocomplete {...common} {...suggestionsAsValues(choices)} limit={Infinity} {...cell} />;
    }

    return <TextInput {...common} {...(column.type === 'url' ? { inputMode: 'url' as const } : {})} {...cell} />;
}

/**
 * Take a row away.
 *
 * Its own component only because both shapes need it and the accessible name is built from the
 * index, which is the part that would be got wrong if it were written twice.
 */
/**
 * The three things that can be done to a row: move it up, move it down, remove it.
 *
 * The arrows are DISABLED at the ends rather than absent, so the group is the same width on every
 * row and the remove control does not move sideways as the list is reordered — the same reason the
 * clock panel's are. Each is labelled with the row's own number, which is the only thing telling a
 * screen reader which of a dozen identical buttons this one is.
 */
function RowControls({
    index,
    last,
    disabled,
    onRemove,
    onMove,
}: {
    index: number;
    /** The last row's index, so the bottom row's down arrow can be turned off. */
    last: number;
    disabled: boolean;
    onRemove: (index: number) => void;
    onMove: (index: number, by: -1 | 1) => void;
}) {
    return (
        <Group gap={2} wrap="nowrap" justify="flex-end">
            <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Move row ${index + 1} up`}
                disabled={disabled || index === 0}
                onClick={() => {
                    onMove(index, -1);
                }}
            >
                <IconArrowUp size={16} />
            </ActionIcon>
            <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Move row ${index + 1} down`}
                disabled={disabled || index === last}
                onClick={() => {
                    onMove(index, 1);
                }}
            >
                <IconArrowDown size={16} />
            </ActionIcon>
            <RemoveRow index={index} disabled={disabled} onRemove={onRemove} />
        </Group>
    );
}

function RemoveRow({ index, disabled, onRemove }: { index: number; disabled: boolean; onRemove: (index: number) => void }) {
    return (
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
    );
}
