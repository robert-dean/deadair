import { useState } from 'react';
import { CloseButton, TextInput } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';

/** Long enough that typing a title is one request rather than a dozen, short enough to feel immediate. */
const DEBOUNCE_MS = 250;

export interface CatalogSearchProps {
    /** The committed term, which lives in the route's search params. */
    value: string;
    onChange: (search: string) => void;
    placeholder: string;
}

/**
 * The search box over a catalog list.
 *
 * The input keeps its own state and only pushes the committed term outward on a debounce. Writing
 * every keystroke straight to the route would put one history entry per character in the back
 * button and fire a request per character behind it.
 *
 * `value` is read once, as the initial state. It is deliberately not synchronised back into the
 * field: the only writer of the committed term is this component, and re-seeding from it would
 * fight the user's typing whenever a request landed mid-word.
 */
export function CatalogSearch({ value, onChange, placeholder }: CatalogSearchProps) {
    const [typed, setTyped] = useState(value);
    const commit = useDebouncedCallback(onChange, DEBOUNCE_MS);

    function update(next: string): void {
        setTyped(next);
        commit(next);
    }

    return (
        <TextInput
            value={typed}
            onChange={event => {
                update(event.currentTarget.value);
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            maw={360}
            rightSection={
                typed === '' ? undefined : (
                    <CloseButton
                        size="sm"
                        aria-label="Clear search"
                        onClick={() => {
                            update('');
                        }}
                    />
                )
            }
        />
    );
}
