---
title: 'Import clock'
sidebar_label: 'Import clock'
sidebar_position: 11
mdx:
    format: 'md'
---

Adds the bands in a file after this station's own, switched off, with any subject they need. Changes nothing the station already has

**`POST`** `/clock/import`

:::note
SDK method: `importClock`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [ClockPack](../models/director/clock-pack.md) object.

## Response

`200 OK` — Returns a [ClockImportResult](../models/director/clock-import-result.md) object.
