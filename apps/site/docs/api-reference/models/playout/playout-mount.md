---
title: 'PlayoutMount'
sidebar_position: 10
mdx:
    format: 'md'
---

> One mount the station is publishing right now

<details>
<summary>Attributes (3)</summary>

| Attribute     | Type                                 | Required | Description                                                      |
| ------------- | ------------------------------------ | -------- | ---------------------------------------------------------------- |
| `format`      | `'mp3' \| 'opus' \| 'aac' \| 'flac'` | Yes      |                                                                  |
| `path`        | `string`                             | Yes      | Same-origin path, on the same terms as `PlayoutStatus.mountPath` |
| `bitrateKbps` | `number`                             | No       | Absent for FLAC, which is lossless and has no rate to set        |

</details>
