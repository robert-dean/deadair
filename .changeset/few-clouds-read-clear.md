---
'@deadair/plugin-weather': patch
---

A mainly clear sky is clear. Open-Meteo's code 1 ("mainly clear") was reported as cloudy, so the weather writer was told "cloudy" and "mainly clear" in the same reading; OpenWeatherMap's "few clouds" had the same mapping. Both now read as clear, as the National Weather Service's few clouds already did.
