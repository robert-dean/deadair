import { fetchJson, type Service } from './weather.http.js';
import { field, text } from './weather.values.js';
import { OPEN_METEO_GEOCODING_HOST, REQUEST_TIMEOUT_MS } from './weather.manifest.js';

/** A place, once something has worked out where it is. */
export interface GeoPoint {
    /**
     * What to call it out loud.
     *
     * The service's own spelling, qualified enough to be unambiguous where the
     * service says so: `Birmingham, Alabama` rather than `Birmingham`. This is
     * the field that makes a wrong answer visible — a station announcing the
     * weather in the other Birmingham is a failure nothing else here detects.
     */
    name: string;
    latitude: number;
    longitude: number;
}

/**
 * Open-Meteo's geocoder, which is keyless and is what two of the three engines
 * use.
 *
 * The National Weather Service borrows it because it has none of its own and
 * takes coordinates only. OpenWeatherMap has its own and uses that instead,
 * since its key is already paid for and a service is better at finding places in
 * its own index.
 *
 * The first result wins. The API ranks by population, so `Springfield` resolves
 * to the biggest one — which is the same guess a person makes, and the returned
 * {@link GeoPoint.name} is what tells an operator it guessed differently from
 * them.
 */
export async function geocode(service: Service, place: string): Promise<GeoPoint | undefined> {
    const asked = place.trim();
    if (asked.length === 0) return undefined;

    const url = new URL(`https://${OPEN_METEO_GEOCODING_HOST}/v1/search`);
    url.searchParams.set('name', asked);
    url.searchParams.set('count', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');

    return parseGeocoding(await fetchJson(service, url.toString(), { name: 'the Open-Meteo geocoder', timeoutMs: REQUEST_TIMEOUT_MS }));
}

/**
 * Open-Meteo's geocoding JSON, as a point.
 *
 * Pure and exported separately from the request, so a saved response pins the
 * mapping with no host in the way — `parseFeed`'s split, for `parseFeed`'s
 * reason. A place nothing matched comes back as `undefined`, which is what the
 * service says by omitting `results` entirely rather than sending an empty array.
 */
export function parseGeocoding(data: unknown): GeoPoint | undefined {
    const results = field(data, 'results');
    if (!Array.isArray(results)) return undefined;

    const first = results[0];
    const latitude = field(first, 'latitude');
    const longitude = field(first, 'longitude');
    const name = field(first, 'name');

    if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
    if (typeof name !== 'string' || name.trim().length === 0) return undefined;

    return { name: qualify(name.trim(), field(first, 'admin1'), field(first, 'country')), latitude, longitude };
}

/**
 * The place name with enough around it to be the right place.
 *
 * The region where the service gives one, and the country otherwise. Not both,
 * because "Atlanta, Georgia, United States" is nobody's answer to where they
 * live, and the point of this string is that a presenter could read it.
 */
function qualify(name: string, region: unknown, country: unknown): string {
    const area = text(region) ?? text(country);
    if (area === undefined || area.toLowerCase() === name.toLowerCase()) return name;
    return `${name}, ${area}`;
}
