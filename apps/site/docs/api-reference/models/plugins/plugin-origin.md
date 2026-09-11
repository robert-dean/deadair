---
title: 'PluginOrigin'
sidebar_position: 2
mdx:
    format: 'md'
---

> Where the station found a plugin: shipped inside the image, or installed by the operator into the plugins
> directory on the data volume. Says nothing about trust; both kinds run inside the station with its privileges

```typescript
type PluginOrigin = 'bundled' | 'installed';
```
