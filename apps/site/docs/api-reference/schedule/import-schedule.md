---
title: 'Import schedule'
sidebar_label: 'Import schedule'
sidebar_position: 20
mdx:
    format: 'md'
---

Adds what is new in a file, switched off, so nothing airs until an operator turns it on. Changes nothing the station already has

**`POST`** `/schedule/import`

:::note
SDK method: `importSchedule`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [SchedulePack](../models/schedule/schedule-pack.md) object.

## Response

`200 OK` — Returns a [ScheduleImportResult](../models/schedule/schedule-import-result.md) object.
