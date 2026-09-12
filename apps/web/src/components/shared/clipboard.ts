/**
 * Putting a piece of text on the operator's clipboard, on a console that is usually not in a secure
 * context.
 *
 * `navigator.clipboard` is the API every browser recommends, and the browser only defines it on HTTPS
 * or on localhost. A station on a home network is opened at `http://<the server's address>:8080`,
 * which is neither, so there it is simply absent. Mantine's `CopyButton` checks for it and, finding
 * nothing, records an error and copies nothing, and it tells nobody: the button stays "Copy" and the
 * clipboard keeps whatever it held before. Five buttons on this console did that on exactly the
 * stations most likely to need them (issue #78).
 *
 * The fallback is the old one: put the text in a textarea, select it, and ask the browser to copy the
 * selection with `document.execCommand('copy')`. It is deprecated and has no replacement for this
 * case, and every current browser still honours it on a plain-HTTP page in response to a click. It is
 * tried when the modern API is missing AND when it refuses, because a present `navigator.clipboard`
 * can still reject: Chrome refuses a write from a document that does not have focus, and a browser may
 * decline the permission outright.
 */

/**
 * Copy `value`, and answer whether anything was copied.
 *
 * `false` means both paths failed and the clipboard is untouched; the caller has to say so, because
 * nothing else will.
 *
 * When `navigator.clipboard` is absent the fallback runs synchronously, before the first `await`,
 * which matters: `execCommand('copy')` is only allowed inside the user's click, and a copy deferred to
 * a later task can be refused for arriving too late.
 */
export async function copyText(value: string): Promise<boolean> {
    // Typed as always present by the DOM library, which describes a secure context. It is not always
    // present, and that is the whole reason this file exists.
    const clipboard = navigator.clipboard as Clipboard | undefined;

    if (clipboard?.writeText) {
        try {
            await clipboard.writeText(value);
            return true;
        } catch {
            // Refused rather than missing. The older path asks no permission, so it can still work.
        }
    }

    return copyThroughSelection(value);
}

/**
 * The `execCommand` path: a textarea nobody sees, selected and copied, then removed.
 *
 * Appended to the body rather than beside the button. Mantine's focus trap, which the enrolment modal
 * and the plugin OAuth modal both run under, only intercepts Tab, so a textarea outside the modal can
 * be focused and selected without the trap pulling focus back mid-copy. Focus is handed back to
 * whatever held it, which is the button that was clicked: without that, a keyboard user lands on the
 * document body after every copy and a modal loses its place.
 *
 * `readonly` so a phone does not open its keyboard for the instant the textarea is focused, and
 * `setSelectionRange` alongside `select` because iOS Safari ignores the latter on a readonly field.
 */
function copyThroughSelection(value: string): boolean {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    Object.assign(textarea.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none', fontSize: '12pt' });
    document.body.appendChild(textarea);

    try {
        textarea.focus({ preventScroll: true });
        textarea.select();
        textarea.setSelectionRange(0, value.length);
        return document.execCommand('copy');
    } catch {
        // Some browsers throw rather than answering false, and one without `execCommand` at all
        // throws a TypeError. Both mean the same thing to the operator.
        return false;
    } finally {
        textarea.remove();
        previouslyFocused?.focus({ preventScroll: true });
    }
}
