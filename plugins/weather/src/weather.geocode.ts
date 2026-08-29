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
 * ## A comma-qualified name is asked for TWICE, and that is measured
 *
 * The obvious implementation — hand the whole string over and take the first
 * result — is what this was, and it silently fails on exactly the input an
 * operator is most likely to type. Measured against the live service on
 * 2026-08-29: `Atlanta, Georgia` resolves, `Chipping Norton, Oxfordshire`
 * resolves to NOTHING, and `Chipping Norton` on its own resolves fine. The
 * endpoint matches its `name` parameter against place names, so a qualifier is
 * sometimes part of one and usually is not.
 *
 * "Nothing of that name" is an ordinary answer everywhere else here, so that
 * failure arrives as a station that has simply stopped mentioning the weather,
 * with nothing in any log that names the comma.
 *
 * So: ask with the whole string first, because that is what the service is for
 * and it costs one request in the common case. Only when that finds nothing, ask
 * again with the part before the first comma and use the REST as a filter over
 * what comes back — which is what the operator meant by writing it. A second
 * request happens only on the path that used to answer nothing at all.
 *
 * Among equally good matches the first wins. The API ranks by population, so
 * `Springfield` resolves to the biggest one — the same guess a person makes, and
 * the returned {@link GeoPoint.name} is what tells an operator it guessed
 * differently from them.
 */
export async function geocode(service: Service, place: string): Promise<GeoPoint | undefined> {
    const asked = place.trim();
    if (asked.length === 0) return undefined;

    const whole = parseGeocoding(await search(service, asked, 1));
    if (whole !== undefined) return whole;

    const [head, ...rest] = asked.split(',');
    const town = head?.trim() ?? '';
    const qualifier = rest.join(',').trim();
    if (town.length === 0 || qualifier.length === 0 || town === asked) return undefined;

    // Ten rather than one, because the whole point of the second ask is that
    // there are several places of this name and the operator has said which.
    return parseGeocoding(await search(service, town, 10), qualifier);
}

async function search(service: Service, name: string, count: number): Promise<unknown> {
    const url = new URL(`https://${OPEN_METEO_GEOCODING_HOST}/v1/search`);
    url.searchParams.set('name', name);
    url.searchParams.set('count', String(count));
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');

    return await fetchJson(service, url.toString(), { name: 'the Open-Meteo geocoder', timeoutMs: REQUEST_TIMEOUT_MS });
}

/**
 * Open-Meteo's geocoding JSON, as a point.
 *
 * Pure and exported separately from the request, so a saved response pins the
 * mapping with no host in the way — `parseFeed`'s split, for `parseFeed`'s
 * reason. A place nothing matched comes back as `undefined`, which is what the
 * service says by omitting `results` entirely rather than sending an empty array.
 *
 * @param qualifier - What the operator wrote after the comma, when the caller is
 * choosing among several places of one name. A result whose region, county or
 * country carries it wins; when none does, the first still wins — the biggest
 * place of that name is a better answer than silence, and the name that comes
 * back says which one it was.
 */
export function parseGeocoding(data: unknown, qualifier?: string): GeoPoint | undefined {
    const results = field(data, 'results');
    if (!Array.isArray(results)) return undefined;

    const chosen = (qualifier === undefined ? undefined : results.find(result => matchesQualifier(result, qualifier))) ?? results[0];

    const latitude = field(chosen, 'latitude');
    const longitude = field(chosen, 'longitude');
    const name = field(chosen, 'name');

    if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
    if (typeof name !== 'string' || name.trim().length === 0) return undefined;

    return { name: qualify(name.trim(), field(chosen, 'admin1'), field(chosen, 'country')), latitude, longitude };
}

/**
 * Whether a result is in the place the operator named after the comma.
 *
 * Checked against the region, the county and the country, because an operator
 * writing `Chipping Norton, Oxfordshire` has named a county and one writing
 * `Springfield, USA` has named a country, and neither should have to know which
 * field a service files that under. Loose on purpose — a substring either way,
 * case-insensitively — so `Oxfordshire` matches `Oxfordshire` and `GA` matches
 * `Georgia` is deliberately NOT expected to work: an abbreviation is a different
 * problem and guessing at one would match the wrong county somewhere.
 */
function matchesQualifier(result: unknown, qualifier: string): boolean {
    const wanted = qualifier.toLowerCase();

    return [field(result, 'admin1'), field(result, 'admin2'), field(result, 'country')]
        .map(value => text(value)?.toLowerCase())
        .some(area => area !== undefined && (area.includes(wanted) || wanted.includes(area)));
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
