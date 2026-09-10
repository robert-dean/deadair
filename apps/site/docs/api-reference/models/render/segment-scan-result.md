---
title: 'SegmentScanResult'
sidebar_position: 20
mdx:
    format: 'md'
---

> What one pass over the inbox did

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type     | Required | Description                                              |
| ---------- | -------- | -------- | -------------------------------------------------------- |
| `scanned`  | `number` | Yes      | Audio files seen, whether or not they were already known |
| `imported` | `number` | Yes      | Segments the station did not have before this pass       |
| `skipped`  | `number` | Yes      | Files passed over: not audio it can serve, or unreadable |

</details>
