---
title: 'Preview break kind import'
sidebar_label: 'Preview break kind import'
sidebar_position: 7
mdx:
    format: 'md'
---

Reads a file and reports what importing it would create, rewrite, skip and refuse. Writes nothing

**`POST`** `/breaks/kinds/import/preview`

:::note
SDK method: `previewBreakKindImport`
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

`200 OK` — Returns a [BreakKindImportPlan](../models/director/break-kind-import-plan.md) object.
