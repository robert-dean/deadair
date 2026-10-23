/**
 * A `rows` config field: the table (or, on a phone, the stack of cards) of rows, each cell's control,
 * and the move and remove controls a row carries. `RowControls` is shared with the other row-shaped
 * editors in settings.
 *
 * Split out of `config.fields.form.tsx` unchanged.
 */
import { ActionIcon, Anchor, Autocomplete, Button, Group, Input, Menu, PasswordInput, Stack, Table, Text, TextInput } from '@mantine/core';
import { type GetInputPropsReturnType } from '@mantine/form';
import { IconArrowDown, IconArrowUp, IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { ConfigFieldColumn, ConfigFieldDescriptor, ConfigFieldPreset } from '@deadair/sdk';
import { Eyebrow } from '../shared/eyebrow';
import { PhoneCard } from '../shared/phone.card';
import { type FieldRow, cellNameOf, columnsOf, appliesToRow } from './config.fields.values';
import { suggestionsAsValues } from './config.suggestions';

/**
 * How wide each column of a rows table is drawn, as a share of the row.
 *
 * Declared rather than left to the browser, because `table-layout: auto` decides from what a cell
 * CONTAINS and one of these cells contains something different. A `secret` sits in a `Stack` (the
 * input plus its "Stored — clear it" link), and a flex column reports a smaller min-content width
 * than the bare input wrapper every other cell holds — so auto layout starved it. Measured on the
 * llm plugin's providers table: Name, Kind and Address took 358px each and the API key column was
 * left 124, which truncated its own placeholder to "For Anthr".
 *
 * A `url` gets half again as much as the rest because it holds the longest value in the row — an
 * address is a whole URL where a name is a word — and everything else shares equally. Weights
 * rather than fixed pixels so a table of two columns and one of six both fill the card, and so the
 * shares survive the card getting narrower.
 *
 * Only the table shape asks: a phone draws each row as a stack of full-width controls, where there
 * is nothing to apportion.
 */
const COLUMN_WEIGHTS: Record<string, number> = { url: 3 };

const DEFAULT_COLUMN_WEIGHT = 2;

const columnWidths = (columns: readonly ConfigFieldColumn[]): string[] => {
    const weights = columns.map(column => COLUMN_WEIGHTS[column.type] ?? DEFAULT_COLUMN_WEIGHT);
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    // A list with no columns draws nothing, so there is no row to divide and no division to do.
    return total === 0 ? columns.map(() => '') : weights.map(weight => `${((weight / total) * 100).toFixed(2)}%`);
};

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
    /** Add a row: empty, or started from one of the field's presets. */
    onAdd: (preset?: ConfigFieldPreset) => void;
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
export function RowsField({
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
    const { t } = useTranslation('settings');
    const columns = columnsOf(field);
    const widths = columnWidths(columns);

    return (
        <Input.Wrapper label={field.label} description={field.help} withAsterisk={field.required} error={error}>
            <Stack gap="xs" mt={field.help === undefined ? 'xxs' : 'xs'}>
                {rows.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {field.placeholder ?? t('form.rows.empty')}
                    </Text>
                ) : phone ? (
                    <Stack gap="xs">
                        {rows.map((row, index) => (
                            <PhoneCard
                                key={cellKey(`${name}.${index}`)}
                                title={<Eyebrow>{t('form.rows.row', { number: index + 1 })}</Eyebrow>}
                                action={<RowControls index={index} last={rows.length - 1} disabled={disabled} onRemove={onRemove} onMove={onMove} />}
                                below={
                                    <Stack gap="xs" mt="xs">
                                        {/* A card is one row's own, so a cell that does not apply
                                            to it is simply not here — unlike the table below,
                                            where the column belongs to every row at once. */}
                                        {columns.map((column, at) =>
                                            appliesToRow(column, columns, row) ? (
                                                <RowCell
                                                    key={column.key}
                                                    column={column}
                                                    labelled
                                                    choices={optionsFor(column)}
                                                    disabled={disabled}
                                                    cell={cellProps(`${name}.${index}.${cellNameOf(at)}`)}
                                                    secret={secretCell(row, column)}
                                                />
                                            ) : undefined,
                                        )}
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
                                    {columns.map((column, at) => (
                                        <Table.Th key={column.key} w={widths[at]}>
                                            {column.label}
                                        </Table.Th>
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
                                                {appliesToRow(column, columns, row) ? (
                                                    <RowCell
                                                        column={column}
                                                        choices={optionsFor(column)}
                                                        disabled={disabled}
                                                        cell={cellProps(`${name}.${index}.${cellNameOf(at)}`)}
                                                        secret={secretCell(row, column)}
                                                    />
                                                ) : (
                                                    // The header belongs to every row, so the column is not
                                                    // absent here — only inapplicable to this one. A dash says
                                                    // that, where an empty box would read as a cell somebody
                                                    // forgot and a disabled input as one they could still fill.
                                                    <Text
                                                        size="sm"
                                                        c="dimmed"
                                                        ta="center"
                                                        aria-label={t('form.rows.notApplicable', { column: column.label, number: index + 1 })}
                                                    >
                                                        —
                                                    </Text>
                                                )}
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
                    <AddRowButton presets={field.presets ?? []} disabled={disabled} onAdd={onAdd} />
                </Group>
            </Stack>
        </Input.Wrapper>
    );
}

/**
 * A list's Add button, which asks what to start from when the field declared presets.
 *
 * A menu rather than a row of buttons, because a preset is a way to start one row and not a set of
 * actions of equal weight, and five buttons under a table read as five things the table does. The
 * empty row is the menu's last item rather than a second button beside it: one Add, whatever the
 * row is going to be.
 */
function AddRowButton({
    presets,
    disabled,
    onAdd,
}: {
    presets: readonly ConfigFieldPreset[];
    disabled: boolean;
    onAdd: (preset?: ConfigFieldPreset) => void;
}) {
    const { t } = useTranslation('settings');
    if (presets.length === 0) {
        return (
            <Button variant="light" size="compact-sm" leftSection={<IconPlus size={14} />} disabled={disabled} onClick={() => onAdd()}>
                {t('form.rows.add')}
            </Button>
        );
    }

    return (
        <Menu position="bottom-start" withinPortal>
            <Menu.Target>
                <Button
                    variant="light"
                    size="compact-sm"
                    leftSection={<IconPlus size={14} />}
                    rightSection={<IconChevronDown size={14} />}
                    disabled={disabled}
                >
                    {t('form.rows.add')}
                </Button>
            </Menu.Target>
            <Menu.Dropdown>
                {presets.map(preset => (
                    <Menu.Item key={preset.label} onClick={() => onAdd(preset)}>
                        {preset.label}
                    </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item onClick={() => onAdd()}>{t('form.rows.somethingElse')}</Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}

/** The state of one stored credential in a row: everything about it except the value, which nothing here has. */
export interface RowSecretState {
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
    const { t } = useTranslation('settings');
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
                        aria-label={
                            cleared
                                ? t('form.cellSecret.keepLabel', { column: column.label.toLowerCase() })
                                : t('form.cellSecret.clearLabel', { column: column.label.toLowerCase() })
                        }
                    >
                        {cleared ? t('form.cellSecret.willBeRemoved') : t('form.cellSecret.stored')}
                    </Anchor>
                ) : undefined}
            </Stack>
        );
    }

    if (choices.length > 0) {
        return <Autocomplete {...common} {...suggestionsAsValues(choices)} limit={Infinity} {...cell} />;
    }

    return <TextInput {...common} {...(column.type === 'url' ? URL_INPUT : {})} {...cell} />;
}

/** A `url` cell's keyboard, as the `url` field's is. */
const URL_INPUT = { inputMode: 'url' } as const;

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
export function RowControls({
    index,
    last,
    disabled,
    name,
    onRemove,
    onMove,
}: {
    index: number;
    /** The last row's index, so the bottom row's down arrow can be turned off. */
    last: number;
    disabled: boolean;
    /**
     * What this row IS, for the labels, when it is something an operator can name.
     *
     * A row of a `list` field is "row 3" because that is genuinely all it is. The Providers
     * section reuses these controls over rows that are plugins, where "Move row 3 up" is a worse
     * label than "Move Deezer up" for the one reader who needs it most.
     */
    name?: string;
    /** Absent leaves the row un-removable, which is how a pre-filled list keeps its own entries. */
    onRemove?: (index: number) => void;
    onMove: (index: number, by: -1 | 1) => void;
}) {
    const { t } = useTranslation('settings');
    const what = name ?? t('form.rows.rowName', { number: index + 1 });

    return (
        <Group gap={2} wrap="nowrap" justify="flex-end">
            <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={t('form.rows.moveUp', { name: what })}
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
                aria-label={t('form.rows.moveDown', { name: what })}
                disabled={disabled || index === last}
                onClick={() => {
                    onMove(index, 1);
                }}
            >
                <IconArrowDown size={16} />
            </ActionIcon>
            {onRemove !== undefined && <RemoveRow index={index} disabled={disabled} name={what} onRemove={onRemove} />}
        </Group>
    );
}

function RemoveRow({ index, disabled, name, onRemove }: { index: number; disabled: boolean; name?: string; onRemove: (index: number) => void }) {
    const { t } = useTranslation('settings');
    return (
        <ActionIcon
            variant="subtle"
            color="red"
            aria-label={t('form.rows.remove', { name: name ?? t('form.rows.rowName', { number: index + 1 }) })}
            disabled={disabled}
            onClick={() => {
                onRemove(index);
            }}
        >
            <IconTrash size={16} />
        </ActionIcon>
    );
}
