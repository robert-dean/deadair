import { ConsoleLogger } from '@maroonedsoftware/logger';
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { settingsConfigSource } from './settings.config.source.js';
import { setConfigStore } from './config.store.js';
import { setupMiddleware } from './setup.middleware.js';
import { routers } from '#routes/routes.setup.js';
import { Settings } from 'luxon';
import { modules } from '#src/modules/modules.js';
import { ServerKitRouterType, ServerKitServerBuilder } from '@maroonedsoftware/koa';
import { scrubProcessEnv } from './scrub.process.env.js';
import { DeadairLogger } from '#src/logging/deadair.logger.js';
import { RotatingLogStore } from '#src/logging/rotating.log.store.js';
import { setLogStore } from '#src/logging/log.store.js';

export const setupServer = async () => {
    const serverBuilder = new ServerKitServerBuilder();

    Settings.defaultZone = 'utc';

    // The boot config: environment only, and the only one available until there is somewhere to
    // write logs. Everything read off it here is infrastructure the app needs BEFORE it can reach
    // a database — where to log, and how to connect — which is exactly the line between what
    // belongs in `.env` and what belongs in `deadair.settings`.
    const boot = await new AppConfigBuilder()
        .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
        .addResolver(new AppConfigResolverEnv())
        .buildSnapshot();

    // A present-but-malformed LOG_MAX_* value (e.g. `LOG_MAX_BYTES=2MB`) must fail loudly here,
    // at boot, naming the offending variable and value — not flow through as NaN and surface
    // later as a silently empty logs directory. See log.env.ts for why.
    const logStore = new RotatingLogStore({
        root: boot.get('LOGS_DIR', './logs'),
        maxBytes: boot.get('LOG_MAX_BYTES', 2 * 1024 * 1024),
        maxFiles: boot.get('LOG_MAX_FILES', 3),
        maxValueChars: boot.get('LOG_MAX_VALUE_CHARS', 512),
        maxLineBytes: boot.get('LOG_MAX_LINE_BYTES', 8 * 1024),
    });
    setLogStore(logStore);

    const logger = new DeadairLogger(new ConsoleLogger(), logStore);

    // The real config: the same environment layer, plus `deadair.settings` on top of it, held in a
    // store that rebuilds itself whenever that table changes. The settings source is added second
    // because later sources win, though in practice nothing collides — env keys are
    // SCREAMING_SNAKE and settings keys are dotted.
    //
    // The dotenv source is loaded a second time here rather than being carried over from `boot`,
    // which is one more read of a file already on disk and buys the honest ordering above: the log
    // store needs config to know where to write, and the settings source needs a logger to report
    // a settings table that does not exist yet.
    const configStore = await new AppConfigBuilder()
        .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
        .addSource(settingsConfigSource(boot, logger))
        .addResolver(new AppConfigResolverEnv())
        .buildStore(logger);
    setConfigStore(configStore);

    // Module setups read from the config, not from `process.env`, so it is safe to scrub secret
    // values out of the process environment here. See scrub.process.env.ts for what this does and
    // does not buy. It happens after both builds above deliberately: the settings source holds the
    // database credentials it was handed as resolved literals, so it survives this, but a source
    // still resolving `${env:…}` on reload would not.
    scrubProcessEnv();

    // A LIVE view, not a snapshot: every read delegates to whatever the store currently holds, so
    // everything the container hands an `AppConfig` to sees a settings change without re-resolving
    // anything. That is what makes a setting readable from a singleton with no DI scope, which the
    // playout transport ticking every couple of seconds does not have.
    await serverBuilder.setup(configStore.toLiveConfig(), logger, modules);
    serverBuilder.setupMiddleware(setupMiddleware).setupRoutes(routers as ServerKitRouterType[]);

    // From `boot` rather than the store: the port is bound once and a settings row could not move
    // it without a restart anyway, so reading it live would only suggest otherwise.
    const port = boot.get('PORT', 3333);

    return await serverBuilder.start(port);
};
