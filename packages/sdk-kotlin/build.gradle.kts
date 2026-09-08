// The Kotlin sources beside this file are GENERATED, from the `.ck` contracts in
// `apps/api/data/contracts`, by `@contractkit/plugin-kotlin`. Run `pnpm build:contracts` to
// regenerate them; the plugin's own config lives in `apps/api/contractkit.config.json`. Never
// hand-edit anything under `src/`.
//
// This build file is not generated (`scaffold` is off) and is the one file here that is written
// by hand.
//
// A plain JVM module rather than Kotlin Multiplatform: the only consumer is the Android app,
// which consumes a JVM library directly, and a second plugin family in the build buys nothing
// until there is a second consumer. The generated layout is KMP-shaped (`src/commonMain`), so
// that one directory is named as this module's source root below.
// Both applied WITHOUT a version, which is not an oversight. The app module beside this one uses
// AGP's built-in Kotlin, which puts the Kotlin Gradle plugin on the build's classpath with a
// version Gradle reports as unknown; asking for `2.4.10` here is then refused outright, because
// compatibility with an unknown version cannot be checked. Taking the classpath's copy is what
// keeps the two modules on one Kotlin, which is the thing that actually matters.
plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
    sourceSets["main"].kotlin.srcDir("src/commonMain/kotlin")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    // `api` and not `implementation`: every one of these appears in the generated SDK's public
    // signatures — a client method returns a `@Serializable` model, takes a `Uuid`, and suspends —
    // so a caller needs them on its own compile classpath.
    api(libs.ktor.client.core)
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.datetime)
    api(libs.kotlinx.coroutines.core)
}
