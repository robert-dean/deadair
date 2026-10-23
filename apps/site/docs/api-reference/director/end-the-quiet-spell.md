---
title: 'End the quiet spell'
sidebar_label: 'End the quiet spell'
sidebar_position: 17
mdx:
    format: 'md'
---

Ends a quiet spell now, so the station talks again at its next break. A station that is not quiet is unchanged rather than refused

**`DELETE`** `/director/air/quiet`

:::note
SDK method: `endTheQuietSpell`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [StationAir](../models/director/station-air.md) object.
