---
title: 'PluginFieldSuggestions'
sidebar_position: 23
mdx:
    format: 'md'
---

> Live choices for a plugin's config fields, keyed by field key, out of the plugin's own
> `suggestConfigOptions()`. What `ConfigFieldDescriptor.options` cannot be: fixed when the manifest
> was written, where these are whatever the operator's own server currently says

<details>
<summary>Attributes (2)</summary>

| Attribute   | Type                                  | Required | Description                                                                                                                                                                                           |
| ----------- | ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`    | `Record<string, ConfigFieldOption[]>` | Yes      | Keys the plugin had nothing to say about are simply absent, rather than present and empty                                                                                                             |
| `supported` | `boolean`                             | Yes      | False when the plugin does not implement suggestions at all, so a console can tell "nothing to<br>suggest" from "asked and got nothing", and draw a refresh control only where one would do something |

</details>
