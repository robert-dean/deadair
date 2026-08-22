import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';

// Shared crypto primitives. Registered before AuthenticationModule so any module
// needing encryption (auth factors, plugin credential storage) can resolve it
// without depending on auth's setup order.
export const CryptoModule: ServerKitModule = {
    name: 'Crypto',
    setup: async (registry: Registry, config: AppConfig) => {
        // Checked HERE rather than inside the factory below, which is the whole point: the factory
        // is scoped, so a missing key surfaced at the first request that happened to encrypt
        // something, as a length error out of a crypto library naming nothing an operator could act
        // on. `Buffer.from('', 'hex')` is a zero-length key and throws nowhere near here.
        //
        // Read off `config` and never `process.env`: this key is in `SCRUBBED_ENV_KEYS` and is
        // deleted from the environment once the snapshots are built.
        const rootKey = String(config.get('KMS_LOCAL_ROOT_KEY', '')).trim();
        if (rootKey.length === 0) {
            throw new Error(
                'KMS_LOCAL_ROOT_KEY is not set. It is the key everything stored encrypted is encrypted with, so the server cannot start without it.',
            );
        }

        registry
            .register(EncryptionProvider)
            .useFactory(() => new EncryptionProvider(Buffer.from(rootKey, 'hex')))
            .asScoped();
    },
};
