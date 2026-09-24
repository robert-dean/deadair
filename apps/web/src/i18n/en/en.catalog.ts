import { activity } from './activity.catalog';
import { api } from './api.catalog';
import { auth } from './auth.catalog';
import { catalog } from './catalog.catalog';
import { charts } from './charts.catalog';
import { common } from './common.catalog';
import { desk } from './desk.catalog';
import { library } from './library.catalog';
import { narrations } from './narrations.catalog';
import { news } from './news.catalog';
import { onair } from './onair.catalog';
import { onboarding } from './onboarding.catalog';
import { pads } from './pads.catalog';
import { personas } from './personas.catalog';
import { phrasings } from './phrasings.catalog';
import { playlists } from './playlists.catalog';
import { playout } from './playout.catalog';
import { plugins } from './plugins.catalog';
import { podcasts } from './podcasts.catalog';
import { productions } from './productions.catalog';
import { programme } from './programme.catalog';
import { pronunciations } from './pronunciations.catalog';
import { requests } from './requests.catalog';
import { routes } from './routes.catalog';
import { schedule } from './schedule.catalog';
import { scripts } from './scripts.catalog';
import { segments } from './segments.catalog';
import { settings } from './settings.catalog';
import { shell } from './shell.catalog';
import { station } from './station.catalog';
import { topics } from './topics.catalog';
import { voice } from './voice.catalog';
import { voices } from './voices.catalog';

/**
 * Every English namespace, one per feature folder under `src/components` (plus `routes`, `api` and
 * `common` for the shared components). English is the source language: it is bundled with the
 * console and is what any other locale falls back to key by key, and its shape is the type every
 * other locale's catalog is checked against.
 */
export const en = {
    common,
    shell,
    auth,
    routes,
    api,
    personas,
    settings,
    plugins,
    topics,
    catalog,
    library,
    schedule,
    programme,
    station,
    charts,
    onair,
    desk,
    playout,
    playlists,
    pads,
    activity,
    narrations,
    news,
    onboarding,
    phrasings,
    podcasts,
    productions,
    pronunciations,
    requests,
    scripts,
    segments,
    voice,
    voices,
} as const;
