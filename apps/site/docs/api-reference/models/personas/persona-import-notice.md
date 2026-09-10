---
title: 'PersonaImportNotice'
sidebar_position: 23
mdx:
    format: 'md'
---

> Something to know before pressing Import. Not a refusal: every one of these describes a state the
> station can be in perfectly well, and the point of saying it is that each one is otherwise
> discovered by putting the character on air

<details>
<summary>Attributes (2)</summary>

| Attribute | Type                                                                                                    | Required | Description                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `kind`    | `'format' \| 'duplicate' \| 'on-air' \| 'clears' \| 'voice' \| 'soundboard' \| 'phrasing' \| 'markers'` | Yes      | Which sort, so a console can group or ignore by it rather than parsing the sentence. _read-only_ |
| `message` | `string`                                                                                                | Yes      | The whole of it, in the station's own words, because its destination is a person. _read-only_    |

</details>
