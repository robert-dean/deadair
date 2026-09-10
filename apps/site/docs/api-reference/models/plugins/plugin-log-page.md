---
title: 'PluginLogPage'
sidebar_position: 12
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type               | Required | Description                                                                                                       |
| ---------- | ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `pluginId` | `string`           | Yes      |                                                                                                                   |
| `level`    | `PluginLogLevel`   | Yes      |                                                                                                                   |
| `entries`  | `PluginLogEntry[]` | Yes      | Newest first, as the activity feed and the script history send. The download is the file as written, oldest first |

</details>
