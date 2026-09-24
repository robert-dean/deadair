/** The first-run wizard, and the steps it walks an operator through. */
export const onboarding = {
    wizard: {
        title: 'Set up deadair',
        intro: 'A few things need answering before the station can go on air.',
        nothingLeft: 'Nothing left to configure.',
        optional: 'Optional',
        done: 'Nothing else to do here.',
        skip: 'Skip',
        unsupportedTitle: 'Not supported in this build',
        unsupported: 'This build has no screen for <code>{{key}}</code>. Configure it directly, or skip it if it is optional.',
    },
    steps: {
        adminAccount: 'Administrator',
    },
    admin: {
        rateLimited: 'Too many attempts. Wait a moment and try again.',
        retryIn: 'Too many attempts. Try again in {{seconds}} seconds.',
        fallback: 'Could not create the administrator account. Try again.',
        emailInvalid: 'Enter a valid email address',
        passwordShort: 'Use at least {{min}} characters',
        passwordMismatch: 'Passwords do not match',
        failed: 'Setup failed',
        email: 'Email',
        emailPlaceholder: 'you@example.com',
        password: 'Password',
        confirmPassword: 'Confirm password',
        create: 'Create administrator',
    },
} as const;
