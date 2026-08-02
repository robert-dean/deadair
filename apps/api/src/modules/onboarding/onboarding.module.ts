import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { OnboardingService } from './onboarding.service.js';
import { OnboardingRepository } from './onboarding.repository.js';

export const OnboardingModule: ServerKitModule = {
    name: 'Onboarding',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(OnboardingService).useClass(OnboardingService).asScoped();
        registry.register(OnboardingRepository).useClass(OnboardingRepository).asScoped();
    },
};
