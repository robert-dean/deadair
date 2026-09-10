---
title: 'PadScanResult'
sidebar_position: 34
mdx:
    format: 'md'
---

> What one pass over the pad library did

<details>
<summary>Attributes (5)</summary>

| Attribute   | Type     | Required | Description                                                                                                                                                    |
| ----------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scanned`   | `number` | Yes      | Audio files seen, whether or not anything changed                                                                                                              |
| `imported`  | `number` | Yes      | Sounds the station did not have before                                                                                                                         |
| `replaced`  | `number` | Yes      | Slots whose file changed under them, which every script naming them now plays                                                                                  |
| `contested` | `number` | Yes      | Sounds that reached the library but not their set, because it already answered to their name. In the library and unreachable until somebody says where they go |
| `skipped`   | `number` | Yes      | Files passed over: not audio, unreadable, or named something no script could write                                                                             |

</details>
