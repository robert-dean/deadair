---
title: 'Get console language'
sidebar_label: 'Get console language'
sidebar_position: 2
mdx:
    format: 'md'
---

One language's pack, strings and all, as it was imported

**`GET`** `/console/languages/{locale}`

:::note
SDK method: `getConsoleLanguage`
Security: public
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `locale`  | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [ConsoleLanguagePack](../models/languages/console-language-pack.md) object.
