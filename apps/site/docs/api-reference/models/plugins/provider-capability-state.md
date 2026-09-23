---
title: 'ProviderCapabilityState'
sidebar_position: 14
mdx:
    format: 'md'
---

> One capability, who can answer it, and what the operator has said about the order

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type                  | Required | Description                                                                                                                                                                           |
| ------------ | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capability` | `string`              | Yes      | The manifest capability, which is also the console's anchor for this block                                                                                                            |
| `mode`       | `ProviderMode`        | Yes      |                                                                                                                                                                                       |
| `settingKey` | `string`              | Yes      | The `deadair.settings` key the console writes. Its descriptor carries the wording                                                                                                     |
| `configured` | `string`              | Yes      | The raw stored value, so the console can tell a default order from one somebody set. Empty when nothing is stored                                                                     |
| `candidates` | `ProviderCandidate[]` | Yes      | Active plugins first, in the order the station asks them, then the ones that cannot answer                                                                                            |
| `stale`      | `string[]`            | Yes      | Ids named in the setting that no active plugin answers to. Ordering never gates, so these cost nothing but say nothing either until they are shown                                    |
| `unanswered` | `boolean`             | Yes      | `one` only: a plugin is named and is not an active candidate, so the station has NO provider for this. The dangerous state, because naming one is an instruction and never falls back |

</details>
