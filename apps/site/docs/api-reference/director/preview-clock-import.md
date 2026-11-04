---
title: 'Preview clock import'
sidebar_label: 'Preview clock import'
sidebar_position: 10
mdx:
    format: 'md'
---

Reads a file and reports what importing it would add, skip and leave out. Writes nothing

**`POST`** `/clock/import/preview`

:::note
SDK method: `previewClockImport`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [ClockPack](../models/director/clock-pack.md) object.

## Response

`200 OK` — Returns a [PackImportPlan](../models/topics/pack-import-plan.md) object.
