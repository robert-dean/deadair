using NowPlayingReading = MaroonedSoftware.Deadair.Sdk.Models.NowPlaying;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// A reading the hold has let through, and when the listener hears the moment it describes.
/// </summary>
/// <param name="Reading">The reading.</param>
/// <param name="HeardAt">When it was read plus <see cref="NowPlayingHold.NowPlayingLead"/>, or null when
/// the caller did not say when it was read; a playhead then has no anchor and draws nothing.</param>
public sealed record HeardReading(NowPlayingReading Reading, DateTimeOffset? HeardAt);
