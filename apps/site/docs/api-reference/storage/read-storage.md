---
title: 'Read storage'
sidebar_label: 'Read storage'
sidebar_position: 1
mdx:
    format: 'md'
---

What is on disk, per store, against what the database says should be

**`GET`** `/storage`

:::note
SDK method: `readStorage`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StorageReport](../models/storage/storage-report.md) object.
