---
title: 'PlayoutPlaylistInput'
sidebar_position: 1
mdx:
    format: 'md'
---

> The plugin playlist to load into the running order

<details>
<summary>Attributes (3)</summary>

| Attribute      | Type      | Required | Description                                                                                                                                                                                                                                         |
| -------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`     | `string`  | Yes      |                                                                                                                                                                                                                                                     |
| `playlistId`   | `string`  | Yes      |                                                                                                                                                                                                                                                     |
| `mixInSimilar` | `boolean` | No       | Whether records that sound like the ones on this playlist are mixed in among them, one every `rotation.mixInEvery` records. The playlist still plays in full and in its own order around them. Absent takes the station's own setting, which is off |

</details>
