---
title: 'BreakArtworkUpload'
sidebar_position: 3
mdx:
    format: 'md'
---

> A picture arriving from the browser, as multipart form parts.
>
> Documentation rather than validation: a multipart body reaches the service as the raw parser and
> the generated client types the body as `FormData`, so nothing checks this shape. It says what to
> send

<details>
<summary>Attributes (1)</summary>

| Attribute | Type   | Required | Description                                                                                                                   |
| --------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `file`    | `Blob` | Yes      | The image itself. jpeg, png, webp or gif, decided by its BYTES rather than by its name or its declared type, and at most 4 MB |

</details>
