---
title: 'Scan the segment inbox'
sidebar_label: 'Scan the segment inbox'
sidebar_position: 4
mdx:
    format: 'md'
---

Takes whatever audio is sitting in the inbox directory into the library. Safe to repeat: a segment is identified by its audio, so the same recording arriving twice is one segment

**`POST`** `/segments/scan`

:::note
SDK method: `scanTheSegmentInbox`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [SegmentScanResult](../models/render/segment-scan-result.md) object.
