// Nothing is applied at the root: every plugin is declared here so the version catalog is the one
// place a version is written, and applied in the module that actually needs it.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
