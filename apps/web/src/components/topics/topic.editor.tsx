import { Modal, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import type { Topic, TopicInput, TopicKindDescriptor } from '@deadair/sdk';

import { ConfigFieldsForm } from '../settings/config.fields.form';

/**
 * Writing one subject a break can be about.
 *
 * Two halves, and they come from different places. The LABEL is the station's own words — it is
 * read out, so it is the phrasing an operator would want to hear — and is a plain input here. What
 * a subject MEANS is the kind's business, so it is rendered from the descriptors that kind
 * declared, through the same `ConfigFieldsForm` the plugin settings and the station settings use.
 * That is what makes weather locations a form nobody writes: the fields arrive from the API.
 *
 * ## Lists are shown as the operator would type them
 *
 * A `text` field holds one string, and the classifier reads a list written as lines, as a comma
 * list, or as a real array — the seeds use arrays, which is the one shape that cannot be mis-split.
 * So an array is joined for display and whatever comes back is saved as typed, which keeps the box
 * honest: what it shows is what was stored.
 */
export function TopicEditor({ target, kind, onClose, onSubmit, pending, error }: Props) {
    const opened = target !== undefined;
    const topic = target?.kind === 'edit' ? target.topic : undefined;

    // Held here rather than inside the fields form, which renders the kind's own descriptors and
    // knows nothing about a subject having a name.
    const [label, setLabel] = useState(topic?.label ?? '');

    const save = async (config: Record<string, unknown>) => {
        const named = label.trim();
        if (named.length === 0) throw new Error('A name is what the station says out loud, so it cannot be empty.');

        await onSubmit({
            kind: kind.kind,
            // The key is the operator's original where there is one, so renaming a category does not
            // rename what a band is pointing at. A new subject leaves it to the API, which slugs the
            // label — see `TopicsService`.
            key: topic?.key ?? named,
            label: named,
            config,
            position: topic?.position ?? (target?.kind === 'new' ? target.position : 0),
        });
    };

    return (
        <Modal opened={opened} onClose={onClose} title={topic ? `Edit ${kind.nounOne}` : `New ${kind.nounOne}`} size="lg">
            <Stack gap="md">
                <TextInput
                    label="Name"
                    description={`What the station calls this ${kind.nounOne} out loud.`}
                    placeholder="Technology"
                    value={label}
                    onChange={event => setLabel(event.currentTarget.value)}
                />

                {topic ? (
                    <Text size="xs" c="dimmed">
                        Referred to as <code>{topic.key}</code>, which is what the format clock points a band at. Renaming this does not change it.
                    </Text>
                ) : undefined}

                <ConfigFieldsForm
                    fields={kind.fields}
                    stored={storedValues(kind, topic)}
                    secretsConfigured={{}}
                    onSubmit={save}
                    pending={pending}
                    succeeded={false}
                    error={error}
                    submitLabel="Save"
                    failureTitle={`That ${kind.nounOne} could not be saved`}
                    failureMessage="Nothing was written."
                />
            </Stack>
        </Modal>
    );
}

/** What the editor is open on: absent is closed, a subject is that one, a new one knows its place. */
export type TopicTarget = { kind: 'edit'; topic: Topic } | { kind: 'new'; position: number };

interface Props {
    target?: TopicTarget;
    /** The kind this subject belongs to, whose descriptors are the form. */
    kind: TopicKindDescriptor;
    onClose: () => void;
    onSubmit: (draft: TopicInput) => Promise<unknown>;
    pending: boolean;
    error?: unknown;
}

/**
 * The stored config as the fields want it: strings, with a list joined the way it is typed back.
 *
 * Joined on the separator the field's own placeholder uses, so what an operator sees matches what
 * they would have written. Both are read on the way back in, so neither is a wire format.
 */
function storedValues(kind: TopicKindDescriptor, topic?: Topic): Record<string, unknown> {
    const config = topic?.config ?? {};

    return Object.fromEntries(
        kind.fields.map(field => {
            const value = config[field.key];
            if (!Array.isArray(value)) return [field.key, value ?? ''];

            const multiline = (field.placeholder ?? '').includes('\n');
            return [field.key, value.join(multiline ? '\n' : ', ')];
        }),
    );
}
