using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>
/// What the desk says about the station's air: who is driving it, and whether the schedule may take
/// it back.
/// </summary>
/// <remarks>
/// <para>
/// The words are the web console's, ported rather than rewritten, because the same operator reads
/// both and a desk that says "You put this on" in one place and "operator" in the other is two
/// answers to one question.
/// </para>
/// <para>
/// "Who is driving" is a sentence with a subject rather than the station's own word. `sustaining`
/// and `operator` are states the reader would have to be taught, and the badge is the one place
/// there is no room to teach them.
/// </para>
/// </remarks>
public static class AirWords
{
    /// <summary>The badge's words for who chose what is on air. Null when the station is stood down.</summary>
    public static string? Driving(AirSource source) => source switch
    {
        AirSource.Operator => "You put this on",
        AirSource.Sustaining => "Between blocks",
        AirSource.Schedule => "The schedule put this on",
        _ => null,
    };

    /// <summary>
    /// What that means, including the part an operator cannot see coming.
    /// </summary>
    /// <remarks>
    /// The operator's sentence is the one worth the tooltip: a broadcast put on by hand is stamped
    /// with whichever slot is in force, so it holds until the NEXT block begins and is then replaced.
    /// That is correct and invisible, which is the combination worth saying out loud.
    /// </remarks>
    public static string? DrivingHint(AirSource source) => source switch
    {
        AirSource.Operator => "You put this on. It holds until the next scheduled block begins, and the schedule takes over then.",
        AirSource.Sustaining => "Nothing is scheduled right now, so the station is playing what it fills the gaps with.",
        AirSource.Schedule => "The clock changed the station over to this block. It runs until the block ends.",
        _ => null,
    };

    /// <summary>
    /// Whether holding the station against the schedule means anything.
    /// </summary>
    /// <remarks>
    /// Only while a person is driving: holding the schedule off a broadcast the schedule itself put
    /// on is not a thing anybody wants. A HELD station is offered its release whatever the source
    /// says, because a hold that cannot be seen or undone is worse than none.
    /// </remarks>
    public static bool OffersHold(AirSource source, bool held) => held || source == AirSource.Operator;

    /// <summary>
    /// The sentence beside the hold's controls, which is the state the controls change.
    /// </summary>
    /// <param name="holdUntil">
    /// The station's ISO-8601 instant. Absent WHILE held is the hold that never lapses, which is a
    /// real state rather than a missing value.
    /// </param>
    /// <param name="culture">The clock convention to say a time in; the Mac's own by default.</param>
    public static string Hold(bool held, string? holdUntil, CultureInfo? culture = null)
    {
        if (!held)
        {
            return "The schedule takes this back at the next block.";
        }

        // An instant the station wrote that does not parse is said as the open-ended hold rather
        // than as a time nobody can read. Releasing it works the same either way.
        if (holdUntil is null
            || !DateTimeOffset.TryParse(holdUntil, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var until))
        {
            return "Held until you release it. The schedule will not take this back.";
        }

        return $"Held until about {ClockFormat.WallClock(until.ToLocalTime(), culture)}.";
    }

    /// <summary>What each air mode is called on the desk, completing "On air".</summary>
    public static string Mode(AirMode mode) => mode == AirMode.Always ? "always" : "when somebody is listening";

    /// <summary>
    /// What changing the air mode will do, for the question asked before it is changed.
    /// </summary>
    /// <remarks>
    /// Changing it changes what airs: `always` puts a station with a programme on air with nobody
    /// listening, and `audience` takes an unheard one off at the end of its linger.
    /// </remarks>
    public static string ModeConsequence(AirMode mode) => mode == AirMode.Always
        ? "The station goes on air whenever it has a programme, whether or not anybody is listening."
        : "The station goes on air only while somebody is listening, and goes quiet a few minutes after the last one leaves.";
}
