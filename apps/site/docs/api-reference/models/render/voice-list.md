---
title: 'VoiceList'
sidebar_position: 6
mdx:
    format: 'md'
---

> The voices the station's current speech plugin offers

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type      | Required | Description                                          |
| ---------- | --------- | -------- | ---------------------------------------------------- |
| `voices`   | `Voice[]` | Yes      |                                                      |
| `pluginId` | `string`  | No       | Which plugin answered. Absent when nothing can speak |
| `reason`   | `string`  | No       | Why there are no voices, when there are none         |

</details>
