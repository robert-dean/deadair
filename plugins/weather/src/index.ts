import { definePlugin } from '@deadair/plugin-sdk';
import { WeatherPlugin, weatherManifest } from './weather.plugin.js';

export { WeatherPlugin, weatherManifest };

export default definePlugin(weatherManifest, () => new WeatherPlugin());
