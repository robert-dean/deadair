---
title: 'SigninProvidersCheck'
sidebar_position: 6
mdx:
    format: 'md'
---

> Every identity provider row the station could read, and the ones it could not use at all

<details>
<summary>Attributes (2)</summary>

| Attribute   | Type                    | Required | Description                                                                                                                               |
| ----------- | ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `providers` | `SigninProviderCheck[]` | Yes      | In the order the rows are listed                                                                                                          |
| `unusable`  | `string[]`              | Yes      | One sentence per row the station drops before asking anybody: a missing cell, a name that is not a slug, an issuer that is not an address |

</details>
