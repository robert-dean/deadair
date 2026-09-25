---
title: 'Import console language'
sidebar_label: 'Import console language'
sidebar_position: 5
mdx:
    format: 'md'
---

Installs a language pack, replacing any pack already installed for the language. The tag in the path must be the pack's own

**`PUT`** `/console/languages/{locale}`

:::note
SDK method: `importConsoleLanguage`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `locale`  | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [ConsoleLanguagePack](../models/languages/console-language-pack.md) object.

## Response

`200 OK` — Returns a [ConsoleLanguageList](../models/languages/console-language-list.md) object.
