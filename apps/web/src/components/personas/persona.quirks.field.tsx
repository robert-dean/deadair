import { ActionIcon, Button, Group, Input, Select, Stack, Textarea } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { PersonaQuirk } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';
import { usePhone } from '../shared/use.phone';

/** The rungs a quirk can be set to, in the order the picker lists them. `always` is the default. */
export const QUIRK_CADENCES = ['always', 'often', 'occasionally', 'rarely'] as const;

export type QuirkCadence = (typeof QUIRK_CADENCES)[number];

/** One quirk as the form holds it: the words, and a rung that is never empty. */
export interface QuirkRow {
    text: string;
    cadence: QuirkCadence;
}

/** A saved sheet's quirks as rows. An absent cadence is `always`, which is what it means. */
export const quirkRowsOf = (quirks: readonly PersonaQuirk[] | undefined): QuirkRow[] =>
    (quirks ?? []).map(quirk => ({ text: quirk.text, cadence: quirk.cadence ?? 'always' }));

/**
 * Rows as the API takes them: blank ones dropped, the words trimmed, and no cadence on an `always`
 * one, so the default has one spelling in the row and in the editor that reads it back.
 */
export function quirksOf(rows: readonly QuirkRow[]): PersonaQuirk[] | undefined {
    const quirks = rows
        .map(row => ({ ...row, text: row.text.trim() }))
        .filter(row => row.text.length > 0)
        .map(row => (row.cadence === 'always' ? { text: row.text } : { text: row.text, cadence: row.cadence }));
    return quirks.length === 0 ? undefined : quirks;
}

interface QuirksFieldProps {
    rows: readonly QuirkRow[];
    onChange: (rows: QuirkRow[]) => void;
    disabled?: boolean;
}

/**
 * A character's quirks, one row each, with how often each one applies.
 *
 * A row rather than a line in one box, because a quirk now carries a rung: "yell for Sharon" set to
 * `rarely` is handed to the writer on the breaks the station picks for it, where the same words in a
 * box of rules were sent on every break and never once said. The words themselves should not say
 * "now and then" any more, and the field's description tells the operator so.
 */
export function QuirksField({ rows, onChange, disabled }: QuirksFieldProps) {
    const { t } = useTranslation('personas');
    // On a phone the words take the whole width and the rung and the bin go underneath: beside a
    // 150px picker a quirk wraps to two words a line, which is a sentence nobody can read back.
    const phone = usePhone();

    const cadences = QUIRK_CADENCES.map(value => ({ value, label: t(`editor.field.quirks.cadence.${value}`) }));
    const replace = (index: number, row: QuirkRow) => onChange(rows.map((existing, at) => (at === index ? row : existing)));

    return (
        <Input.Wrapper label={t('editor.field.quirks.label')} description={t('editor.field.quirks.description')}>
            <Stack gap={phone ? 'md' : 'xs'} mt={6}>
                {rows.map((row, index) => (
                    <Group key={index} gap="xs" align="flex-start" wrap={phone ? 'wrap' : 'nowrap'}>
                        <Textarea
                            style={{ flex: phone ? '1 1 100%' : 1 }}
                            autosize
                            minRows={1}
                            maxRows={6}
                            aria-label={t('editor.field.quirks.text', { number: index + 1 })}
                            value={row.text}
                            disabled={disabled}
                            onChange={event => replace(index, { ...row, text: event.currentTarget.value })}
                        />
                        <Select
                            w={phone ? undefined : 150}
                            style={phone ? { flex: 1 } : undefined}
                            aria-label={t('editor.field.quirks.cadence.label', { number: index + 1 })}
                            data={cadences}
                            value={row.cadence}
                            allowDeselect={false}
                            disabled={disabled}
                            onChange={value => replace(index, { ...row, cadence: (value as QuirkCadence | null) ?? 'always' })}
                        />
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            aria-label={t('editor.field.quirks.remove', { number: index + 1 })}
                            disabled={disabled}
                            onClick={() => onChange(rows.filter((_, at) => at !== index))}
                        >
                            <IconTrash size={16} />
                        </ActionIcon>
                    </Group>
                ))}
                <Group>
                    <Button
                        variant="light"
                        size="compact-sm"
                        leftSection={<IconPlus size={14} />}
                        disabled={disabled}
                        onClick={() => onChange([...rows, { text: '', cadence: 'always' }])}
                    >
                        {t('editor.field.quirks.add')}
                    </Button>
                </Group>
            </Stack>
        </Input.Wrapper>
    );
}
