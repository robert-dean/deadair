---
title: 'ConfigFieldOptionSource'
sidebar_position: 6
mdx:
    format: 'md'
---

> Where a field's or a column's choices come from when only the console can enumerate them: the
> station's own tables, the platform's zone list, the enabled plugins that can do one of four jobs,
> or the models the selected model plugin currently offers. Resolved by the console either way

```typescript
type ConfigFieldOptionSource =
    | 'station.newsCategories'
    | 'station.newsFeeds'
    | 'intl.timeZones'
    | 'plugins.speech'
    | 'plugins.llm'
    | 'plugins.mixer'
    | 'plugins.analysis'
    | 'llm.models';
```
