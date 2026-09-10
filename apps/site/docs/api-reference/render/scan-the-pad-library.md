---
title: 'Scan the pad library'
sidebar_label: 'Scan the pad library'
sidebar_position: 22
mdx:
    format: 'md'
---

Takes whatever audio is sitting in the pad library directory onto its board. Safe to repeat: a file nobody has touched is seen and left alone

**`POST`** `/pads/scan`

:::note
SDK method: `scanThePadLibrary`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [PadScanResult](../models/render/pad-scan-result.md) object.
