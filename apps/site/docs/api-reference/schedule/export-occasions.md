---
title: 'Export occasions'
sidebar_label: 'Export occasions'
sidebar_position: 4
mdx:
    format: 'md'
---

Every occasion on this station as one file, to hand to another station

**`GET`** `/occasions/export`

:::note
SDK method: `exportOccasions`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [OccasionPack](../models/schedule/occasion-pack.md) object.
