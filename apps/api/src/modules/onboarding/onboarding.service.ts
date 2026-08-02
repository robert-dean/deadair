import { Injectable } from 'injectkit';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID } from '../permissions/platform.roles.js';
import { OnboardingRequirementInput, OnboardingRequirement, AdminAccountOnboardingRequirementInput } from './types/onboarding.types.js';
import { parseAndValidateArray } from '@maroonedsoftware/zod';
import { AuthenticationRegistrationService } from '../authentication/authentication.registration.service.js';
import { OnboardingRepository } from './onboarding.repository.js';
import { httpError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';

@Injectable()
export class OnboardingService {
    constructor(
        private readonly permissionsService: PermissionsService,
        private readonly authenticationRegistrationService: AuthenticationRegistrationService,
        private readonly onboardingRepository: OnboardingRepository,
    ) {}

    async getOnboardingRequirements() {
        const requirements: OnboardingRequirement[] = [];
        const adminExists = await this.permissionsService.adminExists();
        if (!adminExists) {
            requirements.push({
                key: 'admin.account',
                title: 'Administrator account',
                description: 'Create an administrator account to get started',
                optional: false,
            });
        }
        return await parseAndValidateArray(requirements, OnboardingRequirement);
    }

    async submitOnboardingRequirement(requirement: OnboardingRequirementInput) {
        if (requirement.key === 'admin.account') {
            const adminAccountRequirement = requirement as AdminAccountOnboardingRequirementInput;

            // This endpoint is necessarily unauthenticated — there is no admin yet to
            // authorize the call — so "no admin exists" is the only thing gating it.
            // Re-assert it here rather than trusting the getOnboardingRequirements()
            // the client saw: without this, a second POST mints a second admin.
            await this.onboardingRepository.lockOnboarding();
            if (await this.permissionsService.adminExists()) {
                throw httpError(409).withDetails({
                    code: ErrorCodes.ONBOARDING_ADMIN_ALREADY_EXISTS,
                    message: 'an administrator account already exists',
                });
            }

            const actor = await this.authenticationRegistrationService.bootstrapLogin({
                email: adminAccountRequirement.value.email,
                password: adminAccountRequirement.value.password,
            });

            // The first account is an onboarding rule, not a registration one, so the
            // grant lives here rather than in bootstrapLogin. `createdBy` is the actor
            // itself: there is no acting administrator to attribute this to.
            await this.permissionsService.writeDirect(
                [
                    {
                        object: { namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID },
                        relation: 'admin',
                        subject: { kind: 'concrete', namespace: 'user', id: actor.id },
                    },
                ],
                actor.id,
            );
        }

        return await this.getOnboardingRequirements();
    }
}
