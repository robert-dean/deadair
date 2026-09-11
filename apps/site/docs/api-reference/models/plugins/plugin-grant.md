---
title: 'PluginGrant'
sidebar_position: 19
mdx:
    format: 'md'
---

> One capability a plugin asked for, with the station's answer. The ask is the plugin's manifest and
> the answer is a row, so a plugin that stops asking stops appearing here whatever was stored

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type            | Required | Description                                             |
| ------------ | --------------- | -------- | ------------------------------------------------------- |
| `pluginId`   | `string`        | Yes      |                                                         |
| `pluginName` | `string`        | Yes      |                                                         |
| `capability` | `string`        | Yes      | The host's own id for it, e.g. `network.open`           |
| `label`      | `string`        | Yes      | What the host calls the capability                      |
| `describes`  | `string`        | Yes      | What allowing it opens up, in the station's words       |
| `reason`     | `string`        | Yes      | Why this plugin says it needs it, in the plugin's words |
| `decision`   | `GrantDecision` | Yes      |                                                         |

</details>
