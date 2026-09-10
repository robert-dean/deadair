---
title: 'PadFetch'
sidebar_position: 28
mdx:
    format: 'md'
---

> A sound the station is being told to go and get.
>
> The operator names the address, so this is them choosing a file exactly as dropping one in the
> library is. Nothing inspects what comes back and nothing records a claim about its licence -- see
> `docs/internals/render.md` under "Pads", whose line is redistribution rather than use

<details>
<summary>Attributes (4)</summary>

| Attribute | Type     | Required | Description                                                                                                   |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `url`     | `string` | Yes      | Where the audio is. Followed once, bounded, and refused unless what comes back is a format the station serves |
| `board`   | `string` | Yes      | The directory it is filed under, which is also the set it joins                                               |
| `name`    | `string` | No       | What a script will write. Derived from the address when absent                                                |
| `label`   | `string` | No       |                                                                                                               |

</details>
