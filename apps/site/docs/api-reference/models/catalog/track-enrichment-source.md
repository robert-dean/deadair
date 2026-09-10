---
title: 'TrackEnrichmentSource'
sidebar_position: 27
mdx:
    format: 'md'
---

> One provider's stored answer. `found: false` is a recorded miss, which is a fact rather than a
> failure: the provider was asked, had nothing, and is not asked again until `expiresAt`. A provider
> that could not be asked at all is `failed` instead, and the two never both hold.

<details>
<summary>Attributes (8)</summary>

| Attribute     | Type                  | Required | Description                                                                          |
| ------------- | --------------------- | -------- | ------------------------------------------------------------------------------------ |
| `provider`    | `string`              | Yes      | _read-only_                                                                          |
| `providerRef` | `string`              | No       | The id it was fetched under. Provenance, not identity. _read-only_                   |
| `fetchedAt`   | `string`              | Yes      | _read-only_                                                                          |
| `expiresAt`   | `string`              | No       | _read-only_                                                                          |
| `stale`       | `boolean`             | Yes      | Past its TTL, so the next pass will ask again. _read-only_                           |
| `found`       | `boolean`             | Yes      | _read-only_                                                                          |
| `failed`      | `boolean`             | Yes      | The last attempt errored, so `expiresAt` is a backoff rather than a TTL. _read-only_ |
| `data`        | `TrackEnrichmentData` | Yes      |                                                                                      |

</details>
