---
title: 'Preview schedule import'
sidebar_label: 'Preview schedule import'
sidebar_position: 18
mdx:
    format: 'md'
---

Reads a file and reports what importing it would add, skip and leave out, and what would clash if turned on. Writes nothing

**`POST`** `/schedule/import/preview`

:::note
SDK method: `previewScheduleImport`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [SchedulePack](../models/schedule/schedule-pack.md) object.

## Response

`200 OK` — Returns a [PackImportPlan](../models/topics/pack-import-plan.md) object.
