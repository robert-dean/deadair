---
title: 'Import occasions'
sidebar_label: 'Import occasions'
sidebar_position: 10
mdx:
    format: 'md'
---

Adds what is new in a file to the end of the list, switched off. Changes nothing the station already has

**`POST`** `/occasions/import`

:::note
SDK method: `importOccasions`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [OccasionPack](../models/schedule/occasion-pack.md) object.

## Response

`200 OK` — Returns a [OccasionImportResult](../models/schedule/occasion-import-result.md) object.
