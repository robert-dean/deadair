// The macOS half of `IStationPlayer`: AVFoundation, wrapped so the managed side sees C.
//
// Why AVFoundation rather than a bundled engine: it plays an ICY MP3 mount and an HLS playlist
// natively, reconnects on its own, and ships with the operating system — so there is no libvlc to
// bundle, and no Apple Silicon dylib question to answer at packaging time.
//
// Why a shim rather than the `net10.0-macos` target framework and Microsoft's typed bindings: this
// keeps the app on one plain `net10.0` target, needs no workload on a developer's machine or on CI,
// and is the same arrangement Avalonia itself uses for `libAvaloniaNative`. The cost is this file.

#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>

#include "DeadairPlayer.h"

static void *kTimeControlContext = &kTimeControlContext;
static void *kItemStatusContext = &kItemStatusContext;

@interface DeadairPlayer : NSObject

@property(nonatomic, strong) AVPlayer *player;
@property(nonatomic, strong) NSURL *url;
@property(nonatomic, copy) NSString *userAgent;
@property(nonatomic, assign) da_player_status_callback callback;
@property(nonatomic, assign) void *context;
@property(nonatomic, assign) da_phase phase;

/// Whether a `stop` was asked for, so the teardown that follows is not reported as a failure.
@property(nonatomic, assign) BOOL stopping;

@end

@implementation DeadairPlayer

- (instancetype)initWithURL:(NSURL *)url
                  userAgent:(NSString *)userAgent
                   callback:(da_player_status_callback)callback
                    context:(void *)context {
    self = [super init];
    if (self) {
        _url = url;
        _userAgent = [userAgent copy];
        _callback = callback;
        _context = context;
        _phase = DA_PHASE_STOPPED;
        _stopping = NO;
        _player = [[AVPlayer alloc] init];

        // The station is live: there is nothing to catch up to, and a player that tries will
        // resample music to do it. Pinning the rate keeps it at 1.0.
        _player.automaticallyWaitsToMinimizeStalling = YES;

        [_player addObserver:self
                  forKeyPath:@"timeControlStatus"
                     options:NSKeyValueObservingOptionNew
                     context:kTimeControlContext];

        // AVFoundation does not reliably report a failure of its own when the Mac sleeps mid-stream,
        // so a player left `PLAYING` or `BUFFERING` at wake looks fine to anything only watching the
        // phase. Reporting the wake itself as a failure is what lets the conductor's scheduled retry
        // restart the stream at the live edge instead of leaving a stalled player nobody notices.
        // Posted on the workspace's own notification centre, NOT the default one.
        [[[NSWorkspace sharedWorkspace] notificationCenter] addObserver:self
                                                                selector:@selector(workspaceDidWake:)
                                                                    name:NSWorkspaceDidWakeNotification
                                                                  object:nil];
    }
    return self;
}

- (void)report:(da_phase)phase detail:(NSString *)detail {
    if (_phase == phase) {
        return;
    }
    _phase = phase;
    if (_callback != NULL) {
        _callback(_context, (int)phase, detail == nil ? NULL : [detail UTF8String]);
    }
}

- (void)play {
    _stopping = NO;

    // A fresh item every time. Re-preparing a failed one does not clear its status, and after a
    // `stop` there is no item at all: stopping drops the connection rather than pausing it, because
    // a held connection is still an audience to the station's gate.
    NSDictionary *options = @{};
    if (_userAgent.length > 0) {
        // Public since macOS 13, and the only supported way to set this. The older trick of stuffing
        // `AVURLAssetHTTPHeaderFieldsKey` is undocumented and applies to range requests alone, so the
        // request that actually carries the audio goes out as AppleCoreMedia and is counted as a
        // different listener from the rest of the app.
        options = @{AVURLAssetHTTPUserAgentKey : _userAgent};
    }

    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:_url options:options];
    AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:asset];

    AVPlayerItem *previous = _player.currentItem;
    if (previous != nil) {
        [previous removeObserver:self forKeyPath:@"status" context:kItemStatusContext];
        [[NSNotificationCenter defaultCenter] removeObserver:self name:nil object:previous];
    }

    [item addObserver:self
           forKeyPath:@"status"
              options:NSKeyValueObservingOptionNew
              context:kItemStatusContext];

    NSNotificationCenter *centre = [NSNotificationCenter defaultCenter];
    [centre addObserver:self selector:@selector(itemEnded:) name:AVPlayerItemDidPlayToEndTimeNotification object:item];
    [centre addObserver:self selector:@selector(itemFailed:) name:AVPlayerItemFailedToPlayToEndTimeNotification object:item];
    [centre addObserver:self selector:@selector(itemStalled:) name:AVPlayerItemPlaybackStalledNotification object:item];

    // Reported before the first byte, so a caller can draw warm-up rather than an empty state. On an
    // audience-gated station this is not merely cosmetic: connecting is what puts it on air, so the
    // first seconds legitimately carry no audio and are not an error.
    [self report:DA_PHASE_OPENING detail:nil];

    [_player replaceCurrentItemWithPlayerItem:item];
    [_player play];
}

- (void)stop {
    _stopping = YES;

    AVPlayerItem *item = _player.currentItem;
    if (item != nil) {
        [item removeObserver:self forKeyPath:@"status" context:kItemStatusContext];
        [[NSNotificationCenter defaultCenter] removeObserver:self name:nil object:item];
    }

    [_player pause];

    // The line that matters. Pausing a live mount holds the socket open, and the station counts that
    // connection as an audience for a five-minute linger — so a "stopped" client would keep an
    // audience-gated station on air with nobody listening.
    [_player replaceCurrentItemWithPlayerItem:nil];

    [self report:DA_PHASE_STOPPED detail:nil];
}

- (void)itemEnded:(NSNotification *)note {
    // A live mount does not end on its own, so this is the stream going away.
    [self report:DA_PHASE_ENDED detail:@"The stream ended."];
}

- (void)itemFailed:(NSNotification *)note {
    NSError *error = note.userInfo[AVPlayerItemFailedToPlayToEndTimeErrorKey];
    [self report:DA_PHASE_FAILED detail:error != nil ? error.localizedDescription : @"Playback failed."];
}

- (void)itemStalled:(NSNotification *)note {
    if (!_stopping) {
        [self report:DA_PHASE_BUFFERING detail:@"The stream stalled."];
    }
}

- (void)workspaceDidWake:(NSNotification *)note {
    // Only a stream that was audibly playing, or trying to be, is worth restarting. One that was
    // already stopped, ended or failed needs nothing further from a wake.
    if (_phase == DA_PHASE_PLAYING || _phase == DA_PHASE_BUFFERING) {
        [self report:DA_PHASE_FAILED detail:@"The Mac woke from sleep."];
    }
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context {
    if (context == kTimeControlContext) {
        if (_stopping) {
            return;
        }
        switch (_player.timeControlStatus) {
            case AVPlayerTimeControlStatusPlaying:
                [self report:DA_PHASE_PLAYING detail:nil];
                break;
            case AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate:
                [self report:DA_PHASE_BUFFERING detail:nil];
                break;
            case AVPlayerTimeControlStatusPaused:
                // Reached on the way down from a failure as well as from a stop, so it is not
                // reported as a phase of its own: whatever caused it has already said so.
                break;
        }
        return;
    }

    if (context == kItemStatusContext) {
        AVPlayerItem *item = (AVPlayerItem *)object;
        if (item.status == AVPlayerItemStatusFailed) {
            NSError *error = item.error;
            [self report:DA_PHASE_FAILED detail:error != nil ? error.localizedDescription : @"The item failed to load."];
        }
        return;
    }

    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}

- (void)teardown {
    [self stop];
    [_player removeObserver:self forKeyPath:@"timeControlStatus" context:kTimeControlContext];
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self];
    _callback = NULL;
    _player = nil;
}

@end

void *da_player_create(const char *url, const char *user_agent, da_player_status_callback callback, void *context) {
    @autoreleasepool {
        if (url == NULL) {
            return NULL;
        }
        NSURL *parsed = [NSURL URLWithString:[NSString stringWithUTF8String:url]];
        if (parsed == nil) {
            return NULL;
        }
        NSString *agent = user_agent == NULL ? @"" : [NSString stringWithUTF8String:user_agent];
        DeadairPlayer *player = [[DeadairPlayer alloc] initWithURL:parsed userAgent:agent callback:callback context:context];

        // Handed to a caller that is not ARC, so the retain has to be manual and is released by
        // `da_player_destroy`.
        return (void *)CFBridgingRetain(player);
    }
}

void da_player_play(void *handle) {
    @autoreleasepool {
        if (handle == NULL) {
            return;
        }
        [(__bridge DeadairPlayer *)handle play];
    }
}

void da_player_stop(void *handle) {
    @autoreleasepool {
        if (handle == NULL) {
            return;
        }
        [(__bridge DeadairPlayer *)handle stop];
    }
}

int da_player_phase(void *handle) {
    if (handle == NULL) {
        return DA_PHASE_STOPPED;
    }
    return (int)((__bridge DeadairPlayer *)handle).phase;
}

void da_player_set_volume(void *handle, double volume) {
    @autoreleasepool {
        if (handle == NULL) {
            return;
        }
        ((__bridge DeadairPlayer *)handle).player.volume = (float)volume;
    }
}

#pragma mark - The system's Now Playing widget, and the media keys

static da_command_callback g_command_callback = NULL;
static void *g_command_context = NULL;
static BOOL g_commands_registered = NO;

static void da_report_command(da_command command) {
    if (g_command_callback != NULL) {
        g_command_callback(g_command_context, (int)command);
    }
}

void da_remote_set_handler(da_command_callback callback, void *context) {
    @autoreleasepool {
        g_command_callback = callback;
        g_command_context = context;

        if (callback == NULL) {
            return;
        }

        if (g_commands_registered) {
            return;
        }
        g_commands_registered = YES;

        MPRemoteCommandCenter *centre = [MPRemoteCommandCenter sharedCommandCenter];

        [centre.playCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            da_report_command(DA_COMMAND_PLAY);
            return MPRemoteCommandHandlerStatusSuccess;
        }];

        // Pause and stop are the same thing here, and both DROP the connection. A live mount cannot
        // be paused: holding it open is still an audience as far as the station's gate is concerned.
        [centre.pauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            da_report_command(DA_COMMAND_STOP);
            return MPRemoteCommandHandlerStatusSuccess;
        }];
        [centre.stopCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            da_report_command(DA_COMMAND_STOP);
            return MPRemoteCommandHandlerStatusSuccess;
        }];

        // The headphone button, which toggles rather than naming a direction.
        [centre.togglePlayPauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            MPNowPlayingInfoCenter *info = [MPNowPlayingInfoCenter defaultCenter];
            da_report_command(info.playbackState == MPNowPlayingPlaybackStatePlaying ? DA_COMMAND_STOP : DA_COMMAND_PLAY);
            return MPRemoteCommandHandlerStatusSuccess;
        }];

        [centre.nextTrackCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            da_report_command(DA_COMMAND_NEXT);
            return MPRemoteCommandHandlerStatusSuccess;
        }];

        // Off until somebody signs in as the operator. A live stream has no next track, so this is
        // the one command whose presence is a statement about the ACCOUNT rather than about the
        // player.
        centre.nextTrackCommand.enabled = NO;

        // Never offered: there is no previous on a live mount, and a system that drew the button
        // would be promising something the station cannot do.
        centre.previousTrackCommand.enabled = NO;
        centre.seekForwardCommand.enabled = NO;
        centre.seekBackwardCommand.enabled = NO;
        centre.changePlaybackPositionCommand.enabled = NO;
    }
}

void da_remote_set_can_skip(bool can_skip) {
    @autoreleasepool {
        [MPRemoteCommandCenter sharedCommandCenter].nextTrackCommand.enabled = can_skip ? YES : NO;
    }
}

void da_nowplaying_set(const char *title, const char *artist, const char *album,
                       const unsigned char *artwork, int artwork_length,
                       double duration_seconds, double position_seconds, bool playing) {
    @autoreleasepool {
        MPNowPlayingInfoCenter *centre = [MPNowPlayingInfoCenter defaultCenter];
        NSMutableDictionary *info = [NSMutableDictionary dictionary];

        if (title != NULL) {
            info[MPMediaItemPropertyTitle] = [NSString stringWithUTF8String:title];
        }
        if (artist != NULL) {
            info[MPMediaItemPropertyArtist] = [NSString stringWithUTF8String:artist];
        }
        if (album != NULL) {
            info[MPMediaItemPropertyAlbumTitle] = [NSString stringWithUTF8String:album];
        }

        // A negative duration means the station could not say. Leaving both keys out is what makes
        // the widget draw no scrubber, rather than one sitting at zero and looking stuck.
        if (duration_seconds >= 0) {
            info[MPMediaItemPropertyPlaybackDuration] = @(duration_seconds);
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position_seconds);
        }

        info[MPNowPlayingInfoPropertyPlaybackRate] = @(playing ? 1.0 : 0.0);
        info[MPNowPlayingInfoPropertyIsLiveStream] = @YES;

        if (artwork != NULL && artwork_length > 0) {
            NSData *data = [NSData dataWithBytes:artwork length:(NSUInteger)artwork_length];
            NSImage *image = [[NSImage alloc] initWithData:data];
            if (image != nil) {
                info[MPMediaItemPropertyArtwork] =
                    [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size
                                                    requestHandler:^NSImage *(CGSize size) {
                                                        return image;
                                                    }];
            }
        }

        centre.nowPlayingInfo = info;
        centre.playbackState = playing ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStateStopped;
    }
}

void da_nowplaying_clear(void) {
    @autoreleasepool {
        MPNowPlayingInfoCenter *centre = [MPNowPlayingInfoCenter defaultCenter];
        centre.nowPlayingInfo = nil;
        centre.playbackState = MPNowPlayingPlaybackStateStopped;
    }
}

void da_player_pump(double seconds) {
    @autoreleasepool {
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];

        // The timer is not decoration. A run loop with no input source attached returns from
        // `runUntilDate:` IMMEDIATELY rather than waiting, so the first version of this function
        // looked like it had run for twenty seconds and had in fact returned in a hundredth of one.
        // Something has to be attached for the loop to have anything to service.
        NSTimer *keepAlive = [NSTimer timerWithTimeInterval:0.05
                                                    repeats:YES
                                                      block:^(NSTimer *timer) {
                                                      }];
        [[NSRunLoop currentRunLoop] addTimer:keepAlive forMode:NSDefaultRunLoopMode];

        while ([deadline timeIntervalSinceNow] > 0) {
            @autoreleasepool {
                [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:deadline];
            }
        }

        [keepAlive invalidate];
    }
}

void da_player_destroy(void *handle) {
    @autoreleasepool {
        if (handle == NULL) {
            return;
        }
        DeadairPlayer *player = (DeadairPlayer *)CFBridgingRelease(handle);
        [player teardown];
    }
}
