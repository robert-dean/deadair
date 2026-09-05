plugins {
    alias(libs.plugins.android.application)
    // No `kotlin.android`: AGP 9's new DSL is incompatible with it, and Kotlin is built in.
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

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
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.ktor.client.mock)
}
