---
title: 'SettingGroup'
sidebar_position: 1
mdx:
    format: 'md'
---

> Which part of the console owns a setting. Every one of these but `schedule`, `personas` and `providers` is a section of the settings page; `schedule` is edited on the schedule page, beside the timetable it describes, `personas` on the characters page, beside the names it stands behind, and `providers` on the Providers section, which draws each capability beside the plugins that answer it rather than as a form of text fields.

```typescript
type SettingGroup =
    'station' | 'stream' | 'housekeeping' | 'mail' | 'rotation' | 'playout' | 'render' | 'llm' | 'analysis' | 'schedule' | 'personas' | 'providers';
```
