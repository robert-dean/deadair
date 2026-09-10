---
title: 'SettingGroup'
sidebar_position: 1
mdx:
    format: 'md'
---

> Which part of the console owns a setting. Every one of these but `schedule` is a section of the settings page; `schedule` is edited on the schedule page, beside the timetable it describes.

```typescript
type SettingGroup = 'station' | 'stream' | 'housekeeping' | 'secrets' | 'mail' | 'rotation' | 'playout' | 'render' | 'llm' | 'analysis' | 'schedule';
```
