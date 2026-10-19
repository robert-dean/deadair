package com.maroonedsoftware.deadair.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maroonedsoftware.deadair.wallpaper.ColorSource
import com.maroonedsoftware.deadair.wallpaper.CoverPlacement
import com.maroonedsoftware.deadair.wallpaper.WallpaperFollows
import com.maroonedsoftware.deadair.wallpaper.WallpaperIdle
import com.maroonedsoftware.deadair.widget.WidgetFollows
import com.maroonedsoftware.deadair.nowplaying.KeepAwake
import com.maroonedsoftware.deadair.auth.PasskeyAnswer
import com.maroonedsoftware.deadair.auth.SessionManager
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.settings.SettingsStore
import com.maroonedsoftware.deadair.station.ScannedCode
import com.maroonedsoftware.deadair.station.StationLink
import com.maroonedsoftware.deadair.station.StationProbe
import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.settings.ListenerSettings

/**
 * The address field, the format picker and the account, for the setup and settings screens.
 *
 * The account is here rather than in a model of its own because it belongs to the same screen and
 * to the same station: signing in is a thing you do to the address in the field above it, and a
 * second view model would need the first one's station to know where to send the password.
 */
class SettingsViewModel(
    private val store: SettingsStore,
    private val probe: StationProbe,
    private val sessions: SessionManager,
) : ViewModel() {
    private val _entry = MutableStateFlow(StationEntryState())
    val entry: StateFlow<StationEntryState> = _entry.asStateFlow()

    private val _proposal = MutableStateFlow<StationUrl?>(null)

    /**
     * A station a `deadair://` link proposed and nobody has answered yet. While it is set the setup
     * screen is shown over the app, whether or not a station is kept: asking is not switching.
     */
    val proposal: StateFlow<StationUrl?> = _proposal.asStateFlow()

    private val _account = MutableStateFlow(AccountState())
    val account: StateFlow<AccountState> = _account.asStateFlow()

    val session: StateFlow<SessionState> =
        sessions.state.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), SessionState.SignedOut)

    /**
     * `null` until the first read from disk has landed.
     *
     * Not an empty `ListenerSettings`: that has no station, and no station is what the setup
     * screen tests for — so every cold start drew Setup for a few frames before snapping to the
     * app proper. A reading that has not arrived yet is a different thing from one that says
     * there is no station, and the root draws nothing at all until it can tell which.
     */
    val settings: StateFlow<ListenerSettings?> =
        store.settings.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    fun onAddressChange(address: String) {
        _entry.value = StationEntryState.typing(address, stored = _entry.value.stored)
    }

    /**
     * A code has been scanned. A station's code fills the field and is checked at once, because
     * scanning is a deliberate act and the check is the next thing anybody would press. Nothing is
     * kept until Listen, exactly as for a typed address or a link.
     */
    fun scanned(text: String) {
        val station = ScannedCode.station(text)
        if (station == null) {
            _entry.value = StationEntryState.refusedScan(_entry.value, Message.NotAStationCode)
            return
        }
        _entry.value = StationEntryState.typing(station.origin, stored = _entry.value.stored)
        check()
    }

    fun scanFailed() {
        _entry.value = StationEntryState.refusedScan(_entry.value, Message.ScannerUnavailable)
    }

    /** Ask the address whether it is a station. Nothing is stored until it answers. */
    fun check() {
        val current = _entry.value
        val url = current.parsed
        if (url == null) {
            _entry.value = StationEntryState.invalid(current.address, current.stored)
            return
        }

        _entry.value = current.copy(checking = true, error = null, confirmedName = null)
        viewModelScope.launch {
            _entry.value = StationEntryState.from(current.address, probe.check(url), current.stored)
        }
    }

    /**
     * Keep the address that answered, and the name it answered with. Only reachable once `check`
     * has confirmed one.
     *
     * The field is reset to read as the kept address afterwards, so the button that offered to
     * keep it goes away: a button still offering "Use X" after X has been kept looks like an
     * unsaved change, and tapping it again did nothing anybody could see.
     */
    fun confirm() {
        val current = _entry.value
        val url = current.parsed ?: return
        viewModelScope.launch {
            store.setStation(url, current.confirmedName)
            _entry.value = StationEntryState.typing(url.origin, stored = url.origin)
            _proposal.value = null
        }
    }

    /**
     * Put a linked station in the field, and nothing else. It is checked and kept only when somebody
     * presses the buttons, so a link in an email cannot quietly repoint the app. The same station
     * as the one kept closes any question already open instead.
     */
    fun propose(link: StationUrl, kept: StationUrl?) {
        val proposed = StationLink.proposal(link, kept)
        _proposal.value = proposed
        _entry.value = if (proposed == null) keptEntry(kept) else StationEntryState.proposed(proposed, kept)
    }

    /** Turn a link's proposal down: the kept station stays, and so does the session with it. */
    fun keepCurrent(kept: StationUrl?) {
        _proposal.value = null
        _entry.value = keptEntry(kept)
    }

    private fun keptEntry(kept: StationUrl?) = kept?.let { StationEntryState.typing(it.origin, stored = it.origin) } ?: StationEntryState()

    fun setFormat(format: StreamFormat?) {
        viewModelScope.launch { store.setFormat(format) }
    }

    fun setDynamicColor(on: Boolean) {
        viewModelScope.launch { store.setDynamicColor(on) }
    }

    fun setWidgetFollows(follows: WidgetFollows) {
        viewModelScope.launch { store.setWidgetFollows(follows) }
    }

    fun setWallpaperFollows(follows: WallpaperFollows) {
        viewModelScope.launch { store.setWallpaperFollows(follows) }
    }

    fun setWallpaperIdle(idle: WallpaperIdle) {
        viewModelScope.launch { store.setWallpaperIdle(idle) }
    }

    fun setWallpaperPlacement(placement: CoverPlacement) {
        viewModelScope.launch { store.setWallpaperPlacement(placement) }
    }

    fun setColorSource(colors: ColorSource) {
        viewModelScope.launch { store.setColorSource(colors) }
    }

    fun setWallpaperColor(color: Int) {
        viewModelScope.launch { store.setWallpaperColor(color) }
    }

    fun setPlayOnOpen(on: Boolean) {
        viewModelScope.launch { store.setPlayOnOpen(on) }
    }

    fun setKeepAwake(keepAwake: KeepAwake) {
        viewModelScope.launch { store.setKeepAwake(keepAwake) }
    }

    fun onEmailChange(email: String) {
        _account.value = AccountState.typingEmail(_account.value, email)
    }

    fun onPasswordChange(password: String) {
        _account.value = AccountState.typingPassword(_account.value, password)
    }

    fun onCodeChange(code: String) {
        _account.value = AccountState.typingCode(_account.value, code)
    }

    /**
     * Sign in to the station this app is pointed at, or answer the challenge it asked for.
     *
     * One entry point for both steps because it is one button on one screen, and which exchange it
     * makes is decided by whether a challenge is pending rather than by the caller: a screen that
     * had to know would be a second copy of the answer, free to disagree with the first.
     *
     * The STORED station, not the one in the field: the field may be mid-edit, and a password sent
     * to a half-typed address is a password sent to whoever happens to own it.
     */
    fun signIn() {
        val station = settings.value?.station ?: return
        val current = _account.value
        if (!current.canSubmit) return

        _account.value = current.copy(busy = true, error = null)
        viewModelScope.launch {
            val email = current.email.trim()
            val answer =
                when (val challenge = current.challenge) {
                    null -> sessions.signIn(station, email, current.password)
                    is SecondFactor.Authenticator ->
                        sessions.completeSecondFactor(station, email, challenge.challengeId, challenge.methodId, current.code.trim())
                    is SecondFactor.Email ->
                        sessions.completeEmailCode(station, email, challenge.challengeId, challenge.emailChallengeId ?: return@launch, current.code.trim())
                    // The passkey step's button asks for the passkey again; there is nothing typed to send.
                    is SecondFactor.Passkey -> {
                        _account.value = AccountState.askingPasskeyAgain(current)
                        startPasskeyIfNeeded()
                        return@launch
                    }
                }
            _account.value = AccountState.from(_account.value, answer)
            sendCodeIfNeeded()
            startPasskeyIfNeeded()
        }
    }

    /** "Use a passkey instead", from the authenticator step. */
    fun usePasskey() {
        _account.value = AccountState.usingPasskey(_account.value)
        viewModelScope.launch { startPasskeyIfNeeded() }
    }

    /**
     * Ask the station to start the passkey assertion the screen is waiting on, if it is waiting on
     * one. Driven by the state, as [sendCodeIfNeeded] is. Once it has started, the screen raises the
     * prompt, because only it holds the activity the prompt is drawn over.
     */
    private suspend fun startPasskeyIfNeeded() {
        val station = settings.value?.station ?: return
        val waiting = _account.value
        if (!AccountState.needsPasskeyStarted(waiting)) return
        val challenge = waiting.challenge as? SecondFactor.Passkey ?: return
        val result = sessions.startPasskey(station, challenge.challengeId)
        if (_account.value.challenge?.challengeId != challenge.challengeId) return
        _account.value = AccountState.fromPasskeyStarted(_account.value, result)
    }

    /** What the passkey prompt answered. A signed assertion goes to the station to be checked. */
    fun onPasskeyAnswer(answer: PasskeyAnswer) {
        val station = settings.value?.station ?: return
        val next = AccountState.fromPasskeyAnswer(_account.value, answer)
        _account.value = next
        val challenge = next.challenge as? SecondFactor.Passkey ?: return
        val fidoChallengeId = challenge.fidoChallengeId ?: return
        if (answer !is PasskeyAnswer.Answered) return
        viewModelScope.launch {
            val result = sessions.completePasskey(station, next.email.trim(), challenge.challengeId, fidoChallengeId, answer.authenticationResponseJson)
            if (_account.value.challenge?.challengeId != challenge.challengeId) return@launch
            _account.value = AccountState.from(_account.value, result)
        }
    }

    /** "Email me a code instead", from the authenticator or the passkey step. */
    fun useEmail() {
        _account.value = AccountState.usingEmail(_account.value)
        viewModelScope.launch { sendCodeIfNeeded() }
    }

    /** "Send it again", for an emailed code that has not arrived. */
    fun sendCodeAgain() {
        _account.value = AccountState.sendingAgain(_account.value)
        viewModelScope.launch { sendCodeIfNeeded() }
    }

    /**
     * Ask the station to email the code the screen is waiting on, if it is waiting on one.
     *
     * Driven by the state rather than by whoever called, so the three ways into it (a challenge that
     * leads with email, choosing email, sending again) cannot disagree about when a send is due.
     */
    private suspend fun sendCodeIfNeeded() {
        val station = settings.value?.station ?: return
        val waiting = _account.value
        if (!AccountState.needsCodeSent(waiting)) return
        val challenge = waiting.challenge as? SecondFactor.Email ?: return
        val result = sessions.sendEmailCode(station, challenge.challengeId)
        // The challenge may have been abandoned while the send was in flight.
        if (_account.value.challenge?.challengeId != challenge.challengeId) return
        _account.value = AccountState.fromCodeSent(_account.value, result)
    }

    /**
     * "Forgot your password?": ask the station to email a reset link to the address typed.
     *
     * The STORED station, for the reason [signIn] gives. The link opens the station's web console,
     * so all this screen does afterwards is say to check the inbox.
     */
    fun askForReset() {
        val station = settings.value?.station ?: return
        val asking = AccountState.askingReset(_account.value)
        _account.value = asking
        if (!asking.busy) return
        viewModelScope.launch {
            val answer = sessions.askForReset(station, asking.email.trim())
            _account.value = AccountState.fromReset(_account.value, answer)
        }
    }

    /**
     * Abandon a pending challenge and go back to the password step.
     *
     * Nothing is told to the station: an MFA challenge is short-lived and single-use, and there is
     * no route to hand one back. It simply expires unanswered.
     */
    fun startAgain() {
        _account.value = AccountState.startAgain(_account.value)
    }

    fun signOut() {
        viewModelScope.launch {
            sessions.signOut()
            _account.value = AccountState()
        }
    }

    /**
     * Load the stored address into the field, for the settings screen's first frame.
     *
     * Marked as the one already kept, which is what keeps a Check button from appearing under an
     * address nobody has changed.
     */
    fun editExisting(address: String) {
        if (_entry.value.address.isEmpty()) _entry.value = StationEntryState.typing(address, stored = address)
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
