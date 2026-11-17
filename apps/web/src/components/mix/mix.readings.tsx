import { Button, Chip, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import type { MixDraftReading } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { Eyebrow } from '../shared/eyebrow';
import classes from './mix.flow.module.css';

/**
 * What a draft read in the brief, beside the canvas: each phrase and what it became, the phrases left to
 * the picks, and the questions the model asked, answered here and sent back with the next draft.
 *
 * Pointing at a phrase lights the nodes drawn from it, so the operator can check the reading against
 * the drawing without matching ids by eye.
 */
export function MixReadings({ readings, pending, model, answers, onAnswer, onPoint, onRedraft }: Props) {
    const { t } = useTranslation('mix');
    const questions = readings.filter(reading => reading.question !== undefined);
    const answered = questions.some(reading => answers[reading.question!] !== undefined);

    return (
        <div className={classes.readings}>
            <Stack gap="xs" p="sm" style={{ flex: 'none' }}>
                <Eyebrow>{t('draft.title')}</Eyebrow>
                <Text size="xs" c="dimmed">
                    {t('draft.intro')}
                </Text>
            </Stack>
            {pending ? (
                <Group gap="xs" p="sm" wrap="nowrap">
                    <Loader size="xs" color="grape" />
                    <Text size="xs" c="dimmed">
                        {t('draft.drafting')}
                    </Text>
                </Group>
            ) : (
                <ScrollArea style={{ flex: 1 }} type="auto" scrollbars="y">
                    <Stack gap={6} p="sm" pt={0}>
                        {readings.map((reading, index) => (
                            <div
                                key={index}
                                className={classes.reading}
                                data-question={reading.question !== undefined}
                                data-drawn={(reading.nodeIds?.length ?? 0) > 0}
                                onMouseEnter={() => onPoint(reading.nodeIds ?? [])}
                                onMouseLeave={() => onPoint([])}
                            >
                                {reading.quote.length > 0 ? (
                                    <Text size="xs" fs="italic">
                                        {t('draft.quoted', { quote: reading.quote })}
                                    </Text>
                                ) : undefined}
                                <Text size="xs" c="dimmed">
                                    {reading.question === undefined && (reading.nodeIds?.length ?? 0) === 0 && reading.note.length === 0
                                        ? t('draft.leftToPicks')
                                        : reading.note}
                                </Text>
                                {reading.question === undefined ? undefined : (
                                    <Stack gap={4} mt={4}>
                                        <Text size="xs" fw={600}>
                                            {reading.question}
                                        </Text>
                                        {(reading.options?.length ?? 0) > 0 ? (
                                            <Chip.Group
                                                value={answers[reading.question] ?? ''}
                                                onChange={value => onAnswer(reading.question!, String(value))}
                                            >
                                                <Group gap={4}>
                                                    {reading.options!.map(option => (
                                                        <Chip key={option} value={option} size="xs" color="grape" variant="light">
                                                            {option}
                                                        </Chip>
                                                    ))}
                                                </Group>
                                            </Chip.Group>
                                        ) : undefined}
                                    </Stack>
                                )}
                            </div>
                        ))}
                    </Stack>
                </ScrollArea>
            )}
            {!pending && (questions.length > 0 || model !== undefined) ? (
                <Stack gap={6} p="sm" style={{ flex: 'none', borderTop: '1px solid var(--da-border)' }}>
                    {questions.length > 0 ? (
                        <Button size="xs" color="grape" variant="light" disabled={!answered} onClick={onRedraft}>
                            {t('draft.again')}
                        </Button>
                    ) : undefined}
                    {questions.length > 0 && !answered ? (
                        <Text size="xs" c="dimmed">
                            {t('draft.unanswered')}
                        </Text>
                    ) : undefined}
                    {model === undefined ? undefined : (
                        <Text size="xs" c="dimmed">
                            {t('draft.model', { model })}
                        </Text>
                    )}
                </Stack>
            ) : undefined}
        </div>
    );
}

interface Props {
    readings: readonly MixDraftReading[];
    /** A draft is being made, so what is shown is about to be replaced. */
    pending: boolean;
    model?: string;
    /** The operator's answers so far, by question. */
    answers: Readonly<Record<string, string>>;
    onAnswer: (question: string, answer: string) => void;
    /** The nodes a phrase became, or none when the pointer leaves it. */
    onPoint: (nodeIds: readonly string[]) => void;
    onRedraft: () => void;
}
