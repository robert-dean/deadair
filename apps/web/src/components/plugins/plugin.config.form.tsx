import type { PluginDetail } from '@deadair/sdk';

import { useUpdatePluginConfig } from '../../api/plugins.queries';
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
 * left here is the two things that are actually about a plugin: which mutation saves it, and what
 * to call the button.
 */
export function PluginConfigForm({ plugin }: PluginConfigFormProps) {
    const save = useUpdatePluginConfig(plugin.id);

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
        />
    );
}
