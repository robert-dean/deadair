---
title: 'Import personas'
sidebar_label: 'Import personas'
sidebar_position: 12
mdx:
    format: 'md'
---

Writes a file into this station: creates what is new, rewrites only the characters named in `replace`, and answers with what it did

**`POST`** `/personas/import`

:::note
SDK method: `importPersonas`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type       | Required | Description |
| --------- | ---------- | -------- | ----------- |
| `replace` | `string[]` | No       |             |

</details>

## Request body (`application/json`)

Accepts a [PersonaFile](../models/personas/persona-file.md) object.

## Response

`200 OK` — Returns a [PersonaImportResult](../models/personas/persona-import-result.md) object.
