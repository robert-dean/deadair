import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import type { MultipartBody } from '@maroonedsoftware/multipart';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AccessControlService } from '#modules/permissions/access.control.service.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { PluginInstaller } from './plugin.installer.js';
import { PluginLifecycleManager } from './plugin.lifecycle.manager.js';
import { PluginRegistry } from './plugin.registry.js';
import { PluginsService } from './plugins.service.js';
import type { PluginImportResult } from './types/plugins.types.js';

/**
 * Putting a plugin into the plugins directory from the console, in the order the lifecycle needs.
 *
 * Its own service rather than two more methods on `PluginsService`, whose constructor ends in an
 * OPTIONAL parameter that half a dozen test files depend on binding positionally: a required one
 * after it is not legal, and another optional one would be a dependency every method here had to
 * check for. The read model is still `PluginsService`'s, so the catalogue this answers with is the
 * one `GET /plugins` answers with.
 *
 * A plugin lands exactly as one copied in by hand does: discovered and disabled, until an operator
 * enables it and the console asks them, the first time, whether they trust it. Nothing about the
 * import makes the plugin safer to run, and nothing here says otherwise.
 */
@Injectable()
export class PluginInstallService {
    constructor(
        private readonly pluginInstaller: PluginInstaller,
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginLifecycleManager: PluginLifecycleManager,
        private readonly pluginsService: PluginsService,
        private readonly accessControl: AccessControlService,
        private readonly context: AuthorizationContext,
        private readonly activity: ActivityRecorder,
    ) {}

    /**
     * Takes an npm-packed plugin in, replacing any installed copy of the same plugin, and answers with
     * the catalogue as it now stands.
     *
     * The order is load-bearing. The old instance is disposed BEFORE the rescan, because a rescan
     * disposes only plugins whose id vanished: an id that moved to a new folder is upserted over its
     * live instance, which then has nothing left that can close it. And the rescan comes after the new
     * folder is in place, so the registry is rebuilt from what is on disk rather than patched.
     *
     * An enabled plugin comes back up on the new code with its settings, as it would after a restart;
     * one the station has never seen lands `discovered`, which is disabled until somebody acts.
     *
     * @throws 409 the id belongs to a plugin bundled with the station. Everything `stage` throws.
     */
    async importPlugin(multipart: MultipartBody): Promise<PluginImportResult> {
        return this.pluginInstaller.exclusive(async () => {
            const staged = await this.pluginInstaller.stage(multipart);
            const { id } = staged;

            try {
                const existing = this.pluginRegistry.get(id);
                if (existing?.origin === 'bundled') {
                    throw httpError(409).withDetails({
                        message: `"${id}" is the id of ${existing.manifest?.name ?? 'a plugin'} bundled with the station, and a bundled plugin cannot be replaced by an import`,
                    });
                }
                if (existing) await this.accessControl.require({ namespace: 'plugin', id }, 'configure');

                const displaced = new Set(await this.pluginInstaller.installedDirsNamed(staged.packageName));
                if (existing) displaced.add(existing.dir);
                displaced.delete(staged.targetDir);

                if (existing) await this.pluginLifecycleManager.disposePlugin(id);
                await this.pluginInstaller.place(staged, [...displaced]);
            } catch (error) {
                await staged.discard();
                throw error;
            }

            await this.pluginLifecycleManager.rescan();
            // A no-op unless this id's stored row says enabled, which is only ever an upgrade.
            await this.pluginLifecycleManager.initPlugin(id);

            this.note(id, 'plugin.imported', `An operator imported ${staged.name} ${staged.version}.`);
            return { pluginId: id, restartRequired: staged.restartRequired, plugins: await this.pluginsService.listPlugins() };
        });
    }

    /**
     * Note an operator's decision about a plugin. The plugin's id and nothing it holds, as
     * `PluginsService`'s own note does, and for the same reason.
     */
    private note(id: string, kind: string, detail: string): void {
        const actorId = this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
        void this.activity.record({
            module: 'plugins',
            kind,
            detail,
            data: { pluginId: id },
            ...(actorId === undefined ? {} : { actorId }),
        });
    }
}
