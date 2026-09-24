---
'@deadair/plugin-sdk': patch
'@deadair/plugin-weather': patch
'@deadair/api': patch
---

On a station set to a language other than English, the weather is asked for in that language. The place the presenter names comes back named for the station's listeners ("München" rather than "Munich"), and OpenWeatherMap describes the sky in that language too. `WeatherQuery` has a new optional `language` for any weather plugin that can use it.
