import { useState } from 'react';
import { Modal, NavLink, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import { kindsAt, type MixKind, type SocketType } from './mix.kinds';

export interface AddRuleProps {
    opened: boolean;
    /** The loose end of a wire the rule is being added at, which narrows the list to rules that can take it. */
    end: { side: 'source' | 'target'; type: SocketType } | undefined;
    onPick: (kind: MixKind, socket: number) => void;
    onClose: () => void;
}

/**
 * The rules an operator can add, found by typing rather than read out of a menu.
 *
 * Matched on a rule's name and on its one-line hint, so "percent" finds Limit share and "band" finds
 * Block. Enter takes the first match. Opened at the end of a wire it lists only the rules that wire
 * can join, so what is picked is always wired on arrival.
 */
export function AddRule({ opened, end, onPick, onClose }: AddRuleProps) {
    const { t } = useTranslation('mix');
    const [query, setQuery] = useState('');
    const words = query.trim().toLowerCase();
    const offered = kindsAt(end).filter(({ kind }) => words === '' || `${t(`kinds.${kind}`)} ${t(`hints.${kind}`)}`.toLowerCase().includes(words));

    const pick = (kind: MixKind, socket: number) => {
        setQuery('');
        onPick(kind, socket);
    };

    return (
        <Modal
            opened={opened}
            onClose={() => {
                setQuery('');
                onClose();
            }}
            title={end === undefined ? t('editor.addTitle') : t('editor.addTitleWire')}
            size="sm"
        >
            <Stack gap="xs">
                <TextInput
                    data-autofocus
                    aria-label={t('editor.addSearch')}
                    placeholder={t('editor.addSearch')}
                    leftSection={<IconSearch size={14} />}
                    value={query}
                    onChange={event => setQuery(event.currentTarget.value)}
                    onKeyDown={event => {
                        const first = offered[0];
                        if (event.key === 'Enter' && first !== undefined) {
                            event.preventDefault();
                            pick(first.kind, first.socket);
                        }
                    }}
                />
                <ScrollArea.Autosize mah={360}>
                    {offered.length === 0 ? (
                        <Text size="sm" c="dimmed" p="xs">
                            {t('editor.addNothing')}
                        </Text>
                    ) : (
                        offered.map(({ kind, socket }) => (
                            <NavLink
                                key={kind}
                                component="button"
                                type="button"
                                label={t(`kinds.${kind}`)}
                                description={t(`hints.${kind}`)}
                                onClick={() => pick(kind, socket)}
                            />
                        ))
                    )}
                </ScrollArea.Autosize>
            </Stack>
        </Modal>
    );
}
