---
title: 'Remove console language'
sidebar_label: 'Remove console language'
sidebar_position: 4
mdx:
    format: 'md'
---

Removes a language. Anybody who had chosen it sees English

**`DELETE`** `/console/languages/{locale}`

:::note
SDK method: `removeConsoleLanguage`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `locale`  | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [ConsoleLanguageList](../models/languages/console-language-list.md) object.
