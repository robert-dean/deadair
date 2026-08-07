import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { OnboardingService } from '#src/modules/onboarding/onboarding.service.js';
import { OnboardingRequirement, OnboardingRequirementInput } from '../modules/onboarding/types/onboarding.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [onboarding.ck](file://./../../data/contracts/onboarding/onboarding.ck)
 */
export const OnboardingRouter = ServerKitRouter();

/**
 * from [onboarding.ck](file://./../../data/contracts/onboarding/onboarding.ck#L15)
 * anonymous access, no security required
 */
OnboardingRouter.get('/onboarding', async ctx => {
    const service = ctx.container.get(OnboardingService);
    const result: OnboardingRequirement[] = await service.getOnboardingRequirements();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [onboarding.ck](file://./../../data/contracts/onboarding/onboarding.ck#L24)
 * anonymous access, no security required
 */
OnboardingRouter.post('/onboarding', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OnboardingRequirementInput);

    const service = ctx.container.get(OnboardingService);
    const result: OnboardingRequirement[] = await service.submitOnboardingRequirement(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
