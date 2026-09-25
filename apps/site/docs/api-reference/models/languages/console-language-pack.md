---
title: 'ConsoleLanguagePack'
sidebar_position: 1
mdx:
    format: 'md'
---

> A language pack: every word the console says, in one language, as the file a translator made. The same document is exported, imported and stored. The console's language only; what the station broadcasts in is the `stream.language` setting

<details>
<summary>Attributes (7)</summary>

| Attribute   | Type                         | Required | Description                                                                                                                         |
| ----------- | ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `format`    | `'deadair.console-language'` | Yes      | Says the file is a console language pack                                                                                            |
| `version`   | `number`                     | Yes      | The version of the document's shape. This station reads version 1                                                                   |
| `locale`    | `string`                     | Yes      | The language, as a BCP 47 tag such as `de` or `pt-BR`. Never English, which is built into the console                               |
| `name`      | `string`                     | Yes      | The language's name in itself, as the console's picker shows it: `Deutsch`, not `German`                                            |
| `direction` | `'ltr' \| 'rtl'`             | Yes      | Which way its text runs                                                                                                             |
| `madeFor`   | `string`                     | Yes      | The console version the pack was translated against. Empty when the file did not say                                                |
| `catalog`   | `Record<string, unknown>`    | Yes      | The strings, nested by namespace and then by key, in the English catalog's shape. Every value is text or a further level of nesting |

</details>
