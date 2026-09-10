---
title: 'StationSettings'
sidebar_position: 3
mdx:
    format: 'md'
---

> Every station setting, with what it is currently worth

<details>
<summary>Attributes (3)</summary>

| Attribute     | Type                         | Required | Description                                                                                 |
| ------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `descriptors` | `StationSettingDescriptor[]` | Yes      |                                                                                             |
| `values`      | `Record<string, unknown>`    | Yes      | Every NON-secret setting, with defaults filled in for whatever is not stored                |
| `configured`  | `Record<string, boolean>`    | Yes      | One entry per `secret` setting: whether a value is currently stored. Never the value itself |

</details>
