// The station's player, as a handful of C functions.
//
// AVFoundation is Objective-C with blocks and key-value observing, none of which crosses a P/Invoke
// boundary. This header is the whole surface the managed side sees: create, play, stop, destroy, and
// one callback for state changes. Everything Objective-C about it stays on this side of the line.
//
// Built by `build.sh` into `libdeadairplayer.dylib`.

#ifndef DEADAIR_PLAYER_H
#define DEADAIR_PLAYER_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/// What the player is doing. Mirrors `PlayerPhase` in the managed code, by value.
///
/// There is no `Paused`, deliberately: a live mount has no pause. Holding a connection open while
/// not listening still counts as an audience to the station's gate, so stopping drops it.
typedef enum {
    DA_PHASE_STOPPED = 0,
    DA_PHASE_OPENING = 1,
    DA_PHASE_BUFFERING = 2,
    DA_PHASE_PLAYING = 3,
    DA_PHASE_ENDED = 4,
    DA_PHASE_FAILED = 5
} da_phase;

/// Called on every state change, on an arbitrary thread.
///
/// `detail` is NULL unless the phase carries a reason, and is only valid for the duration of the
/// call: copy it if you need it. `context` is whatever was handed to `da_player_create`.
typedef void (*da_player_status_callback)(void *context, int phase, const char *detail);

/// Builds a player for one mount. Does not start it; call `da_player_play`.
///
/// `user_agent` is applied to every request the player makes, which matters more here than it looks:
/// the station counts an HLS listener per IP and agent, so a player sending a different agent from
/// the rest of the app is a second listener.
///
/// Returns NULL if `url` cannot be parsed.
void *da_player_create(const char *url, const char *user_agent, da_player_status_callback callback, void *context);

/// Starts, or restarts after a failure. Safe to call when already playing.
void da_player_play(void *handle);

/// Stops and DROPS the connection, rather than pausing it.
void da_player_stop(void *handle);

/// The current phase, for a caller that would rather ask than remember.
int da_player_phase(void *handle);

/// 0.0 to 1.0.
void da_player_set_volume(void *handle, double volume);

/// Stops, unsubscribes and frees. The handle is invalid afterwards.
void da_player_destroy(void *handle);

/// What a media key or the system Now Playing widget asked for.
///
/// `DA_COMMAND_NEXT` is the OPERATOR's skip rather than a track change: a live mount has no next
/// track. It is only offered while the account signed in holds the operator role, the same rule the
/// Android listener applies to a head unit's next button.
typedef enum {
    DA_COMMAND_PLAY = 0,
    DA_COMMAND_STOP = 1,
    DA_COMMAND_NEXT = 2
} da_command;

/// Called when the system asks for something, on an arbitrary thread.
typedef void (*da_command_callback)(void *context, int command);

/// Registers for media keys and the Now Playing widget's buttons.
///
/// Pass NULL to stop listening. Only one handler exists at a time.
void da_remote_set_handler(da_command_callback callback, void *context);

/// Whether to offer a next button at all.
///
/// A live stream has no next track, so the system offers none by default. Turning it on is what puts
/// the operator's Skip on a keyboard and in the widget, and it must be off for anybody who is only
/// listening — a skip they are not allowed to make would be refused by the station.
void da_remote_set_can_skip(bool can_skip);

/// Fills the system's Now Playing widget.
///
/// `artwork` is image bytes or NULL. Duration and position are seconds; pass a negative duration when
/// the station could not say, and the widget shows no scrubber rather than a wrong one.
void da_nowplaying_set(const char *title, const char *artist, const char *album,
                       const unsigned char *artwork, int artwork_length,
                       double duration_seconds, double position_seconds, bool playing);

/// Empties the widget, for a station that has stopped.
void da_nowplaying_clear(void);

/// Runs the calling thread's run loop for `seconds`.
///
/// AVFoundation drives its state machine on a run loop, so a host that has none — a console tool, a
/// test — sees a player that opens, reports buffering and then sits there forever. A GUI app has one
/// already and must NOT call this. It exists so that a headless caller can be honest about needing
/// one rather than concluding the player is broken.
void da_player_pump(double seconds);

#ifdef __cplusplus
}
#endif

#endif
