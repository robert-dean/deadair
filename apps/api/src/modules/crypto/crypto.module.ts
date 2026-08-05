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
        registry
            .register(EncryptionProvider)
            .useFactory(() => new EncryptionProvider(Buffer.from(config.get('KMS_LOCAL_ROOT_KEY', ''), 'hex')))
            .asScoped();
    },
};
