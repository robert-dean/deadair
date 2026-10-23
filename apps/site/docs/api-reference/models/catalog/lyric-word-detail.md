---
title: 'LyricWordDetail'
sidebar_position: 13
mdx:
    format: 'md'
---

> One timed piece of a lyric line: a word, or a syllable, and when it starts being sung. Milliseconds
> from the start of the file, as the line's own start is.

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                     |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------- |
| `atMs`    | `number` | Yes      | Where this piece starts being sung. _read-only_                                                 |
| `text`    | `string` | Yes      | The piece, with any space after it, so a line's pieces joined are its text exactly. _read-only_ |

</details>
