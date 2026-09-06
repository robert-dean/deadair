plugins {
    alias(libs.plugins.android.application)
    // No `kotlin.android`: AGP 9's new DSL is incompatible with it, and Kotlin is built in.
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// ── The upload key ────────────────────────────────────────────────────────────────────────
//
// Play App Signing holds the key the app is really signed with; this one only proves an upload
// came from us. It lives OUTSIDE the repo — `~/.gradle/gradle.properties` names the file and
// carries its passwords — so a checkout contains no secret and cannot leak one.
//
// Every property is optional on purpose. CI has no key and must still configure and build, so an
// absent key leaves the release type unsigned rather than failing the build: `bundleRelease` in
// CI is there to catch R8 breaking, which it does whether or not the output could be uploaded.
val uploadKeystore = providers.gradleProperty("deadair.upload.keystore")
val uploadKeystorePassword = providers.gradleProperty("deadair.upload.keystorePassword")
val uploadKeyAlias = providers.gradleProperty("deadair.upload.keyAlias")
val uploadKeyPassword = providers.gradleProperty("deadair.upload.keyPassword")
val hasUploadKey =
    uploadKeystore.isPresent && uploadKeystorePassword.isPresent && uploadKeyAlias.isPresent && uploadKeyPassword.isPresent

// ── The version code ──────────────────────────────────────────────────────────────────────
//
// Play refuses a version code it has already accepted, and the way that goes wrong is a human
// forgetting to raise one. This is the commit count: it only ever grows on a branch nobody
// rewrites, so every commit is uploadable and no release step has to remember anything.
//
// `versionName` stays a hand-written marketing string, because that one is a decision rather
// than a fact about the tree.
//
// A checkout with no git history answers 1, which builds and cannot be uploaded twice. That is
// the right way round: a source tarball still compiles, and nobody ships from one by accident.
val gitCommitCount =
    providers
        .exec {
            commandLine("git", "rev-list", "--count", "HEAD")
            isIgnoreExitValue = true
        }
        .standardOutput
        .asText
        .map { it.trim().toIntOrNull() ?: 1 }

android {
    namespace = "com.maroonedsoftware.deadair"
    // 37 rather than 36 because AndroidX requires it: `core-ktx` 1.19 and the Compose BOM both
    // refuse to be compiled against an older platform. The minor is part of the coordinate now —
    // the installed platform is `android-37.2` — so both halves are named.
    compileSdk = 37
    compileSdkMinor = 2

    defaultConfig {
        applicationId = "com.maroonedsoftware.deadair"
        // 26 rather than lower: notification channels are mandatory from here, so the media
        // notification is one code path rather than two, and `java.time` needs no desugaring.
        minSdk = 26
        targetSdk = 37
        versionCode = gitCommitCount.get()
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                storeFile = file(uploadKeystore.get())
                storePassword = uploadKeystorePassword.get()
                keyAlias = uploadKeyAlias.get()
                keyPassword = uploadKeyPassword.get()
                // Both signature schemes: v1 is what lets a bundle's older-device splits verify,
                // and v2 is what everything since Nougat actually checks.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Null when no key is configured, which is a valid assignment and leaves the artifact
            // unsigned. See the note on the properties above.
            signingConfig = signingConfigs.findByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        // `mipmap-anydpi-v26` draws an `ObsoleteSdkInt` warning saying the qualifier is
        // unnecessary at minSdk 26. It is not: without it AAPT does not resolve
        // `@mipmap/ic_launcher` at all and the build fails at resource linking. Measured, both
        // ways, on a clean build.
        disable += "ObsoleteSdkInt"
        // `DataExtractionRules` asks for `android:fullBackupContent` beside the rules file,
        // because that file does nothing below Android 12. True, and `android:allowBackup="false"`
        // is already the whole answer there — the check does not model it. Answering it properly
        // would mean a third file configuring a backup that never happens.
        disable += "DataExtractionRules"
        // `InsecureBaseConfiguration` flags the cleartext this app cannot do without: TLS
        // terminates outside the station's container, so a LAN install is plain HTTP and nothing
        // else. The argument in full is in `network_security_config.xml`.
        disable += "InsecureBaseConfiguration"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // The generated SDK, and the Ktor engine it runs on. The SDK declares no engine of its own —
    // `HttpClient()` finds whatever is on the classpath — so choosing one is the app's job, and
    // OkHttp is the choice because Coil uses it too and one client means one connection pool and
    // one User-Agent. That User-Agent matters: HLS listeners are counted per IP and agent.
    implementation(project(":sdk"))
    implementation(libs.ktor.client.okhttp)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.datastore.preferences)
    // The back stack. A state-driven list of serialisable keys rather than route strings, with
    // predictive back for free; see `ui/nav/Destination.kt` for why it arrived when it did.
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.bundles.media3)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.ktor.client.mock)
}
