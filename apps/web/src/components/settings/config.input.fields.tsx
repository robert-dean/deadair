/**
 * The config controls that are more than one Mantine input: a slider and a range drawn from a
 * number field's bounds, a byte count typed in gigabytes, and a secret that is stored and never shown.
 *
 * Split out of `config.fields.form.tsx` unchanged.
 */
import { Anchor, Group, Input, NumberInput, PasswordInput, RangeSlider, Slider, Stack, Text } from '@mantine/core';
import { type GetInputPropsReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import type { ConfigFieldDescriptor } from '@deadair/sdk';
import { type FieldValue } from './config.fields.values';

/**
 * Whether a field asked for a slider AND declared the range one cannot be drawn without.
 *
 * Both halves matter. `control` is an ask, so nothing is a slider that did not request it — a rule
 * inferred from `min` and `max` being present would turn every millisecond pause in the registry
 * into a control nobody can land on 3500 with. And a slider with an open end has no track, so a
 * field that asks without bounding itself is drawn as the spinner it would have been.
 */
export function isSlider(field: ConfigFieldDescriptor): boolean {
    return field.control === 'slider' && field.min !== undefined && field.max !== undefined;
}

/**
 * The position of the field that closes the range this one opens, or -1.
 *
 * Forgiving for `isVisible`'s reason and in the same shape: a `rangeWith` naming a key this form
 * does not hold is a settings page drawing one group of a larger set, not a mistake, and both ends
 * falling back to their own controls is a worse form rather than a broken one. Bounds are required
 * because a range with an open end has no track, exactly as for a single-handled one.
 */
export function rangeEndOf(field: ConfigFieldDescriptor, fields: readonly ConfigFieldDescriptor[]): number {
    if (field.rangeWith === undefined || field.min === undefined || field.max === undefined) return -1;
    return fields.findIndex(candidate => candidate.key === field.rangeWith);
}

/** Whether some other field in this form has already drawn this one as the far end of its range. */
export function isRangeEnd(field: ConfigFieldDescriptor, fields: readonly ConfigFieldDescriptor[]): boolean {
    return fields.some(candidate => candidate.key !== field.key && rangeEndOf(candidate, fields) !== -1 && candidate.rangeWith === field.key);
}

/** A form value as the number a slider sits at, where anything unreadable is the field's own default. */
function sliderValue(value: FieldValue | undefined, fallback: number): number {
    const typed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(typed) ? typed : fallback;
}

/**
 * A slider's label, with what it currently says on the end of it.
 *
 * Where the value lives, and it is not on the handle. Mantine's always-on bubble is absolutely
 * positioned over whatever is above the track, and two of them on one track collide: the production
 * length is 1 to 120 minutes and sits at 10 to 12, so both handles land in the first tenth and the
 * two bubbles overlap into a smudge that reads as neither number. On the label row the pair is
 * legible however close the handles are, and it stays legible for the single-handled case that
 * pushed its own value through the middle of its help text.
 *
 * The transient bubble is still on, so dragging shows the figure under the thumb where the eye
 * already is. This is the readout you can look up and find, rather than the one you have to hold a
 * mouse button down to see.
 */
function sliderLabel(text: string, reading: string) {
    return (
        <Group justify="space-between" gap="xs" wrap="nowrap">
            <span>{text}</span>
            {/* `.da-num` for the console's rule about columns of figures: a value that changes as a
                handle moves twitches the label in proportional digits. */}
            <Text component="span" size="sm" c="dimmed" className="da-num">
                {reading}
            </Text>
        </Group>
    );
}

interface SliderFieldProps {
    field: ConfigFieldDescriptor;
    inputProps: GetInputPropsReturnType;
    common: { label: string; description?: string; withAsterisk?: boolean; disabled: boolean };
}

/**
 * A bounded number as a track with a handle on it.
 *
 * For the values an operator arrives at rather than knows: how much of an hour comes from a chart,
 * how far under the music the DJ sits, how much of a library one sync may retire. A spinner asks
 * those questions by inviting a guess and then a correction; a track answers "how far along this
 * am I" in one glance, which is the actual question.
 *
 * `Input.Wrapper` rather than the label prop a Mantine input would take, because `Slider` has no
 * label of its own — that is what makes it a slider and not a field. The wrapper is also what puts
 * a server-side rejection under the right control, so a route refusing a number still names it.
 *
 * The marks are the declared ends and nothing between them. A scale reading `0 · 25 · 50 · 75 · 100`
 * is a ruler nobody measures against, where the two ends are the only numbers that answer the
 * question the operator has, which is "how much room do I have here". The value itself is on the
 * label row rather than over the handle, for {@link sliderLabel}'s reasons.
 *
 * Empty is not representable and does not need to be: a slider is only offered for a field that
 * declared both ends, so its own default is always a legal position and "unset" reads as the
 * default rather than as a blank. That is the one thing this control cannot do that a spinner can,
 * and it is why the track cache (where "no limit" is a real answer) is a `BytesField` instead.
 */
export function SliderField({ field, inputProps, common }: SliderFieldProps) {
    const { value, onChange, error } = inputProps;
    // Bounded above by `isSlider`, which is the only caller.
    const min = field.min ?? 0;
    const max = field.max ?? 100;

    const at = sliderValue(value as FieldValue | undefined, typeof field.default === 'number' ? field.default : min);

    return (
        <Input.Wrapper
            label={sliderLabel(common.label, sliderText(at, field))}
            description={common.description}
            withAsterisk={common.withAsterisk}
            error={error}
        >
            <Slider
                // Room for the end marks, which Mantine does not give itself: they are absolutely
                // positioned, so the layout is the same height with or without them and they land
                // on top of whatever the form draws next.
                mt="xs"
                mb="lg"
                disabled={common.disabled}
                min={min}
                max={max}
                step={field.step ?? 1}
                marks={[
                    { value: min, label: sliderText(min, field) },
                    { value: max, label: sliderText(max, field) },
                ]}
                label={position => sliderText(position, field)}
                value={at}
                onChange={onChange}
            />
        </Input.Wrapper>
    );
}

interface RangeFieldProps {
    /** The LOWER end, which is the one that declared the pairing and whose label the control wears. */
    field: ConfigFieldDescriptor;
    common: { label: string; description?: string; withAsterisk?: boolean; disabled: boolean };
    lower: GetInputPropsReturnType;
    upper: GetInputPropsReturnType;
}

/**
 * Two settings that are the two ends of one range, as one control with two handles.
 *
 * Still two settings underneath: two keys, two rows, two independent validations, and
 * `buildSubmission` never learns this component exists because each end keeps its own entry in the
 * form. What changes is that the ends cannot cross, which is the entire reason for it.
 *
 * What it buys is LEGIBILITY rather than correctness, which is worth being exact about because the
 * other reason is the plausible one: every reader of a paired setting here sorts its two ends with
 * `Math.min`/`Math.max` before using them, so an inverted range was always tolerated rather than
 * obeyed. What two boxes cost is that the relationship between them lives only in their labels —
 * "fewest", "most", "the other end" — so the pair is read rather than seen. One track says it in
 * the shape of the control, and the handles not crossing comes free with that.
 *
 * `minRange={0}` because Mantine's default is 10, which for a story count of 1 to 8 is a control
 * that cannot be moved at all. Zero also allows both ends on the same number, which is a real
 * answer here: it is how an operator asks for a bulletin that is always the same length.
 *
 * A handle driven into the other one PUSHES it rather than stopping under it, which is Mantine's
 * behaviour and not a choice made here. Both satisfy the thing that matters — the ends cannot cross
 * — and the difference is worth knowing when reading the test that pins it: dragging the lower end
 * of a 4-to-5 range up by three lands both on 7, not both on 5.
 *
 * The pair is read off the label row rather than off the handles, which for a range is not a
 * refinement but the difference between legible and not: a production runs 10 to 12 minutes out of
 * a declared 1 to 120, so both handles sit in the first tenth of the track and two bubbles over
 * them overlap into one unreadable mark. See {@link sliderLabel}.
 */
export function RangeField({ field, common, lower, upper }: RangeFieldProps) {
    // Bounded above by `rangeEndOf`, which is the only caller.
    const min = field.min ?? 0;
    const max = field.max ?? 100;

    const low = sliderValue(lower.value as FieldValue | undefined, typeof field.default === 'number' ? field.default : min);
    const high = sliderValue(upper.value as FieldValue | undefined, max);

    return (
        <Input.Wrapper
            label={sliderLabel(common.label, `${sliderText(low, field)}–${sliderText(high, field)}`)}
            description={common.description}
            withAsterisk={common.withAsterisk}
            // Either end may be the one the server refused, and there is one control to say so on.
            error={lower.error ?? upper.error}
        >
            <RangeSlider
                mt="xs"
                mb="lg"
                disabled={common.disabled}
                min={min}
                max={max}
                step={field.step ?? 1}
                minRange={0}
                marks={[
                    { value: min, label: sliderText(min, field) },
                    { value: max, label: sliderText(max, field) },
                ]}
                label={position => sliderText(position, field)}
                value={[low, high]}
                onChange={([nextLow, nextHigh]) => {
                    lower.onChange(nextLow);
                    upper.onChange(nextHigh);
                }}
            />
        </Input.Wrapper>
    );
}

/**
 * One position on a slider, said the way the label says it.
 *
 * The `fraction` conversion lives HERE and nowhere else, exactly as the gigabyte conversion lives
 * only in `BytesField`: the value that leaves this component is the share the row holds, so every
 * reader on the server still multiplies by a number between 0 and 1.
 *
 * Rounded because floating point makes 0.15000000000000002 out of three steps of 0.05, and a label
 * reading `15.000000000000002%` is worse than no label.
 */
function sliderText(position: number, field: ConfigFieldDescriptor): string {
    if (field.unit === 'fraction') return `${Math.round(position * 100)}%`;
    return String(Math.round(position * 1000) / 1000);
}

/** One gigabyte, as the operator means it and as the figures beside it are drawn. */
const BYTES_PER_GB = 1024 * 1024 * 1024;

interface BytesFieldProps {
    field: ConfigFieldDescriptor;
    inputProps: GetInputPropsReturnType;
    common: { label: string; description?: string; withAsterisk?: boolean; disabled: boolean };
}

/**
 * A byte count, typed in gigabytes.
 *
 * The value stored and submitted is BYTES, unchanged — the conversion lives here and nowhere else,
 * so every reader on the server compares against the unit the row holds. What it buys is that a
 * cache limit is "20" rather than 21474836480, which is a number nobody can type correctly or check
 * at a glance.
 *
 * Driven by `unit` on the descriptor rather than by the field's key, which is the whole reason the
 * SDK grew that property: a form that special-cased one setting by name would be a thing nobody
 * finds when the second one arrives.
 *
 * Fractions are allowed and rounded to whole bytes on the way out, because half a gigabyte is a
 * perfectly ordinary thing to want and the alternative is asking for it in a unit the label does not
 * mention. Empty stays empty rather than becoming zero: for a cap, "unset" is a real answer and it
 * is the default one.
 */
export function BytesField({ field, inputProps, common }: BytesFieldProps) {
    const { t } = useTranslation('settings');
    const { value, onChange, ...rest } = inputProps;
    const bytes = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));

    return (
        <NumberInput
            {...common}
            {...rest}
            suffix=" GB"
            // A declared range is in BYTES like the value it bounds, so it is converted here along
            // with everything else this control converts. Zero stays the floor when none is
            // declared, because "no limit" is stored as 0 rather than as an absent row.
            min={field.min === undefined ? 0 : field.min / BYTES_PER_GB}
            max={field.max === undefined ? undefined : field.max / BYTES_PER_GB}
            step={1}
            decimalScale={2}
            placeholder={field.placeholder ?? t('form.bytes.noLimit')}
            value={Number.isFinite(bytes) && bytes > 0 ? bytes / BYTES_PER_GB : ''}
            onChange={next => {
                const gigabytes = typeof next === 'number' ? next : Number.parseFloat(next);
                onChange(Number.isFinite(gigabytes) && gigabytes > 0 ? Math.round(gigabytes * BYTES_PER_GB) : 0);
            }}
        />
    );
}

interface SecretFieldProps {
    field: ConfigFieldDescriptor;
    inputProps: GetInputPropsReturnType;
    /** Whether the server currently holds a value for this field. Never the value itself. */
    stored: boolean;
    cleared: boolean;
    disabled: boolean;
    onToggleCleared: () => void;
}

/**
 * A write-only field. Nothing about a stored secret is displayed, because nothing about it is ever
 * sent: the API reports one as a boolean and no more.
 */
export function SecretField({ field, inputProps, stored, cleared, disabled, onToggleCleared }: SecretFieldProps) {
    const { t } = useTranslation('settings');
    return (
        <Stack gap="xxs">
            <PasswordInput
                label={field.label}
                description={field.help}
                withAsterisk={field.required}
                disabled={disabled || cleared}
                placeholder={stored && !cleared ? '••••••••' : field.placeholder}
                {...inputProps}
            />
            {stored ? (
                // The state of the stored value sits below the input rather than in its
                // description, which the field's own help text already has a claim on.
                <Group justify="space-between" gap="sm" wrap="nowrap">
                    <Text size="xs" c={cleared ? 'red' : 'dimmed'}>
                        {cleared ? t('form.secret.willBeRemoved') : t('form.secret.stored')}
                    </Text>
                    <Anchor component="button" type="button" size="xs" c={cleared ? undefined : 'red'} onClick={onToggleCleared}>
                        {cleared ? t('form.secret.keep') : t('form.secret.clear')}
                    </Anchor>
                </Group>
            ) : undefined}
        </Stack>
    );
}
