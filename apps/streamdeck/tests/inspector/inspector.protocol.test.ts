import { describe, expect, it } from 'vitest';

import { isToInspector, isToPlugin } from '../../src/inspector/inspector.messages.js';
import { inspectorMessages, keysPageFor, settingsFrom } from '../../src/inspector/inspector.protocol.js';

describe('inspectorMessages', () => {
    const out = inspectorMessages('pi-uuid', 'radio.deadair.streamdeck.skip');

    it('registers, and reads and writes the plugin’s global settings under its own id', () => {
        expect(out.register('registerPropertyInspector')).toEqual({ event: 'registerPropertyInspector', uuid: 'pi-uuid' });
        expect(out.getGlobalSettings()).toEqual({ event: 'getGlobalSettings', context: 'pi-uuid' });
        expect(out.setGlobalSettings({ address: 'a' })).toEqual({ event: 'setGlobalSettings', context: 'pi-uuid', payload: { address: 'a' } });
    });

    it('writes the one key’s own settings under its id, beside the global ones', () => {
        expect(out.setSettings({ showProgress: false, showTitle: true })).toEqual({
            event: 'setSettings',
            context: 'pi-uuid',
            payload: { showProgress: false, showTitle: true },
        });
    });

    it('asks the plugin for a check as the action it was opened on', () => {
        const message = out.testConnection();
        expect(message).toEqual({
            event: 'sendToPlugin',
            action: 'radio.deadair.streamdeck.skip',
            context: 'pi-uuid',
            payload: { event: 'testConnection' },
        });
        expect(isToPlugin(message.payload)).toBe(true);
    });
});

describe('settingsFrom', () => {
    it('keeps what was typed, trimmed, and leaves out what was not', () => {
        expect(settingsFrom(' radio.example.com ', ' da_key ')).toEqual({ address: 'radio.example.com', apiKey: 'da_key' });
        expect(settingsFrom('', '  ')).toEqual({});
    });
});

describe('keysPageFor', () => {
    it('is the console’s security settings, once the address reads', () => {
        expect(keysPageFor('radio.example.com/api')).toBe('https://radio.example.com/settings/security');
        expect(keysPageFor('')).toBeUndefined();
    });
});

describe('the messages back', () => {
    it('are recognised only in their own shape', () => {
        expect(isToInspector({ event: 'connection', ok: true, text: 'Connected.' })).toBe(true);
        expect(isToInspector({ event: 'connection', ok: 'yes', text: 'Connected.' })).toBe(false);
        expect(isToInspector(null)).toBe(false);
        expect(isToPlugin({ event: 'somethingElse' })).toBe(false);
    });
});
