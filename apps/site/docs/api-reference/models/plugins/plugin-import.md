---
title: 'PluginImport'
sidebar_position: 11
mdx:
    format: 'md'
---

> A plugin handed over from the browser. The generated client types the body as `FormData`, so
> nothing checks this shape. It says what to send

<details>
<summary>Attributes (1)</summary>

| Attribute | Type   | Required | Description                                                                                                          |
| --------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `file`    | `Blob` | Yes      | The gzip tarball npm pack writes: every entry under package/, holding package.json and the built code, at most 64 MB |

</details>
