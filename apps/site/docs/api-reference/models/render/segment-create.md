---
title: 'SegmentCreate'
sidebar_position: 2
mdx:
    format: 'md'
---

> Something for the station to say, before anything has said it

<details>
<summary>Attributes (5)</summary>

| Attribute  | Type     | Required | Description                                                                                                                                                                 |
| ---------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`    | `string` | Yes      | What the console calls it, and what the mount is labelled with while it airs                                                                                                |
| `script`   | `string` | Yes      | The words to say                                                                                                                                                            |
| `kind`     | `string` | No       | What sort of element it is. Defaults to `talkbreak`                                                                                                                         |
| `voice`    | `string` | No       | A station voice name the speech plugin knows how to map. Absent uses its default                                                                                            |
| `delivery` | `string` | No       | How to read the words: `hushed` or `frantic`, and refused otherwise. Absent is the voice's own ordinary reading. Dropped at render time by an engine that cannot perform it |

</details>
