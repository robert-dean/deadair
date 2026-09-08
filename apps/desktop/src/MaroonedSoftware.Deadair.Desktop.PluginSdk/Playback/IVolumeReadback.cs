namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

/// <summary>
/// Implemented by a player whose volume is somebody else's to know.
/// </summary>
/// <remarks>
/// <para>
/// Optional, and only network devices need it. A local player's volume is whatever it was last set
/// to and is known the moment the app starts; a speaker's is a fact about the speaker, which nothing
/// knows until it has been asked, and which a hand on the physical dial can change underneath the
/// app.
/// </para>
/// <para>
/// The slider is DISABLED while <see cref="VolumeKnown"/> is false rather than drawn at zero,
/// because a slider at zero reads as silence rather than as a question nobody has asked yet.
/// </para>
/// </remarks>
public interface IVolumeReadback
{
    /// <summary>False until the device has said how loud it is.</summary>
    bool VolumeKnown { get; }

    /// <summary>
    /// Raised when the device's own volume changed, including when somebody turned a knob. On an
    /// arbitrary thread, like every other report a player makes.
    /// </summary>
    event Action? VolumeChanged;
}
