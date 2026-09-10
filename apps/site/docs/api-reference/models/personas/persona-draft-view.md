---
title: 'PersonaDraftView'
sidebar_position: 4
mdx:
    format: 'md'
---

> A persona as a form's contents rather than a row: no id and not on air, because nothing has been
> saved. The console opens this in the editor and the operator saves it through POST /personas, which
> is what keeps generating a way of filling in the form rather than a second writer of the table

<details>
<summary>Attributes (19)</summary>

| Attribute        | Type                                                                | Required | Description |
| ---------------- | ------------------------------------------------------------------- | -------- | ----------- |
| `key`            | `string`                                                            | Yes      |             |
| `label`          | `string`                                                            | Yes      |             |
| `style`          | `string`                                                            | Yes      |             |
| `djName`         | `string`                                                            | No       |             |
| `voice`          | `string`                                                            | No       |             |
| `soundboard`     | `string`                                                            | No       |             |
| `diction`        | `string[]`                                                          | No       |             |
| `dictionMarkers` | `string[]`                                                          | No       |             |
| `quirks`         | `string[]`                                                          | No       |             |
| `preoccupations` | `string[]`                                                          | No       |             |
| `catchphrases`   | `string[]`                                                          | No       |             |
| `avoid`          | `string[]`                                                          | No       |             |
| `background`     | `string`                                                            | No       |             |
| `brevity`        | `'short' \| 'one-line'`                                             | No       |             |
| `latitude`       | `'loose' \| 'unleashed'`                                            | No       |             |
| `chattiness`     | `'reserved' \| 'sparing' \| 'ordinary' \| 'chatty' \| 'relentless'` | No       |             |
| `storytelling`   | `'never' \| 'occasionally' \| 'often'`                              | No       |             |
| `samples`        | `string[]`                                                          | No       |             |
| `templates`      | `string`                                                            | No       |             |

</details>
