---
title: 'SegmentCreate'
sidebar_position: 2
mdx:
    format: 'md'
---

> Something for the station to say, before anything has said it

<details>
<summary>Attributes (4)</summary>

| Attribute | Type     | Required | Description                                                                      |
| --------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `label`   | `string` | Yes      | What the console calls it, and what the mount is labelled with while it airs     |
| `script`  | `string` | Yes      | The words to say                                                                 |
| `kind`    | `string` | No       | What sort of element it is. Defaults to `talkbreak`                              |
| `voice`   | `string` | No       | A station voice name the speech plugin knows how to map. Absent uses its default |

</details>
