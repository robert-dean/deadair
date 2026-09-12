---
title: 'VoiceList'
sidebar_position: 6
mdx:
    format: 'md'
---

> The voices the station's current speech plugin offers

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type       | Required | Description                                                                                                                                           |
| ------------ | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voices`     | `Voice[]`  | Yes      |                                                                                                                                                       |
| `pluginId`   | `string`   | No       | Which plugin answered. Absent when nothing can speak                                                                                                  |
| `reason`     | `string`   | No       | Why there are no voices, when there are none                                                                                                          |
| `deliveries` | `string[]` | No       | Which readings that plugin can perform right now, out of `hushed` and `frantic`. Absent or empty means none, which is most engines and is not a fault |

</details>
