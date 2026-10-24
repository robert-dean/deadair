---
title: 'Import break kinds'
sidebar_label: 'Import break kinds'
sidebar_position: 8
mdx:
    format: 'md'
---

Writes a file into this station and answers with what it did. Every kind it writes arrives switched off

**`POST`** `/breaks/kinds/import`

:::note
SDK method: `importBreakKinds`
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

Accepts a [BreakKindFile](../models/director/break-kind-file.md) object.

## Response

`200 OK` — Returns a [BreakKindImportResult](../models/director/break-kind-import-result.md) object.
