/**
 * A persona's name, as the key it would be given.
 *
 * The key is a slug the operator has to invent, and on a new character it is one more decision in
 * front of a sheet that already asks for nineteen. So the editor derives one from the name until
 * somebody writes their own, and this is the derivation.
 *
 * Deliberately narrow: lowercased, and every run of anything that is not a letter or a digit becomes
 * one hyphen, with none left at either end. That DROPS accents and non-Latin scripts rather than
 * folding them, which is the right trade for a slug somebody has to be able to type back — and it is
 * only ever a suggestion, so a name that comes out empty leaves an empty field the editor's own
 * validation already refuses. It never touches an existing character's key: that is what
 * `script_history` stamps, so moving it under a rename would detach a character from everything it
 * has said.
 */
export const personaKeyFor = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
