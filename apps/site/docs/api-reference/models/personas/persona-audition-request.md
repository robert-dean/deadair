---
title: 'PersonaAuditionRequest'
sidebar_position: 26
mdx:
    format: 'md'
---

> What an operator asks for when they put a character through a playlist. The playlist is READ at the
> moment of asking and its records are stored on the run, so a list edited at the provider afterwards
> does not change what was measured

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type     | Required | Description                                                                                                                                                   |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`   | `string` | Yes      | Which catalog plugin the playlist belongs to                                                                                                                  |
| `playlistId` | `string` | Yes      |                                                                                                                                                               |
| `name`       | `string` | No       | What the playlist is called, kept as a caption for the run. The console already holds it, and a run whose playlist is later renamed or deleted stays readable |
| `limit`      | `number` | Yes      | How many breaks to write. One more record than this is taken off the playlist, since a break sits between two. _default: `10`_                                |

</details>
