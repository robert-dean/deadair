---
title: 'BreakArtwork'
sidebar_position: 1
mdx:
    format: 'md'
---

> The picture one KIND of break wears -- a weather forecast, a news bulletin -- as the console draws
> it.
>
> Only kinds the station actually holds bytes for are listed. A kind with no picture is a break
> wearing the station's logo on the mount and nothing in a listener's app, which is what every break
> did before this existed and is not a row worth drawing

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type                      | Required | Description                                                                                                                            |
| ------------ | ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`       | `string`                  | Yes      | `segments.kind`, which is what decides which break wears this: `weather`, `news`, or whatever an operator wrote on a format-clock band |
| `url`        | `string`                  | Yes      | Where the station serves it, as a path under the API root. The same shape and the same route a record's cover uses                     |
| `source`     | `'shipped' \| 'operator'` | Yes      | Whether these are the bytes this repository ships or ones somebody uploaded over them                                                  |
| `hasShipped` | `boolean`                 | Yes      | Whether this repository ships a picture for this kind, which is whether reverting has anywhere to go                                   |

</details>
