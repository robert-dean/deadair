import { useState } from 'react';
import { Autocomplete, Button, Group, Input, Stack, Table, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { RowControls } from './config.rows.field';

export interface ModelListFieldProps {
    field: ConfigFieldDescriptor;
    /** The models on the list, in the order they are tried. */
    models: readonly string[];
    /** Every model the station can reach, as `{ value: 'provider:model', label: 'model · provider' }`. */
    options: readonly { value: string; label: string }[];
    /** The plugin's own default, which an empty list means, when the station knows it. */
    defaultModel?: string;
    error?: string;
    disabled: boolean;
    onAdd: (model: string) => void;
    onRemove: (index: number) => void;
    onMove: (index: number, by: -1 | 1) => void;
}

/**
 * The models one kind of call may ask, as a list box in the order they are tried.
 *
 * Each of these settings was a single autocomplete, and is a list now because a model that fails
 * before answering hands the call to the next one. The generic `list` field could hold that, as a
 * table of dropdowns with an Add button that adds an EMPTY row, which is a form for typing into
 * rather than a list to choose from. This shows what is chosen as plain entries, each moved or
 * removed with the same `RowControls` every list on these pages uses, and adds by picking: the
 * picker offers every model on every configured provider that is not already on the list.
 *
 * **Free text still works**, because a model behind a proxy that does not list itself has to stay
 * reachable, exactly as it was with the autocomplete this replaces. What is typed is added as
 * written; the station refuses an unqualified name at generation, with a sentence saying why.
 *
 * An empty list is not an error and says what it means: the plugin's own default, named when the
 * station knows which that is.
 */
export function ModelListField({ field, models, options, defaultModel, error, disabled, onAdd, onRemove, onMove }: ModelListFieldProps) {
    const { t } = useTranslation('settings');
    const [adding, setAdding] = useState('');

    const labelOf = new Map(options.map(option => [option.value, option.label]));
    const name = (model: string) => labelOf.get(model) ?? model;
    const available = options.filter(option => !models.includes(option.value));

    const add = (model: string) => {
        const chosen = model.trim();
        if (chosen.length === 0 || models.includes(chosen)) return;
        onAdd(chosen);
        setAdding('');
    };
    const typed = adding.trim();

    return (
        <Input.Wrapper label={field.label} description={field.help} error={error}>
            <Stack gap="xs" mt={field.help === undefined ? 'xxs' : 'xs'}>
                {models.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {defaultModel === undefined ? t('form.models.emptyUnknown') : t('form.models.empty', { model: name(defaultModel) })}
                    </Text>
                ) : (
                    <Table verticalSpacing="xs" horizontalSpacing="xs" withRowBorders={false}>
                        <Table.Tbody>
                            {models.map((model, index) => (
                                <Table.Tr key={model}>
                                    <Table.Td w={32}>
                                        <Text size="sm" c="dimmed" className="da-num">
                                            {index + 1}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="sm">{name(model)}</Text>
                                    </Table.Td>
                                    <Table.Td w={108}>
                                        <RowControls
                                            index={index}
                                            last={models.length - 1}
                                            disabled={disabled}
                                            name={name(model)}
                                            onRemove={onRemove}
                                            onMove={onMove}
                                        />
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                )}

                <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Autocomplete
                        flex={1}
                        aria-label={t('form.models.add', { setting: field.label })}
                        placeholder={t('form.models.placeholder')}
                        data={available.map(option => ({ value: option.value, label: option.label }))}
                        value={adding}
                        disabled={disabled}
                        onChange={setAdding}
                        onOptionSubmit={add}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && typed.length > 0) {
                                event.preventDefault();
                                add(typed);
                            }
                        }}
                    />
                    <Button
                        variant="default"
                        leftSection={<IconPlus size={16} />}
                        disabled={disabled || typed.length === 0 || models.includes(typed)}
                        onClick={() => {
                            add(typed);
                        }}
                    >
                        {t('form.models.addButton')}
                    </Button>
                </Group>
            </Stack>
        </Input.Wrapper>
    );
}

/** Whether a `list` field is a list of models: one column, offering the model plugin's models. */
export function isModelList(field: ConfigFieldDescriptor): boolean {
    const columns = field.columns ?? [];
    return field.type === 'list' && columns.length === 1 && columns[0]?.optionsFrom === 'llm.models';
}
