---
'@deadair/plugin-weather': minor
---

The weather plugin answers with an hourly outlook when one is asked for. Open-Meteo reads it in the same request as the current conditions and the days, the National Weather Service reads it out of the hourly forecast it already fetched for the current hour, and OpenWeatherMap reads it from the free three-hourly forecast, one request feeding both the days and the hours.
