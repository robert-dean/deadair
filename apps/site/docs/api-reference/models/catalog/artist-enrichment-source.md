---
title: 'ArtistEnrichmentSource'
sidebar_position: 28
mdx:
    format: 'md'
---

<details>
<summary>Attributes (8)</summary>

| Attribute     | Type                   | Required | Description                                                                          |
| ------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------ |
| `provider`    | `string`               | Yes      | _read-only_                                                                          |
| `providerRef` | `string`               | No       | _read-only_                                                                          |
| `fetchedAt`   | `string`               | Yes      | _read-only_                                                                          |
| `expiresAt`   | `string`               | No       | _read-only_                                                                          |
| `stale`       | `boolean`              | Yes      | _read-only_                                                                          |
| `found`       | `boolean`              | Yes      | _read-only_                                                                          |
| `failed`      | `boolean`              | Yes      | The last attempt errored, so `expiresAt` is a backoff rather than a TTL. _read-only_ |
| `data`        | `ArtistEnrichmentData` | Yes      |                                                                                      |

</details>
