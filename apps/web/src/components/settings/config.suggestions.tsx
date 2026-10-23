/**
 * The suggestion list an autocomplete is handed, for a top-level field and for a row's cell alike:
 * values as the options, labels drawn beside them, and the whole list shown once a choice is made.
 *
 * Split out of `config.fields.form.tsx` unchanged; it renders, so it is not in `config.fields.values.ts`.
 */
import { Text, type ComboboxItem, type ComboboxParsedItem, type RenderAutocompleteOption, type OptionsFilter } from '@mantine/core';

/**
 * An autocomplete's options, as the values themselves plus a way to draw the names beside them.
 *
 * **What is INSERTED has to be what the field takes.** Mantine's `Autocomplete` is a string input:
 * hand it `{ value, label }` pairs and picking one puts the LABEL in the box, because the box holds
 * text rather than a selection. Where a source names a thing twice — a speech engine listing
 * `Connor.wav` as "Connor" — that quietly stores the display name in a field the engine will answer
 * 404 for, and the failure surfaces as a voice that cannot speak with a settings page that looks
 * correctly filled in. This station had exactly that: `defaultVoice` reading `Connor`, chosen from a
 * menu, rejected by the server every time it was used.
 *
 * So the data is the values, and the label is drawn in the dropdown instead — visible while
 * choosing, absent from what the choice writes. A source whose two halves agree draws one line, so
 * nothing changes for the engines that name a voice once.
 */
export function suggestionsAsValues(options: { value: string; label: string }[]) {
    const labels = new Map(options.map(option => [option.value, option.label]));

    return {
        data: options.map(option => option.value),
        renderOption: (({ option }) => {
            const label = labels.get(option.value);
            if (label === undefined || label === option.value) return <span>{option.value}</span>;

            return (
                <span>
                    {label}{' '}
                    <Text component="span" c="dimmed" size="xs">
                        {option.value}
                    </Text>
                </span>
            );
        }) satisfies RenderAutocompleteOption,
        filter: showAllWhenSettled(labels),
    };
}

/**
 * Which suggestions an autocomplete shows for what is currently typed.
 *
 * Mantine's default narrows to what matches the input, which is right while somebody is typing and
 * wrong the rest of the time: a field already holding a chosen value matches only itself, so opening
 * the list shows the one option you already have and hides every alternative. That is the exact
 * moment an operator is trying to CHANGE it.
 *
 * So: an input that exactly equals one of the options is a settled choice rather than a search, and
 * the whole list is shown. Anything else narrows as usual.
 *
 * It takes the labels rather than reading them off the options, because the options are now the
 * values alone — and somebody typing "Connor" is looking for the clip that is DISPLAYED that way,
 * which is the only name they have been shown.
 */
const showAllWhenSettled =
    (labels: Map<string, string>): OptionsFilter =>
    ({ options, search }) => {
        // Mantine allows grouped options; nothing here builds any, so a group is passed through
        // untouched rather than being reached into.
        const isItem = (option: ComboboxParsedItem): option is ComboboxItem => 'value' in option;

        const typed = search.trim().toLowerCase();
        if (typed.length === 0) return options;
        if (options.some(option => isItem(option) && option.value.toLowerCase() === typed)) return options;

        return options.filter(option => !isItem(option) || `${labels.get(option.value) ?? ''} ${option.value}`.toLowerCase().includes(typed));
    };
