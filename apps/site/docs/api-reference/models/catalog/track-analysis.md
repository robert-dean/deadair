---
title: 'TrackAnalysis'
sidebar_position: 7
mdx:
    format: 'md'
---

> What the measurement sidecar made of a record.
>
> `complete` is NOT `analyzedAt`, and the two are separate fields for a reason `0005_music.sql`
> argues at length: a measurement of a truncated download is confident and wrong, so every reader in
> the app filters on `complete` and a page that showed only a date would be reporting a record as
> measured that nothing will use the measurement of.

<details>
<summary>Attributes (7)</summary>

| Attribute          | Type      | Required | Description                                                                  |
| ------------------ | --------- | -------- | ---------------------------------------------------------------------------- |
| `schemaVersion`    | `number`  | Yes      | _read-only_                                                                  |
| `complete`         | `boolean` | Yes      | _read-only_                                                                  |
| `analyzer`         | `string`  | No       | The measuring thing itself, which is not the plugin adapting it. _read-only_ |
| `analyzerPluginId` | `string`  | No       | _read-only_                                                                  |
| `analyzedAt`       | `string`  | No       | _read-only_                                                                  |
| `failedAt`         | `string`  | No       | _read-only_                                                                  |
| `failureReason`    | `string`  | No       | _read-only_                                                                  |

</details>
