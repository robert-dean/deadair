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
<summary>Attributes (13)</summary>

| Attribute          | Type                                    | Required | Description                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`    | `number`                                | Yes      | _read-only_                                                                                                                                                                                                                                                                                              |
| `complete`         | `boolean`                               | Yes      | _read-only_                                                                                                                                                                                                                                                                                              |
| `analyzer`         | `string`                                | No       | The measuring thing itself, which is not the plugin adapting it. _read-only_                                                                                                                                                                                                                             |
| `analyzerPluginId` | `string`                                | No       | _read-only_                                                                                                                                                                                                                                                                                              |
| `analyzedAt`       | `string`                                | No       | _read-only_                                                                                                                                                                                                                                                                                              |
| `failedAt`         | `string`                                | No       | _read-only_                                                                                                                                                                                                                                                                                              |
| `failureReason`    | `string`                                | No       | _read-only_                                                                                                                                                                                                                                                                                              |
| `bpm`              | `number`                                | No       | The record's tempo in beats a minute, as measured from its audio. Absent where it has no pulse to report, or has not been measured for one yet. _read-only_                                                                                                                                              |
| `beatConfidence`   | `number`                                | No       | How far to trust that tempo, from 0 to 1. Low on a record that changes tempo or feel. _read-only_                                                                                                                                                                                                        |
| `brightnessHz`     | `number`                                | No       | Where the weight of the record's sound sits, in hertz: the median spectral centroid of its sounding audio. About 130 for a dark, bass-led record to 1,500 for a bright, cymbal-heavy one. Absent where it has not been measured yet. _read-only_                                                         |
| `energyPercentile` | `number`                                | No       | How energetic the record is against the rest of this library, 0 the calmest and 100 the most energetic: its loudness and its brightness, each ranked here and averaged. Absent for a record with no trustworthy measurement, or while too little of the library is measured to rank against. _read-only_ |
| `energyFrom`       | `'loudness' \| 'loudnessAndBrightness'` | No       | Which measurements `energyPercentile` was ranked from. `loudness` until the record's brightness is measured and enough of the library has one to rank it against. Present whenever `energyPercentile` is. _read-only_                                                                                    |
| `failureCode`      | `MeasureFailure`                        | No       | Which kind of failure it was, which decides when the walk tries again. Present whenever `failedAt` is. _read-only_                                                                                                                                                                                       |

</details>
