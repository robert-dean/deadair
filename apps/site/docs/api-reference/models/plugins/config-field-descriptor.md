---
title: 'ConfigFieldDescriptor'
sidebar_position: 8
mdx:
    format: 'md'
---

> Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code

<details>
<summary>Attributes (17)</summary>

| Attribute     | Type                          | Required | Description                                                                                                                                                                                                               |
| ------------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`         | `string`                      | Yes      |                                                                                                                                                                                                                           |
| `label`       | `string`                      | Yes      |                                                                                                                                                                                                                           |
| `type`        | `ConfigFieldType`             | Yes      |                                                                                                                                                                                                                           |
| `required`    | `boolean`                     | No       |                                                                                                                                                                                                                           |
| `default`     | `string \| number \| boolean` | No       |                                                                                                                                                                                                                           |
| `unit`        | `ConfigFieldUnit`             | No       | `number` only, and ignored elsewhere                                                                                                                                                                                      |
| `control`     | `ConfigFieldControl`          | No       | `slider` for a `number` with both `min` and `max`, `tags` for a `string` holding a comma-separated set                                                                                                                    |
| `step`        | `number`                      | No       | How coarsely a `control` moves, in the field's own unit. Ignored without one, and defaults to 1                                                                                                                           |
| `min`         | `number`                      | No       | `number` only: the smallest value that will be accepted, inclusive                                                                                                                                                        |
| `max`         | `number`                      | No       | `number` only: the largest value that will be accepted, inclusive                                                                                                                                                         |
| `placeholder` | `string`                      | No       |                                                                                                                                                                                                                           |
| `help`        | `string`                      | No       |                                                                                                                                                                                                                           |
| `options`     | `ConfigFieldOption[]`         | No       |                                                                                                                                                                                                                           |
| `optionsFrom` | `ConfigFieldOptionSource`     | No       | Choices only the console can enumerate. Merged where a plugin's own suggestions are, and outranked by them                                                                                                                |
| `columns`     | `ConfigFieldColumn[]`         | No       | `list` only, and ignored elsewhere                                                                                                                                                                                        |
| `dependsOn`   | `string`                      | No       | Key of the field this one is only relevant to                                                                                                                                                                             |
| `rangeWith`   | `string`                      | No       | Key of the `number` field that is the upper end of the range this one opens, declared on the lower end only. Still two settings, each validated by name; the console draws them as one control whose handles cannot cross |

</details>
