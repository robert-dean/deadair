import type { PluginDetail } from '@deadair/sdk';

import { usePluginConfigSuggestions, useUpdatePluginConfig } from '../../api/plugins.queries';
import { ConfigFieldsForm } from '../settings/config.fields.form';

export interface PluginConfigFormProps {
    plugin: PluginDetail;
}

/**
 * The settings form, generated from the plugin's own `configFields`.
 *
 * There is no per-plugin code here on purpose: a plugin nobody has written yet gets a working
 * settings screen the moment the host can read its manifest. The plugin's zod schema stays the
 * authority on what is valid, and its `422` field messages are handed straight back to the inputs
 * they name.
 *
 * The rendering is {@link ConfigFieldsForm}, shared with the station's own settings page. What is
 * left here is the three things that are actually about a plugin: which mutation saves it, what to
 * call the button, and the live choices only the plugin can answer for.
 *
 * Those choices are why a field whose value comes from the operator's own server is fillable at
 * all. A manifest's `options` are fixed when it is written, so without them the only way to learn
 * what a server offers is to read it out of a "Test connection" message and type it back — and for
 * a field that cannot be filled before the address is saved, that is a loop with no way in.
 */
export function PluginConfigForm({ plugin }: PluginConfigFormProps) {
    const save = useUpdatePluginConfig(plugin.id);
    const suggestions = usePluginConfigSuggestions(plugin.id);

    return (
        <ConfigFieldsForm
            // Keyed on the plugin, so navigating between two of them rebuilds the form rather than
            // carrying one plugin's typed-in values into the other's inputs.
            key={plugin.id}
            fields={plugin.configFields}
            stored={plugin.config}
            secretsConfigured={plugin.secretsConfigured}
            onSubmit={submission => save.mutateAsync(submission)}
            pending={save.isPending}
            succeeded={save.isSuccess}
            error={save.error}
            submitLabel="Save configuration"
            failureTitle="Save failed"
            failureMessage="The configuration could not be saved."
            suggestions={suggestions.data?.fields}
            // A request that failed outright still means the plugin might have something to say, so
            // the refresh stays offered. Only a plugin that answered "I do not do this" hides it.
            suggestionsSupported={suggestions.data?.supported ?? suggestions.isError}
            onRefreshSuggestions={() => void suggestions.refetch()}
            suggestionsPending={suggestions.isFetching}
        />
    );
}
