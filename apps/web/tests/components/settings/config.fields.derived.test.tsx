// Three settings tell the operator to leave them empty and say what happens then, and for as long
// as this form existed it could only repeat the sentence: an empty Public URL showed `https://`, a
// hardcoded hint, while the address listeners were actually being sent to sat in the API's answer
// unread. What matters here is that the fallback is drawn only while the box is EMPTY, and drawn
// twice on purpose — as the watermark, and as a line under the input that a screen reader gets.

import { describe, expect, it, vi } from 'vitest';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { ConfigFieldsForm } from '../../../src/components/settings/config.fields.form';
import { render, screen, setupUser } from '../../utils/render';

const PUBLIC_URL: ConfigFieldDescriptor = {
    key: 'stream.publicUrl',
    label: 'Public URL',
    type: 'url',
    default: '',
    help: 'Where listeners reach the station.',
};

const HOSTNAME: ConfigFieldDescriptor = { key: 'stream.hostname', label: 'Advertised hostname', type: 'string', default: '' };

/** The third control this form draws for a plain string: free text WITH suggestions. */
const TIMEZONE: ConfigFieldDescriptor = {
    key: 'station.timezone',
    label: 'Station timezone',
    type: 'string',
    default: '',
    optionsFrom: 'intl.timeZones',
};

/** The form as the settings page mounts it, with and without the map the station worked out. */
function draw(stored: Record<string, unknown>, derived?: Record<string, string>) {
    render(
        <ConfigFieldsForm
            fields={[PUBLIC_URL, HOSTNAME, TIMEZONE]}
            stored={stored}
            secretsConfigured={{}}
            derived={derived}
            onSubmit={vi.fn(async () => {})}
            pending={false}
            succeeded={false}
            submitLabel="Save"
            failureTitle="It could not be saved"
            failureMessage="Nothing was written."
        />,
    );

    return { user: setupUser() };
}

describe('a setting whose empty value is worked out', () => {
    it('puts what is in force behind the empty field, rather than a hint', () => {
        draw({ 'stream.publicUrl': '' }, { 'stream.publicUrl': 'https://radio.example' });

        expect(screen.getByLabelText('Public URL')).toHaveAttribute('placeholder', 'https://radio.example');
    });

    it('says so in words as well, which a placeholder does not', () => {
        // A placeholder reads as an example of what to type and is not reliably announced. The line
        // under the input is what makes it a statement about this station.
        draw({ 'stream.publicUrl': '' }, { 'stream.publicUrl': 'https://radio.example' });

        expect(screen.getByText('Using https://radio.example while this is empty.')).toBeInTheDocument();
    });

    it('keeps the field’s own help text, which the line is not a replacement for', () => {
        draw({ 'stream.publicUrl': '' }, { 'stream.publicUrl': 'https://radio.example' });

        expect(screen.getByText('Where listeners reach the station.')).toBeInTheDocument();
    });

    it('says nothing under a field the operator has filled in', () => {
        // Nothing is falling back, so a line saying what the fallback would be is describing a value
        // nothing reads.
        draw({ 'stream.publicUrl': 'https://listen.example' }, { 'stream.publicUrl': 'https://radio.example' });

        expect(screen.queryByText(/while this is empty/)).not.toBeInTheDocument();
    });

    it('answers to what is typed rather than to what is stored', async () => {
        // Clearing a field shows what clearing it will mean BEFORE the save, which is the whole
        // reason this reads the form and not the stored values.
        const { user } = draw({ 'stream.publicUrl': 'https://listen.example' }, { 'stream.publicUrl': 'https://radio.example' });

        await user.clear(screen.getByLabelText('Public URL'));

        expect(screen.getByText('Using https://radio.example while this is empty.')).toBeInTheDocument();
    });

    it('draws a hostname’s fallback the same way, whatever its type', () => {
        // `url` and `string` take different controls in this form and the same claim has to hold for
        // both: the advertised hostname is a plain string that derives from the public URL.
        draw({ 'stream.hostname': '' }, { 'stream.hostname': 'radio.example' });

        expect(screen.getByLabelText('Advertised hostname')).toHaveAttribute('placeholder', 'radio.example');
        expect(screen.getByText('Using radio.example while this is empty.')).toBeInTheDocument();
    });

    it('draws it on a field that offers suggestions too, which is a different control again', () => {
        // The timezone is free text WITH a list behind it (`optionsFrom`), so it is an Autocomplete
        // rather than a TextInput. Three of this form's controls can carry a derivation and each one
        // takes its placeholder from a different line.
        draw({ 'station.timezone': '' }, { 'station.timezone': 'America/New_York' });

        // By role rather than by label: an Autocomplete's own listbox is labelled by the same label,
        // so `getByLabelText` finds two elements and only one of them is the input.
        expect(screen.getByRole('combobox', { name: 'Station timezone' })).toHaveAttribute('placeholder', 'America/New_York');
        expect(screen.getByText('Using America/New_York while this is empty.')).toBeInTheDocument();
    });

    it('leaves a field with no derivation exactly as it was', () => {
        // Which is every field of a plugin's config form, since that page passes nothing: a `url`
        // keeps the generic hint and a `string` keeps its empty placeholder.
        draw({ 'stream.publicUrl': '', 'stream.hostname': '' });

        expect(screen.getByLabelText('Public URL')).toHaveAttribute('placeholder', 'https://');
        expect(screen.getByLabelText('Advertised hostname')).not.toHaveAttribute('placeholder');
        expect(screen.queryByText(/while this is empty/)).not.toBeInTheDocument();
    });
});
