package com.maroonedsoftware.deadair.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maroonedsoftware.deadair.auth.SessionManager
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.settings.SettingsStore
import com.maroonedsoftware.deadair.station.StationProbe
import com.maroonedsoftware.deadair.station.StreamFormat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
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
        }
    }

    fun setFormat(format: StreamFormat) {
        viewModelScope.launch { store.setFormat(format) }
    }

    fun setDynamicColour(on: Boolean) {
        viewModelScope.launch { store.setDynamicColour(on) }
    }

    fun onEmailChange(email: String) {
        _account.value = AccountState.typingEmail(_account.value, email)
    }

    fun onPasswordChange(password: String) {
        _account.value = AccountState.typingPassword(_account.value, password)
    }

    /**
     * Sign in to the station this app is pointed at.
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
            _account.value = AccountState.from(_account.value, sessions.signIn(station, current.email.trim(), current.password))
        }
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
