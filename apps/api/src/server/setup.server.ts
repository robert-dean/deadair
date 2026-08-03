import { ConsoleLogger } from '@maroonedsoftware/logger';
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { setupMiddleware } from './setup.middleware.js';
import { routers } from '#routes/routes.setup.js';
import { Settings } from 'luxon';
import { modules } from '#src/modules/modules.js';
import { ServerKitRouterType, ServerKitServerBuilder } from '@maroonedsoftware/koa';
import { scrubProcessEnv } from './scrub.process.env.js';

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

    await serverBuilder.setup(config, new ConsoleLogger(), modules);
    serverBuilder.setupMiddleware(setupMiddleware).setupRoutes(routers as ServerKitRouterType[]);

    const port = config.getNumber('PORT');

    return await serverBuilder.start(port);
};
