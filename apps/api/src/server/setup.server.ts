import { ConsoleLogger } from '@maroonedsoftware/logger';
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
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

    const config = await new AppConfigBuilder()
        .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
        .addResolver(new AppConfigResolverEnv())
        .buildSnapshot();

    // Module setups read from `config` (the resolved snapshot), not from `process.env`, so it is
    // safe to scrub secret values out of the process environment here. See
    // scrub.process.env.ts for what this does and does not buy.
    scrubProcessEnv();

    // A present-but-malformed LOG_MAX_* value (e.g. `LOG_MAX_BYTES=2MB`) must fail loudly here,
    // at boot, naming the offending variable and value — not flow through as NaN and surface
    // later as a silently empty logs directory. See log.env.ts for why.
    const logStore = new RotatingLogStore({
        root: config.get('LOGS_DIR', './logs'),
        maxBytes: config.get('LOG_MAX_BYTES', 2 * 1024 * 1024),
        maxFiles: config.get('LOG_MAX_FILES', 3),
        maxValueChars: config.get('LOG_MAX_VALUE_CHARS', 512),
        maxLineBytes: config.get('LOG_MAX_LINE_BYTES', 8 * 1024),
    });
    setLogStore(logStore);

    await serverBuilder.setup(config, new DeadairLogger(new ConsoleLogger(), logStore), modules);
    serverBuilder.setupMiddleware(setupMiddleware).setupRoutes(routers as ServerKitRouterType[]);

    const port = config.get('PORT', 3333);

    return await serverBuilder.start(port);
};
