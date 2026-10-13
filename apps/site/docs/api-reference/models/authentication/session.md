---
title: 'Session'
sidebar_position: 59
mdx:
    format: 'md'
---

> An active authentication session

<details>
<summary>Attributes (9)</summary>

| Attribute        | Type              | Required | Description                                                                  |
| ---------------- | ----------------- | -------- | ---------------------------------------------------------------------------- |
| `sessionToken`   | `string`          | Yes      | Opaque session token used as the cache key and embedded in JWTs. _read-only_ |
| `actorId`        | `string`          | Yes      | The actor that owns this session. _read-only_                                |
| `issuedAt`       | `string`          | Yes      | When the session was originally issued. _read-only_                          |
| `expiresAt`      | `string`          | Yes      | When the session expires. _read-only_                                        |
| `lastAccessedAt` | `string`          | Yes      | When the session was last accessed. _read-only_                              |
| `factors`        | `SessionFactor[]` | Yes      | Factors that have been satisfied in this session. _read-only_                |
| `ip`             | `string`          | No       | IP address recorded when the session was created. _read-only_. _nullable_    |
| `userAgent`      | `string`          | No       | User agent recorded when the session was created. _read-only_. _nullable_    |
| `isCurrent`      | `boolean`         | Yes      | True when this session matches the requesting session. _read-only_           |

</details>
