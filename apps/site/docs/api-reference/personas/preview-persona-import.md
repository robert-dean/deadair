---
title: 'Preview persona import'
sidebar_label: 'Preview persona import'
sidebar_position: 11
mdx:
    format: 'md'
---

Reads a file and reports what importing it would create, rewrite and skip. Writes nothing

**`POST`** `/personas/import/preview`

:::note
SDK method: `previewPersonaImport`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PersonaFile](../models/personas/persona-file.md) object.

## Response

`200 OK` — Returns a [PersonaImportPlan](../models/personas/persona-import-plan.md) object.
