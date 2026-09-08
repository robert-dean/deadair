// The listener app's own Gradle build. It is deliberately NOT a pnpm workspace member — there is
// no `package.json` here — so turbo and vitest never see it, the same arrangement the Python
// sidecar in `analysis/` has and for the same reason: a Gradle build has nothing to share with
// either, and one CI job of its own is cheaper than pretending otherwise.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // A subproject that declares its own repository is a subproject nobody can audit, so the
    // build refuses one rather than silently resolving from it.
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "deadair"

include(":app")

// The generated Kotlin SDK, which lives beside the TypeScript one under `packages/` rather than
// inside this app: it is an output of `pnpm build:contracts`, not of this build, and a second
// consumer would take it from there too. Only this build compiles it.
include(":sdk")
project(":sdk").projectDir = file("../../packages/sdk-kotlin")
