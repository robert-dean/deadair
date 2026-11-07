---
title: 'SegmentScope'
sidebar_position: 2
mdx:
    format: 'md'
---

> Which shows and presenters a recording is for. Both empty is every show

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type       | Required | Description                                                                               |
| ------------ | ---------- | -------- | ----------------------------------------------------------------------------------------- |
| `slotIds`    | `string[]` | Yes      | Schedule slot ids: the recording airs while one of these shows is on, whoever presents it |
| `personaIds` | `string[]` | Yes      | Persona ids: the recording airs while one of these presenters is on, whichever show it is |

</details>
