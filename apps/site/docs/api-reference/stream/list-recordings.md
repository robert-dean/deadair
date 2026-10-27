---
title: 'List recordings'
sidebar_label: 'List recordings'
sidebar_position: 1
mdx:
    format: 'md'
---

Every recording in the archive, newest first

**`GET`** `/archive/recordings`

:::note
SDK method: `listRecordings`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [RecordingList](../models/stream/recording-list.md) object.
