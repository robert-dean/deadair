import { useEffect, useState } from 'react';
import { Box, Autocomplete, Button, Group, Input, Loader, MultiSelect, NumberInput, Pill, Select, Stack, Switch, TagsInput, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import type { ConfigFieldColumn, ConfigFieldDescriptor, ConfigFieldOption } from '@deadair/sdk';

import { apiErrorDetails, apiErrorMessage } from '../../api/sdk.error';
import { CopyableCode } from '../shared/copyable.code';
import { ErrorAlert } from '../shared/error.alert';
import { usePhone } from '../shared/use.phone';
import { columnSuggestionKey, useDeclaredOptions } from './declared.options';
import { isModelList, ModelListField } from './model.list.field';
import classes from './config.fields.form.module.css';
import { type FieldRow, ROW_ID_KEY, rowSecretKey, nameOf, cellNameOf, columnsOf, rowsOf, type FormValues, initialValues, isInput, isVisible, isAnswered, buildSubmission, parseChosen, emptyRow, presetRow, tagsOf } from './config.fields.values';
import { suggestionsAsValues } from './config.suggestions';
import { isRangeEnd, SecretField, BytesField, rangeEndOf, RangeField, isSlider, SliderField } from './config.input.fields';
import { type RowSecretState, RowsField } from './config.rows.field';

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
     * What a field falls back to while it is EMPTY, keyed by field key.
     *
     * For the settings whose help text says "leave empty to …": the public URL falls back to the
     * address the station was deployed with, the advertised hostname to the public URL's, the
     * station's timezone to the server's own, and each model setting to the model plugin's own
     * default. Each value is worked out server-side and arrives with the settings read
     * (`StationSettings.derived`), because none of it is anything a browser can see: two come from
     * the environment the station was deployed with, one from the server's clock and the models from
     * the plugin.
     *
     * A key present here is drawn twice for one reason each: as the empty field's placeholder, so
     * the box shows the address listeners are actually being sent to rather than a hint, and as a
     * line under it, because a placeholder alone reads as an example of what to type and is not
     * reliably announced to a screen reader.
     *
     * Absent for a plugin's config form, which configures nothing the host derives.
     */
    derived?: Record<string, string>;

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
    derived,
    suggestions,
    suggestionsSupported = false,
    onRefreshSuggestions,
    suggestionsPending = false,
    onDirtyChange,
}: ConfigFieldsFormProps) {
    const { t } = useTranslation('settings');
    const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());

    // Read here rather than inside `RowsField`, so one answer serves every rows field in a form.
    // This form mounts only once its descriptors have arrived, which means a phone pays the hook's
    // documented one corrected frame; a `rows` field is rare enough, and the alternative — threading
    // a media query through the public props of a form shared by three pages — is worse than the
    // frame.
    const phone = usePhone();

    /**
     * What this field falls back to while it is empty, where the station worked one out.
     *
     * Outranks a descriptor's own `placeholder` where a field declares both, because they are
     * different kinds of thing: a placeholder is an example of what to type, and this is a fact
     * about what this station is doing right now.
     */
    const inForce = (field: ConfigFieldDescriptor): string | undefined => derived?.[field.key];

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
                if (!isAnswered(values[nameOf(index)])) errors[nameOf(index)] = t('form.required');
            });
            return errors;
        },
    });

    // The one thing this form reads for itself, and it still knows nothing about what it is
    // configuring: a column declaring `optionsFrom` names a STATION vocabulary, which neither the
    // plugin nor the settings page is in a position to answer. Resolved here rather than at the two
    // call sites so neither grows its own copy, and nothing is fetched for a form that asks for none.
    //
    // It used to take a reader over this form's own values, so that `llm.models` could offer the
    // models of whichever plugin `llm.pluginId` named — which worked only while that key was a
    // field of the same form, and had to be declared below `useForm` or it read a `const` in its
    // temporal dead zone and the page rendered as "this page did not load". The station answers
    // which plugin it reaches now, through `/plugins/providers`, so neither is true any more.
    const declared = useDeclaredOptions(fields);

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

    /**
     * The sentence under a field that is falling back, and nothing at all for one that is not.
     *
     * Below the input rather than in the description, exactly as {@link SecretField} puts the state
     * of a stored secret there and for the same reason: the field's own help text has a claim on
     * the description, and this is a statement about right now rather than about the setting.
     *
     * Only while the box is EMPTY, because that is the only time the fallback is what the station is
     * using — the moment something is typed the note would be describing a value nothing reads. The
     * check is deliberately on what the FORM holds rather than on what is stored, so clearing a
     * field shows what clearing it will mean before the save rather than after.
     */
    function derivedNote(field: ConfigFieldDescriptor, index: number) {
        const value = inForce(field);
        if (value === undefined) return undefined;

        // A string is the only shape that can be empty in the sense this asks about. Nothing else
        // has a derivation today, and a `boolean` or a `list` reaching here would be a question
        // about a different kind of emptiness.
        const typed = form.getValues()[nameOf(index)];
        if (typeof typed !== 'string' || typed.trim() !== '') return undefined;

        return (
            <Text size="xs" c="dimmed">
                {t('form.derived', { value })}
            </Text>
        );
    }

    function renderField(field: ConfigFieldDescriptor, index: number) {
        const name = nameOf(index);
        if (field.type === 'note') {
            // A note with a derived value is one worth taking somewhere else, which is the only
            // reason the server would work one out for a field that stores nothing: the sign-in
            // redirect address, which the operator pastes into each identity provider.
            const shown = inForce(field);
            if (shown !== undefined) {
                return (
                    <Input.Wrapper key={field.key} label={field.label} description={field.help}>
                        <CopyableCode value={shown} mt="xxs" />
                    </Input.Wrapper>
                );
            }
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
                // A list of models is chosen rather than typed into, so it is a list box of its own.
                // Its rows are still this form's rows, under the one cell name a one-column list has.
                if (isModelList(field)) {
                    const column = columnsOf(field)[0]!;
                    const cell = cellNameOf(0);
                    return (
                        <ModelListField
                            key={field.key}
                            field={field}
                            models={rowsOf(form.getValues()[name])
                                .map(row => row[cell]?.trim() ?? '')
                                .filter(model => model.length > 0)}
                            options={columnOptionsFor(field, column)}
                            {...(inForce(field) === undefined ? {} : { defaultModel: inForce(field)! })}
                            error={typeof fieldError === 'string' ? fieldError : undefined}
                            disabled={pending}
                            onAdd={model => {
                                form.insertListItem(name, { ...emptyRow(columnsOf(field)), [cell]: model });
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
                        onAdd={preset => {
                            form.insertListItem(name, preset === undefined ? emptyRow(columnsOf(field)) : presetRow(columnsOf(field), preset));
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
                return suggestionInput(field, name, { inputMode: 'url', placeholder: inForce(field) ?? field.placeholder ?? 'https://' });
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
                                <Pill
                                    withRemoveButton={!disabled}
                                    onRemove={onRemove}
                                    removeButtonProps={{ 'aria-label': t('form.removeTag', { tag: tag ?? '' }) }}
                                >
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
                return suggestionInput(field, name, { placeholder: inForce(field) ?? field.placeholder });
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
                        // Wrapped only where there is something to say, so a form with nothing
                        // derived lays out exactly as it did before any of this existed.
                        const note = derivedNote(field, index);
                        return (
                            <Box key={field.key} className={FULL_WIDTH_TYPES.has(field.type) ? classes.wide : undefined}>
                                {note === undefined ? (
                                    rendered
                                ) : (
                                    <Stack gap="xxs">
                                        {rendered}
                                        {note}
                                    </Stack>
                                )}
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
                                {t('form.refresh')}
                            </Button>
                            {suggestionsPending ? <Loader size="xs" /> : undefined}
                        </Group>
                    ) : (
                        <span />
                    )}

                    <Group justify="flex-end" gap="md">
                        {succeeded && !dirty ? (
                            <Text size="sm" c="dimmed">
                                {t('form.saved')}
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
