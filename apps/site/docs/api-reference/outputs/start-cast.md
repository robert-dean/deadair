---
title: 'Start cast'
sidebar_label: 'Start cast'
sidebar_position: 3
mdx:
    format: 'md'
---

Play the station on a speaker, replacing whatever it was playing. The station keeps it playing, through a dropped stream or a restart, until it is stopped here or somebody plays something else on it

**`POST`** `/outputs/casts`

:::note
SDK method: `startCast`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [OutputCastRequest](../models/outputs/output-cast-request.md) object.

## Response

`201 Created` — Returns a [OutputCast](../models/outputs/output-cast.md) object.
