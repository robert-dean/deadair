---
title: 'List capability providers'
sidebar_label: 'List capability providers'
sidebar_position: 3
mdx:
    format: 'md'
---

Every capability more than one plugin could answer, who can answer it, and in what order the station asks them

**`GET`** `/plugins/providers`

:::note
SDK method: `listCapabilityProviders`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [ProviderCatalogue](../models/plugins/provider-catalogue.md) object.
