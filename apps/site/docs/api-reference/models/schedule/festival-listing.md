---
title: 'FestivalListing'
sidebar_position: 4
mdx:
    format: 'md'
---

> A festival as a ticket service lists it, for an operator to check and then add. Nothing here is said on air until it is saved as a festival

<details>
<summary>Attributes (8)</summary>

| Attribute  | Type       | Required | Description                                                 |
| ---------- | ---------- | -------- | ----------------------------------------------------------- |
| `pluginId` | `string`   | Yes      | The plugin that listed it, to send back as `sourcePluginId` |
| `eventId`  | `string`   | Yes      | Its own id for the listing, to send back as `sourceEventId` |
| `name`     | `string`   | Yes      |                                                             |
| `startsOn` | `string`   | Yes      |                                                             |
| `endsOn`   | `string`   | Yes      |                                                             |
| `place`    | `string`   | No       | The venue and the town, as the service gives them           |
| `url`      | `string`   | No       |                                                             |
| `acts`     | `string[]` | Yes      | Who the service lists as performing, in its order           |

</details>
