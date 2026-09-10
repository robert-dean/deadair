---
title: 'SimpleClientExtensionResults'
sidebar_position: 24
mdx:
    format: 'md'
---

> Subset of the WebAuthn client extension results the service round-trips

<details>
<summary>Attributes (3)</summary>

| Attribute      | Type              | Required | Description                                            |
| -------------- | ----------------- | -------- | ------------------------------------------------------ |
| `appid`        | `boolean`         | No       | Whether the client is an application                   |
| `appidExclude` | `boolean`         | No       | Whether the client is excluded from appid verification |
| `credProps`    | `{ rk: boolean }` | No       |                                                        |

</details>
