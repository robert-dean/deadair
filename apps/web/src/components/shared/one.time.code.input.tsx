import { TextInput } from '@mantine/core';

/** How many digits an authenticator app shows. The API accepts up to ten; every app here shows six. */
export const ONE_TIME_CODE_LENGTH = 6;

export interface OneTimeCodeInputProps {
    value: string;
    onChange: (value: string) => void;
    /** Fires once, when the last digit lands, so a code can submit without a second tap. */
    onComplete?: (value: string) => void;
    label?: string;
    error?: string;
    disabled?: boolean;
    autoFocus?: boolean;
}

/**
 * A six-digit code, typed or pasted.
 *
 * One field rather than six boxes, and the reason is paste: an authenticator app puts the code on
 * the clipboard as one string, and a row of single-character inputs either splits it or drops
 * it, depending on the browser. `autoComplete="one-time-code"` is what lets a phone offer the code
 * it just received; `inputMode="numeric"` is what brings up the right keyboard for it.
 */
export function OneTimeCodeInput({ value, onChange, onComplete, label = 'Code', error, disabled, autoFocus = true }: OneTimeCodeInputProps) {
    return (
        <TextInput
            label={label}
            value={value}
            error={error}
            disabled={disabled}
            autoFocus={autoFocus}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={ONE_TIME_CODE_LENGTH}
            placeholder="123456"
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 18, letterSpacing: 6 } }}
            onChange={event => {
                const next = event.currentTarget.value.replace(/\D/g, '').slice(0, ONE_TIME_CODE_LENGTH);
                onChange(next);
                if (next.length === ONE_TIME_CODE_LENGTH && next !== value) onComplete?.(next);
            }}
        />
    );
}
