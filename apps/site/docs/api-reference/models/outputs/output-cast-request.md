---
title: 'OutputCastRequest'
sidebar_position: 7
mdx:
    format: 'md'
---

> Play the station on a speaker

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type     | Required | Description                                                                                                  |
| ----------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `pluginId`  | `string` | Yes      |                                                                                                              |
| `deviceId`  | `string` | Yes      |                                                                                                              |
| `mountPath` | `string` | No       | Which mount, from the speaker's `mounts`. Absent means its first, which is MP3 wherever the speaker takes it |

</details>
