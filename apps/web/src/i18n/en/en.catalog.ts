import { activity } from './activity.catalog.ts';
import { api } from './api.catalog.ts';
import { auth } from './auth.catalog.ts';
import { catalog } from './catalog.catalog.ts';
import { charts } from './charts.catalog.ts';
import { common } from './common.catalog.ts';
import { desk } from './desk.catalog.ts';
import { library } from './library.catalog.ts';
import { narrations } from './narrations.catalog.ts';
import { news } from './news.catalog.ts';
import { onair } from './onair.catalog.ts';
import { onboarding } from './onboarding.catalog.ts';
import { pads } from './pads.catalog.ts';
import { personas } from './personas.catalog.ts';
import { phrasings } from './phrasings.catalog.ts';
import { playlists } from './playlists.catalog.ts';
import { playout } from './playout.catalog.ts';
import { plugins } from './plugins.catalog.ts';
import { podcasts } from './podcasts.catalog.ts';
import { productions } from './productions.catalog.ts';
import { programme } from './programme.catalog.ts';
import { pronunciations } from './pronunciations.catalog.ts';
import { requests } from './requests.catalog.ts';
import { routes } from './routes.catalog.ts';
import { schedule } from './schedule.catalog.ts';
import { scripts } from './scripts.catalog.ts';
import { segments } from './segments.catalog.ts';
import { settings } from './settings.catalog.ts';
import { shell } from './shell.catalog.ts';
import { station } from './station.catalog.ts';
import { topics } from './topics.catalog.ts';
import { voice } from './voice.catalog.ts';
import { voices } from './voices.catalog.ts';

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
