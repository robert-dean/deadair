package com.maroonedsoftware.deadair.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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

/** The address field and the format picker, for both the setup screen and the settings screen. */
class SettingsViewModel(
    private val store: SettingsStore,
    private val probe: StationProbe,
) : ViewModel() {
    private val _entry = MutableStateFlow(StationEntryState())
    val entry: StateFlow<StationEntryState> = _entry.asStateFlow()

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

    /** Load the stored address into the field, for the settings screen's first frame. */
    fun editExisting(address: String) {
        if (_entry.value.address.isEmpty()) _entry.value = StationEntryState.typing(address)
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
