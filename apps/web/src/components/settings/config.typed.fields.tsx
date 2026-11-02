/**
 * The field types `ConfigFieldsForm` draws with more than a single line: what a note says, which
 * control a number gets, the two shapes of a list, and free text with or without suggestions.
 *
 * Split out of `config.fields.form.tsx` unchanged. Each takes the one form that owns its value.
 */
import { Autocomplete, Input, MultiSelect, NumberInput, Pill, TagsInput, Text, TextInput } from '@mantine/core';
import { type UseFormReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import type { ConfigFieldColumn, ConfigFieldDescriptor } from '@deadair/sdk';

import { CopyableCode } from '../shared/copyable.code';
import {
    type FieldRow,
    nameOf,
    cellNameOf,
    columnsOf,
    rowsOf,
    type FormValues,
    parseChosen,
    emptyRow,
    presetRow,
    tagsOf,
} from './config.fields.values';
import { suggestionsAsValues } from './config.suggestions';
import { BytesField, rangeEndOf, RangeField, isSlider, SliderField } from './config.input.fields';
import { type RowSecretState, RowsField } from './config.rows.field';
import { isModelList, ModelListField } from './model.list.field';

type FieldOption = { value: string; label: string };

interface TypedFieldProps {
    field: ConfigFieldDescriptor;
    form: UseFormReturnType<FormValues>;
    name: string;
    common: { label: string; description?: string; withAsterisk?: boolean; disabled: boolean };
}

interface NoteFieldProps {
    field: ConfigFieldDescriptor;
    shown: string | undefined;
}

export function NoteField({ field, shown }: NoteFieldProps) {
    // A note with a derived value is one worth taking somewhere else, which is the only
    // reason the server would work one out for a field that stores nothing: the sign-in
    // redirect address, which the operator pastes into each identity provider.
    if (shown !== undefined) {
        return (
            <Input.Wrapper label={field.label} description={field.help}>
                <CopyableCode value={shown} mt="xxs" />
            </Input.Wrapper>
        );
    }
    return (
        <Text size="sm" c="dimmed">
            {field.help ?? field.label}
        </Text>
    );
}

interface NumberFieldProps extends TypedFieldProps {
    fields: readonly ConfigFieldDescriptor[];
}

export function NumberField({ field, fields, form, name, common }: NumberFieldProps) {
    if (field.unit === 'bytes') return <BytesField common={common} field={field} inputProps={form.getInputProps(name)} />;
    // Before the single-handled case, because a field may reasonably declare both and
    // a pair is the more specific answer.
    const rangeEnd = rangeEndOf(field, fields);
    if (rangeEnd !== -1) {
        return <RangeField common={common} field={field} lower={form.getInputProps(name)} upper={form.getInputProps(nameOf(rangeEnd))} />;
    }
    // A control the field ASKED for, and only where it declared the range one needs.
    // Falling through rather than failing is deliberate: this is a hint about drawing,
    // and a spinner is a worse form than a slider but an infinitely better one than a
    // blank space where a setting should be.
    if (isSlider(field)) return <SliderField common={common} field={field} inputProps={form.getInputProps(name)} />;
    return (
        // The declared range, which Mantine clamps to on blur. Clamping is right HERE
        // and wrong on the server for the same reason: here the number changes in front
        // of the person who typed it, so nothing is stored that they did not see. The
        // route refuses instead, because by then nobody is looking.
        <NumberInput {...common} min={field.min} max={field.max} placeholder={field.placeholder} {...form.getInputProps(name)} />
    );
}

interface OptionFieldProps extends TypedFieldProps {
    options: FieldOption[];
}

export function MultiselectField({ field, form, name, common, options }: OptionFieldProps) {
    // Held in the form as the JSON array it is stored and submitted as, so nothing in
    // `initialValues` or `buildSubmission` has to know this type exists.
    const { error: fieldError } = form.getInputProps(name);
    return (
        <MultiSelect
            {...common}
            placeholder={field.placeholder}
            data={options}
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

interface ListFieldProps extends TypedFieldProps {
    phone: boolean;
    inForce: string | undefined;
    columnOptionsFor: (column: ConfigFieldColumn) => FieldOption[];
    secretCell: (row: FieldRow, column: ConfigFieldColumn) => RowSecretState | undefined;
}

export function ListField({ field, form, name, common, phone, inForce, columnOptionsFor, secretCell }: ListFieldProps) {
    const { error: fieldError } = form.getInputProps(name);
    // A list of models is chosen rather than typed into, so it is a list box of its own.
    // Its rows are still this form's rows, under the one cell name a one-column list has.
    if (isModelList(field)) {
        const column = columnsOf(field)[0]!;
        const cell = cellNameOf(0);
        return (
            <ModelListField
                field={field}
                models={rowsOf(form.getValues()[name])
                    .map(row => row[cell]?.trim() ?? '')
                    .filter(model => model.length > 0)}
                options={columnOptionsFor(column)}
                {...(inForce === undefined ? {} : { defaultModel: inForce })}
                error={typeof fieldError === 'string' ? fieldError : undefined}
                disabled={common.disabled}
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
            field={field}
            name={name}
            phone={phone}
            rows={rowsOf(form.getValues()[name])}
            error={typeof fieldError === 'string' ? fieldError : undefined}
            disabled={common.disabled}
            cellProps={path => form.getInputProps(path)}
            cellKey={path => form.key(path)}
            optionsFor={columnOptionsFor}
            secretCell={secretCell}
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

export function TagsField({ field, form, name, common, options }: OptionFieldProps) {
    const { t } = useTranslation('settings');
    // A `string` that is really a set. Split and joined here and nowhere else, so the
    // stored value is the same comma-separated line the reader behind it splits.
    const { error: fieldError } = form.getInputProps(name);
    return (
        <TagsInput
            {...common}
            placeholder={field.placeholder}
            data={options}
            clearable
            error={fieldError}
            // Named for whatever reads the DOM rather than for a screen reader,
            // exactly as the sustaining picker names its clear cross: Mantine marks
            // a pill's remove button `aria-hidden` with `tabindex="-1"`, on the
            // grounds that the combobox beside it is the control and Backspace is
            // the keyboard path. It is still the only way a kind is dropped with a
            // mouse, and unlabelled it is one of a row of identical buttons.
            renderPill={({ value: tag, onRemove, disabled }) => (
                <Pill withRemoveButton={!disabled} onRemove={onRemove} removeButtonProps={{ 'aria-label': t('form.removeTag', { tag: tag ?? '' }) }}>
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

interface SuggestionInputProps extends Omit<TypedFieldProps, 'field'> {
    options: FieldOption[];
    suggestable: boolean;
    extra: { inputMode?: 'url'; placeholder?: string };
}

/**
 * A free-text field, as an autocomplete when there is something to suggest.
 *
 * Autocomplete rather than a dropdown deliberately: the source enumerating a value is not
 * the same as the value being valid, and a model behind a proxy that does not list it, or a
 * device that was offline when we asked, has to stay typeable. The suggestions are help,
 * not a whitelist.
 */
export function SuggestionInput({ form, name, common, options, suggestable, extra }: SuggestionInputProps) {
    if (!suggestable) {
        return <TextInput {...common} {...extra} {...form.getInputProps(name)} />;
    }

    return <Autocomplete {...common} {...extra} {...suggestionsAsValues(options)} limit={Infinity} {...form.getInputProps(name)} />;
}
