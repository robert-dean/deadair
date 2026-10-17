---
'@deadair/api': minor
---

The station keeps its numbers over time. Its listener count is recorded once a minute into a new `metric_samples` table, folded into hourly rows every hour, and kept for a week at the minute and thirteen months by the hour. Both windows are housekeeping settings, and zero keeps everything. Nothing reads the table yet: the trends page and the work, model and backlog numbers come next.
