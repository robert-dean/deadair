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

    val settings: StateFlow<ListenerSettings> =
        store.settings.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), ListenerSettings())

    fun onAddressChange(address: String) {
        _entry.value = StationEntryState.typing(address)
    }

    /** Ask the address whether it is a station. Nothing is stored until it answers. */
    fun check() {
        val address = _entry.value.address
        val url = StationEntryState.typing(address).parsed
        if (url == null) {
            _entry.value = StationEntryState.typing(address).copy(error = "That is not an address")
            return
        }

        _entry.value = _entry.value.copy(checking = true, error = null, confirmedName = null)
        viewModelScope.launch {
            _entry.value = StationEntryState.from(address, probe.check(url))
        }
    }

    /** Keep the address that answered. Only reachable once `check` has confirmed one. */
    fun confirm() {
        val url = _entry.value.parsed ?: return
        viewModelScope.launch { store.setStation(url) }
    }

    fun setFormat(format: StreamFormat) {
        viewModelScope.launch { store.setFormat(format) }
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
        val station = settings.value.station ?: return
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

    /** Load the stored address into the field, for the settings screen's first frame. */
    fun editExisting(address: String) {
        if (_entry.value.address.isEmpty()) _entry.value = StationEntryState.typing(address)
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
