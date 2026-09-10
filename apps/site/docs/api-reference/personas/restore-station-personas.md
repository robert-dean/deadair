---
title: 'Restore station personas'
sidebar_label: 'Restore station personas'
sidebar_position: 8
mdx:
    format: 'md'
---

Writes back whichever of the station's own personas this station is missing, touching nothing it already has and putting nothing on air

**`POST`** `/personas/restore`

:::note
SDK method: `restoreStationPersonas`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [PersonaList](../models/personas/persona-list.md) object.
