using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playout;

/// <summary>
/// Turning the station's own answer about why it is quiet into something to draw.
/// </summary>
/// <remarks>
/// <para>
/// <b>The station composes the sentence and the client never rewrites it.</b> `silence` carries a
/// cause, a detail, a remedy and the full ordered list of gates, all in the station's words. A client
/// that reworded them would be a second opinion that can disagree with the first, and the whole point
/// of the endpoint is that there is one answer instead of three partial inferences.
/// </para>
/// <para>
/// So the only thing decided here is the TONE, and the mapping's difficult cases are the ones where
/// quiet is not a fault: waiting for an audience is the gate working, and being stood down is an
/// operator's choice.
/// </para>
/// </remarks>
public static class SilenceReading
{
    public static StatusTone ToneFor(SilenceCause cause) => cause switch
    {
        SilenceCause.Airing => StatusTone.Live,

        // Quiet on purpose. Neither is a fault, and drawing either as one sends an operator looking
        // for a problem that is a working station doing what it was told.
        SilenceCause.NoAudience => StatusTone.Standby,
        SilenceCause.StoodDown => StatusTone.Off,

        // Quiet for a moment. Something is happening and nobody has to do anything.
        SilenceCause.WarmingUp or SilenceCause.WaitingOnAudio or SilenceCause.NoProgramme => StatusTone.Standby,

        // Quiet because something broke.
        _ => StatusTone.Fault,
    };

    public static StatusTone ToneFor(SilenceState state) => state switch
    {
        SilenceState.Ok => StatusTone.Ok,

        // Its own state rather than a mild fault, which is the distinction the station's own vocabulary
        // insists on.
        SilenceState.Waiting => StatusTone.Standby,
        _ => StatusTone.Fault,
    };

    /// <summary>Whether this is worth putting in front of somebody at all.</summary>
    /// <remarks>
    /// A station that is airing has nothing to explain. Everything else does, including the states
    /// that are not faults, because "why is it quiet" is a question an operator asks about a working
    /// station as often as a broken one.
    /// </remarks>
    public static bool WorthShowing(StationSilence silence)
    {
        ArgumentNullException.ThrowIfNull(silence);
        return silence.Cause != SilenceCause.Airing;
    }
}
