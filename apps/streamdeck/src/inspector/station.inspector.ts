import { NOW_PLAYING, optionsFrom, settingsFor } from '../actions/now.playing.options.js';
import type { StationSettings } from '../station/station.settings.js';
import { isToInspector, type ToInspector } from './inspector.messages.js';
import { inspectorMessages, keysPageFor, settingsFrom } from './inspector.protocol.js';

/**
 * The settings panel, which the Stream Deck app opens beside any deadair key and starts by calling
 * `connectElgatoStreamDeckSocket` with the port to talk back on.
 *
 * The same two settings whichever key it was opened from, because they are the plugin's global
 * settings. A field is saved when it is left rather than on every keystroke: the plugin rebuilds its
 * station on each save, and a key typed a character at a time would be fifty stations in a row.
 *
 * Opened on a Now Playing key, it also shows that key's own choices, saved to that key alone the
 * moment a box is ticked, which is Elgato's rule for a checkbox.
 */
declare global {
    interface Window {
        connectElgatoStreamDeckSocket?: (port: string, uuid: string, registerEvent: string, info: string, actionInfo: string) => void;
    }
}

function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (found === null) throw new Error(`The settings panel has no #${id}`);
    return found as T;
}

window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
    const opened = JSON.parse(actionInfo) as { action: string; payload?: { settings?: unknown } };
    const action = opened.action;
    const out = inspectorMessages(uuid, action);
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const send = (message: object): void => socket.send(JSON.stringify(message));

    const address = element<HTMLInputElement>('address');
    const apiKey = element<HTMLInputElement>('apiKey');
    const status = element<HTMLParagraphElement>('status');
    const test = element<HTMLButtonElement>('test');
    const keys = element<HTMLAnchorElement>('keys');
    const display = element<HTMLElement>('display');
    const stationHeading = element<HTMLElement>('stationHeading');
    const showTitle = element<HTMLInputElement>('showTitle');
    const showProgress = element<HTMLInputElement>('showProgress');

    const tick = (settings: unknown): void => {
        const options = optionsFrom(settings);
        showTitle.checked = options.title;
        showProgress.checked = options.progress;
    };
    const saveDisplay = (): void => {
        send(out.setSettings(settingsFor({ title: showTitle.checked, progress: showProgress.checked })));
    };
    if (action === NOW_PLAYING) {
        display.hidden = false;
        stationHeading.hidden = false;
        tick(opened.payload?.settings);
        showTitle.addEventListener('change', saveDisplay);
        showProgress.addEventListener('change', saveDisplay);
    }

    const show = (result: ToInspector | undefined): void => {
        status.textContent = result === undefined ? 'Checking…' : result.text;
        status.className = result === undefined ? 'status' : result.ok ? 'status ok' : 'status fault';
    };
    const refreshLink = (): void => {
        keys.hidden = keysPageFor(address.value) === undefined;
    };
    const fill = (settings: StationSettings): void => {
        // A field somebody is typing in is theirs: an echo of the last save must not overwrite it.
        if (document.activeElement !== address) address.value = settings.address ?? '';
        if (document.activeElement !== apiKey) apiKey.value = settings.apiKey ?? '';
        refreshLink();
    };
    const save = (): void => {
        send(out.setGlobalSettings(settingsFrom(address.value, apiKey.value)));
        show(undefined);
    };

    socket.addEventListener('open', () => {
        send(out.register(registerEvent));
        send(out.getGlobalSettings());
        send(out.testConnection());
        show(undefined);
    });
    socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data)) as { event?: string; payload?: { settings?: StationSettings } & Record<string, unknown> };
        if (message.event === 'didReceiveGlobalSettings') fill(message.payload?.settings ?? {});
        if (message.event === 'didReceiveSettings' && action === NOW_PLAYING) tick(message.payload?.settings);
        if (message.event === 'sendToPropertyInspector' && isToInspector(message.payload)) show(message.payload);
    });

    address.addEventListener('change', save);
    apiKey.addEventListener('change', save);
    address.addEventListener('input', refreshLink);
    test.addEventListener('click', () => {
        show(undefined);
        send(out.testConnection());
    });
    keys.addEventListener('click', event => {
        event.preventDefault();
        const url = keysPageFor(address.value);
        if (url !== undefined) send(out.openUrl(url));
    });
};
