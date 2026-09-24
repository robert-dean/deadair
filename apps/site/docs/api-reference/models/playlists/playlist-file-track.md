---
title: 'PlaylistFileTrack'
sidebar_position: 13
mdx:
    format: 'md'
---

> One record as a playlist file names it. By its words and its ISRC, never by an id of this station's:
> ids are minted afresh by every library, so a file keyed by them would restore onto nothing

<details>
<summary>Attributes (6)</summary>

| Attribute    | Type                 | Required | Description                   |
| ------------ | -------------------- | -------- | ----------------------------- |
| `title`      | `string`             | Yes      |                               |
| `artists`    | `string[]`           | Yes      | Ordered, primary artist first |
| `album`      | `string`             | No       |                               |
| `durationMs` | `number`             | No       |                               |
| `isrc`       | `string`             | No       |                               |
| `origin`     | `PlaylistFileOrigin` | No       |                               |

</details>
