---
title: 'PadUpload'
sidebar_position: 27
mdx:
    format: 'md'
---

> A sound arriving from the browser, as multipart form parts.
>
> Documentation rather than validation: a multipart body reaches the service as the raw parser and
> the generated client types the body as `FormData`, so nothing checks this shape. It says what to
> send

<details>
<summary>Attributes (4)</summary>

| Attribute | Type     | Required | Description                                                                                                  |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `file`    | `Blob`   | Yes      | The audio itself. mp3, wav, ogg, flac or m4a, and at most 25 MB                                              |
| `board`   | `string` | Yes      | The directory it is filed under, which is also the set it joins. A new name makes both                       |
| `name`    | `string` | No       | What a script will write. Derived from the filename when absent, and the FILE is named after this either way |
| `label`   | `string` | No       | What the console calls it. Derived from the filename when absent                                             |

</details>
