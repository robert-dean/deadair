---
title: 'OutputDevice'
sidebar_position: 2
mdx:
    format: 'md'
---

> A speaker the station can play on, as an `output` plugin listed it

<details>
<summary>Attributes (8)</summary>

| Attribute  | Type            | Required | Description                                                                                             |
| ---------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `pluginId` | `string`        | Yes      | The plugin that drives it, for example `deadair.cast`                                                   |
| `deviceId` | `string`        | Yes      | The plugin's own id for the speaker. Stable across restarts                                             |
| `name`     | `string`        | Yes      | What the operator calls it                                                                              |
| `model`    | `string`        | No       | The make or model, where the speaker says                                                               |
| `address`  | `string`        | Yes      | How the plugin reaches it, for recognising rather than dialling                                         |
| `protocol` | `string`        | No       | How it is driven, for a plugin that speaks several: `chromecast`, `upnp`, `bluos`                       |
| `mounts`   | `OutputMount[]` | Yes      | The station's mounts this speaker can play, MP3 first. Empty when it plays none of the ones switched on |
| `casting`  | `boolean`       | Yes      | Whether the station is meant to be playing on it now. `/outputs/casts` says how that is going           |

</details>
