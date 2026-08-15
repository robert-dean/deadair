import { Text, type TextProps } from '@mantine/core';

export interface EyebrowProps extends TextProps {
    children: React.ReactNode;
}

/**
 * The small uppercase label the console uses to name a group of things.
 *
 * It existed five times before this, hand-rolled, at three different letter-spacings — which is
 * the kind of drift nobody notices in one file and everybody notices on one page. Mono, because
 * on a desk the legends are silkscreened and the content is not, and that difference is what
 * makes a label read as a label rather than as very small text.
 */
export function Eyebrow({ children, ...props }: EyebrowProps) {
    return (
        <Text
            component="span"
            size="xs"
            fw={600}
            tt="uppercase"
            ff="monospace"
            c="dimmed"
            style={{ letterSpacing: 'var(--da-tracking-eyebrow)' }}
            {...props}
        >
            {children}
        </Text>
    );
}
