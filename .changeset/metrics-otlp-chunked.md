---
'@deadair/api': patch
---

Services using OpenTelemetry's JavaScript SDK can now send their metrics to the station. Its exporter streams each request without a declared length, and the station refused those with 411; it now takes them like any other.
