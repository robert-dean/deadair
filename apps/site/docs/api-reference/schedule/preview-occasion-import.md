---
title: 'Preview occasion import'
sidebar_label: 'Preview occasion import'
sidebar_position: 9
mdx:
    format: 'md'
---

Reads a file and reports what importing it would add, skip and leave out. Writes nothing

**`POST`** `/occasions/import/preview`

:::note
SDK method: `previewOccasionImport`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [OccasionPack](../models/schedule/occasion-pack.md) object.

## Response

`200 OK` — Returns a [OccasionImportPlan](../models/schedule/occasion-import-plan.md) object.
