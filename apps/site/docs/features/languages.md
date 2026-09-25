---
title: Languages
sidebar_position: 11.5
description: Showing the console in a language other than English, importing a language pack, and translating one.
---

The console is written in English, and it can be shown in any other language somebody has translated it into. A translation is a **language pack**: one file holding every word the console says, in one language. An admin imports a pack once, and from then on everybody on the station can choose it for themselves.

This is the console's language and nothing else. What the station **broadcasts** in, the language the presenters write and speak, is the Language setting under **Settings, Stream**, and the two are unrelated: a German station can have an English console, and the other way round. Two things stay in English whatever you choose: the help text under each setting, and the messages the station itself sends back when something is refused. Both come from the station rather than from the console.

## Choosing your language

**Settings, Languages, Show the console in.** The list holds English, which is built in, and every language the station has a pack for, each named in itself: Deutsch, not German.

Your choice is kept with your account, so it follows you to every browser you sign in from, and nobody else's console changes. The browser also remembers it, so the sign-in page is in your language before you have signed in.

**As this browser prefers** is what you have until you choose. The console then takes the first language in your browser's own list that the station can show, English included, and English when there is none. Choosing it again after choosing a language goes back to that.

Where a pack has not translated something, that one string shows in English and the rest stays in your language. Months and days in the date pickers and on the timetable follow the language, and for a language written right to left, such as Arabic or Hebrew, the whole layout turns round.

## Importing a language pack

Only an admin can import or remove a language. Anybody else can open the same card and is refused by the station if they try.

**Settings, Languages, Import a language pack**, then choose the file. Nothing is installed until you have seen what this console makes of it:

- how many of the console's strings it translates, as a count and a percentage
- which strings it leaves out and why, when a translation lost a placeholder or its markup. Those show in English.
- which strings are for parts of the console this version does not have, which are dropped
- whether it replaces a pack already installed for the same language, and whether it was made for a different version of the console

None of that stops the install. Only a file whose header is wrong cannot get past: one that is not a language pack, one made for a newer console, one that does not say which language it is or what it is called, and one for English. A half-finished translation is half a console in your language and half in English. Importing a language again replaces its pack, and each installed language can be exported back out, or removed. Removing one puts everybody who had chosen it back on their browser's preference.

The percentage beside each installed language is worked out by the console you are looking at, so it drops after an upgrade that adds new strings, until the pack catches up.

## Translating the console

Start from the English. **Settings, Languages, Export as a language pack** downloads it as `deadair-console-en.json`, and every [release on GitHub](https://github.com/robert-dean/deadair/releases) carries the same file, so you can start without running a station.

The file opens with a short header, then the strings:

```json
{
    "format": "deadair.console-language",
    "version": 1,
    "locale": "de",
    "name": "Deutsch",
    "direction": "ltr",
    "madeFor": "0.35.0",
    "catalog": {
        "common": {
            "action": { "cancel": "Abbrechen" }
        }
    }
}
```

- **`locale`** is your language's tag, such as `de`, `fr` or `pt-BR`. It cannot be English.
- **`name`** is your language's name in itself, as the picker will show it.
- **`direction`** is `ltr`, or `rtl` for a language written right to left.
- **`madeFor`** is the console version you translated. Leave it as the export wrote it, so a station on a later version can say what changed since.
- **`format`** and **`version`** stay as they are.

Then translate the text inside `catalog`, and nothing else. A few rules keep a string from being left out:

- **Leave the keys alone.** Only the text on the right changes. A key the console does not know is dropped.
- **Keep every `{{placeholder}}`**, in whatever place your grammar needs, and add none. `{{count}}` is the one you may spell out, in a singular form ("a day" rather than "1 day").
- **Keep the tags.** Text such as `<strong>{{host}}</strong>` or `<code/>` marks where a link, a bold word or a piece of code goes. Keep the same tags, around the words that belong in them in your language.
- **Plurals take your language's forms.** A key ending in `_one` and `_other` is a plural. Write the forms your language uses (`_zero`, `_one`, `_two`, `_few`, `_many`, `_other`, from the [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)), and delete the ones it does not. Japanese needs only `_other`; Polish needs `_one`, `_few`, `_many` and `_other`.
- **Leave out what you have not translated.** A missing string shows in English. Delete it rather than copying the English in, so the station counts it as untranslated and the preview says so.

Import the file on a station to check it. The preview lists anything it had to leave out, with the reason, and the station keeps your strings exactly as you wrote them, so exporting the language again gives you back your own work.

### After an upgrade

A new version of the console may add strings, and those show in English until the pack has them. The percentage beside the language drops to say so. Compare with the English exported from the new version, add the new strings to your pack, set `madeFor` to the new version and import it again.

### Sharing a pack

A pack is a plain file that works on any station. To share it with everybody, [submit it to the community catalogue](https://github.com/robert-dean/deadair-community/issues/new?template=add-language.yml), which asks for an address it can download the file from, since a pack is too big to paste into a form. Shared languages are listed under [Community, Languages](/community/languages), one per language, and each downloads as a file your console imports as it stands.
