package com.maroonedsoftware.deadair.ui.settings

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.PreviewLightDark
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.PlatformRole
import com.maroonedsoftware.deadair.station.StationCheck
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.setup.SetupScreen
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

private val availability = mapOf(StreamFormat.MP3 to true, StreamFormat.HLS to true, StreamFormat.AAC to true, StreamFormat.OPUS to false, StreamFormat.FLAC to false)

@Composable
private fun Settings(entry: StationEntryState, session: SessionState, account: AccountState = AccountState()) {
    DeadairTheme {
        SettingsScreen(
            entry = entry,
            format = StreamFormat.MP3,
            availability = availability,
            session = session,
            account = account,
            dynamicColour = false,
            onBack = {},
            onAddressChange = {},
            onCheck = {},
            onConfirm = {},
            onFormat = {},
            onDynamicColour = {},
            onEmailChange = {},
            onPasswordChange = {},
            onCodeChange = {},
            onSignIn = {},
            onStartAgain = {},
            onSignOut = {},
        )
    }
}

@PreviewLightDark
@Composable
private fun SignedOutPreview() =
    Settings(StationEntryState.typing("https://radio.example.com", stored = "https://radio.example.com"), SessionState.SignedOut)

@PreviewLightDark
@Composable
private fun RefusedPreview() =
    Settings(
        StationEntryState.typing("https://radio.example.com", stored = "https://radio.example.com"),
        SessionState.SignedOut,
        AccountState(email = "operator@example.com", error = Message.BadCredentials),
    )

@PreviewLightDark
@Composable
private fun SecondFactorPreview() =
    Settings(
        StationEntryState.typing("https://radio.example.com", stored = "https://radio.example.com"),
        SessionState.SignedOut,
        AccountState(email = "operator@example.com", challenge = SecondFactor("c_1", "totp-1")),
    )

@PreviewLightDark
@Composable
private fun CodeRefusedPreview() =
    Settings(
        StationEntryState.typing("https://radio.example.com", stored = "https://radio.example.com"),
        SessionState.SignedOut,
        AccountState(email = "operator@example.com", challenge = SecondFactor("c_1", "totp-1"), error = Message.CodeRefused),
    )

@PreviewLightDark
@Composable
private fun OperatorPreview() =
    Settings(
        StationEntryState.typing("https://radio.example.com", stored = "https://radio.example.com"),
        SessionState.SignedIn("operator@example.com", setOf(PlatformRole.ADMIN)),
    )

@PreviewLightDark
@Composable
private fun EditedAddressPreview() =
    Settings(StationEntryState.from("https://other.example.com", StationCheck.Reachable("Other Station"), stored = "https://radio.example.com"), SessionState.SignedOut)

@PreviewLightDark
@Composable
private fun SetupPreview() {
    DeadairTheme { SetupScreen(StationEntryState.typing("http://10.0.2.2:8080"), onAddressChange = {}, onCheck = {}, onConfirm = {}) }
}

@PreviewLightDark
@Composable
private fun SetupRefusedPreview() {
    DeadairTheme {
        SetupScreen(StationEntryState.from("https://example.com", StationCheck.NotAStation(404)), onAddressChange = {}, onCheck = {}, onConfirm = {})
    }
}
