---
title: 'RecordingList'
sidebar_position: 3
mdx:
    format: 'md'
---

> Every recording, newest first, and whether the station is recording at all.

<details>
<summary>Attributes (3)</summary>

| Attribute       | Type                       | Required | Description                                                                |
| --------------- | -------------------------- | -------- | -------------------------------------------------------------------------- |
| `mode`          | `'off' \| 'live' \| 'all'` | Yes      | What the archive is set to keep. _read-only_                               |
| `retentionDays` | `number`                   | Yes      | How long a finished recording is kept. Zero keeps all of them. _read-only_ |
| `recordings`    | `Recording[]`              | Yes      |                                                                            |

</details>
