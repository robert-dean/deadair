---
'@deadair/plugin-sdk': minor
---

A weather plugin can answer with an hourly outlook. `WeatherQuery.hours` asks for the next that-many hours and `WeatherReading.hours` carries a row per period the service forecasts, each starting at `at`, an ISO-8601 instant with the place's own offset.
