---
title: 'SegmentUpload'
sidebar_position: 3
mdx:
    format: 'md'
---

> A recording arriving from the browser, as multipart form parts.
>
> Documentation rather than validation: a multipart body reaches the service as the raw parser and
> the generated client types the body as `FormData`, so nothing checks this shape. It says what to
> send

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                                                     |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`    | `Blob`   | Yes      | The audio itself. mp3, wav, ogg, flac or m4a, and at most 50 MB                                                                                 |
| `kind`    | `string` | Yes      | What sort of element it is, which is also the directory it is filed under. A kind nothing else uses becomes a bookable band on the format clock |
| `label`   | `string` | No       | What the console calls it, and what the mount is labelled with while it airs. Derived from the filename when absent                             |

</details>
