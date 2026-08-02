import { Injectable } from 'injectkit';
import { PermissionsService } from '../permissions/permissions.service.js';
import { OnboardingRequirementInput, OnboardingRequirement } from './types/onboarding.types.js';
import { parseAndValidateArray } from '@maroonedsoftware/zod';

@Injectable()
export class OnboardingService {
    constructor(private readonly permissionsService: PermissionsService) {}

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
        // TODO: Implement — apply the submitted value for `requirement.key`.
        // The response is the still-outstanding requirements, so the client can advance
        // (or finish) without a second round trip.
        return await this.getOnboardingRequirements();
    }
}
