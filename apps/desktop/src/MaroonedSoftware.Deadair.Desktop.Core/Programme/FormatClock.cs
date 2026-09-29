using System.Globalization;
using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Programme;

/// <summary>Which sentence a band is: the station's two shapes, with the common clock case split in two.</summary>
public enum BandWhen
{
    /// <summary>Every hour at a number of minutes past.</summary>
    Hourly,

    /// <summary>Once a day at a time.</summary>
    Daily,

    /// <summary>A spacing rule: every so many minutes, wherever that lands.</summary>
    Interval,
}

/// <summary>One mark on the format clock's dial.</summary>
/// <param name="Minute">Minutes past the hour, 0 to 59.</param>
/// <param name="Label">What the mark says beside it: <c>news :30</c>.</param>
/// <param name="Unproducible">Nothing on the station can make this, so it will be passed over.</param>
public sealed record DialMark(int Minute, string Label, bool Unproducible);

/// <summary>
/// A band as the editor holds it, with the station's rules for what can be sent.
/// </summary>
/// <remarks>
/// <para>
/// The fields are TEXT, as typed, because a box somebody is halfway through typing into is not yet a
/// number, and the dialog has to say what is wrong rather than quietly clamp it. <see cref="Problem"/>
/// is the web console's validation (a kind, and a time that is a time) plus the ranges its number
/// boxes enforce by construction: 0 to 59 minutes past, 1 to 720 minutes apart.
/// </para>
/// <para>
/// There is no overlap rule. Two bands wanting one boundary is settled by which is higher in the list,
/// which is what the arrows change; the station never refuses one for it.
/// </para>
/// </remarks>
public sealed record BandDraft
{
    /// <summary>The widest spacing the editor offers, which is twelve hours.</summary>
    public const int MaxEveryMinutes = 720;

    public string Kind { get; init; } = string.Empty;

    public BandWhen When { get; init; } = BandWhen.Hourly;

    /// <summary>Minutes past the hour, for an hourly band.</summary>
    public string Minute { get; init; } = "30";

    /// <summary>A time of day as <c>HH:MM</c>, for a daily band.</summary>
    public string Time { get; init; } = "09:00";

    /// <summary>Minutes apart, for an interval band.</summary>
    public string EveryMinutes { get; init; } = "90";

    /// <summary>The subject, or null for a band that covers whatever it finds.</summary>
    public string? TopicId { get; init; }

    public long Position { get; init; }

    public bool Enabled { get; init; } = true;

    /// <summary>
    /// A band as the editor opens on it, or a new one at the end of the list.
    /// </summary>
    /// <remarks>
    /// Half past for a new hourly band, which is where a bulletin usually goes and is well clear of the
    /// top of the hour a station tends to name itself at. Ninety minutes for a new interval.
    /// </remarks>
    public static BandDraft From(ClockBand? band, long position = 0)
    {
        if (band is null)
        {
            return new BandDraft { Position = position };
        }

        var when = band.At == ClockBandAt.Interval ? BandWhen.Interval : band.Hour is null ? BandWhen.Hourly : BandWhen.Daily;
        return new BandDraft
        {
            Kind = band.Kind,
            When = when,
            Minute = (band.Minute ?? 30).ToString(CultureInfo.InvariantCulture),
            Time = StationTime.Clock(((band.Hour ?? 9) * 60) + (band.Minute ?? 0)),
            EveryMinutes = Math.Round((band.EveryMs ?? (90 * 60_000)) / 60_000d).ToString(CultureInfo.InvariantCulture),
            TopicId = band.TopicId,
            Position = band.Position,
            Enabled = band.Enabled,
        };
    }

    /// <summary>The first thing stopping this being sent, in words, or null.</summary>
    public string? Problem()
    {
        if (string.IsNullOrWhiteSpace(Kind))
        {
            return "A band needs a sort of break.";
        }

        return When switch
        {
            BandWhen.Hourly when Whole(Minute) is not (>= 0 and <= 59) => "Minutes past the hour are 0 to 59.",
            BandWhen.Daily when StationTime.ParseClock(Time) is null => "A time, as 24-hour HH:MM.",
            BandWhen.Interval when Whole(EveryMinutes) is not (>= 1 and <= MaxEveryMinutes) => "Minutes apart are 1 to 720.",
            _ => null,
        };
    }

    /// <summary>
    /// What is sent, or null while <see cref="Problem"/> has something to say.
    /// </summary>
    /// <remarks>
    /// Only the half the shape carries: an hourly band sends no hour, an interval sends no minute. An
    /// empty subject is dropped rather than sent as an empty string, because absent means the break
    /// covers whatever it finds, which is a different thing from a subject nothing can resolve.
    /// </remarks>
    public ClockBandInput? ToInput()
    {
        if (Problem() is not null)
        {
            return null;
        }

        var kind = Kind.Trim();
        var topic = string.IsNullOrEmpty(TopicId) ? null : TopicId;

        switch (When)
        {
            case BandWhen.Interval:
                return new ClockBandInput
                {
                    Kind = kind,
                    At = ClockBandAt.Interval,
                    EveryMs = Whole(EveryMinutes)!.Value * 60_000L,
                    TopicId = topic,
                    Position = Position,
                    Enabled = Enabled,
                };
            case BandWhen.Daily:
                var minutes = StationTime.ParseClock(Time)!.Value;
                return new ClockBandInput
                {
                    Kind = kind,
                    At = ClockBandAt.Clock,
                    Hour = minutes / 60,
                    Minute = minutes % 60,
                    TopicId = topic,
                    Position = Position,
                    Enabled = Enabled,
                };
            default:
                return new ClockBandInput
                {
                    Kind = kind,
                    At = ClockBandAt.Clock,
                    Minute = Whole(Minute)!.Value,
                    TopicId = topic,
                    Position = Position,
                    Enabled = Enabled,
                };
        }
    }

    private static int? Whole(string text) =>
        int.TryParse(text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var value) ? value : null;
}

/// <summary>
/// The format clock's rules that are not a single band's.
/// </summary>
public static class FormatClock
{
    /// <summary>
    /// The one kind the station can produce and a band should never ask for: a greeting is asked for
    /// when somebody tunes in, so a rule that fires at half past is a welcome to nobody.
    /// </summary>
    public const string WelcomeKind = "welcome";

    /// <summary>When a band fires, as the list says it: <c>:30</c>, <c>09:00</c>, <c>every 20m</c>.</summary>
    public static string WhenOf(ClockBand band)
    {
        ArgumentNullException.ThrowIfNull(band);

        if (band.At == ClockBandAt.Interval)
        {
            return string.Create(CultureInfo.InvariantCulture, $"every {Math.Round((band.EveryMs ?? 0) / 60_000d)}m");
        }

        var minute = (band.Minute ?? 0).ToString("00", CultureInfo.InvariantCulture);
        return band.Hour is { } hour ? string.Create(CultureInfo.InvariantCulture, $"{hour:00}:{minute}") : $":{minute}";
    }

    /// <summary>
    /// A band as the shape a write takes: everything but the id.
    /// </summary>
    /// <remarks>
    /// The subject goes back too. <c>PUT</c> replaces the row, so a reorder that sent only the
    /// position would quietly turn a technology bulletin into a general one.
    /// </remarks>
    public static ClockBandInput BodyOf(ClockBand band, long? position = null)
    {
        ArgumentNullException.ThrowIfNull(band);

        return new ClockBandInput
        {
            Kind = band.Kind,
            At = band.At,
            Hour = band.Hour,
            Minute = band.Minute,
            EveryMs = band.EveryMs,
            TopicId = band.TopicId,
            Position = position ?? band.Position,
            Enabled = band.Enabled,
        };
    }

    /// <summary>
    /// The two writes that swap a band with its neighbour, or none at an end of the list.
    /// </summary>
    /// <remarks>
    /// Each takes the other's POSITION rather than being renumbered, so a move is exactly the two rows
    /// that changed and cannot reorder the list underneath somebody else's edit.
    /// </remarks>
    public static IReadOnlyList<(string Id, ClockBandInput Body)> Swap(IReadOnlyList<ClockBand> bands, int index, int by)
    {
        ArgumentNullException.ThrowIfNull(bands);

        var other = index + by;
        if (index < 0 || index >= bands.Count || other < 0 || other >= bands.Count || by == 0)
        {
            return [];
        }

        var band = bands[index];
        var neighbour = bands[other];
        return
        [
            (band.Id, BodyOf(band, neighbour.Position)),
            (neighbour.Id, BodyOf(neighbour, band.Position)),
        ];
    }

    /// <summary>The next position at the end of the list, for a new band.</summary>
    public static long NextPosition(IReadOnlyList<ClockBand> bands) =>
        bands is { Count: > 0 } ? bands.Max(band => band.Position) + 1 : 0;

    /// <summary>
    /// The kinds offered as suggestions: the station's own answer, without the greeting.
    /// </summary>
    /// <remarks>
    /// Suggestions and not a menu. The kind is free text on purpose, so a station that wants sponsor
    /// spots writes <c>sponsor</c> and drops the recordings in; a closed list would remove that.
    /// </remarks>
    public static IReadOnlyList<string> Kinds(IEnumerable<string> producible) =>
        [.. producible.Where(kind => !string.Equals(kind, WelcomeKind, StringComparison.Ordinal))];

    /// <summary>
    /// The subjects a band of this kind can be about.
    /// </summary>
    /// <remarks>
    /// A subject the station keeps off the air names what a break may never say, so a band pointed at
    /// one could only ever decline its slot. The flag is the kind's own config field, read by name.
    /// </remarks>
    public static IReadOnlyList<Topic> Subjects(IEnumerable<Topic> topics, string kind)
    {
        ArgumentNullException.ThrowIfNull(topics);

        var wanted = (kind ?? string.Empty).Trim();
        return [.. topics.Where(topic => topic.Kind == wanted && !IsOffAir(topic))];
    }

    /// <summary>
    /// The marks the dial draws: every enabled band with a place on the hour.
    /// </summary>
    /// <remarks>
    /// An interval band is a spacing rule with no fixed place on a dial, so it is not drawn; putting it
    /// at an arbitrary angle would be the drawing inventing a precision the rule does not have. A band
    /// for one hour of the day is drawn like any other: the dial is one hour of the face, and where a
    /// rule falls inside it is the same answer either way.
    /// </remarks>
    public static IReadOnlyList<DialMark> Marks(IEnumerable<ClockBand> bands, IReadOnlyCollection<string>? producible)
    {
        ArgumentNullException.ThrowIfNull(bands);

        return
        [
            .. bands
                .Where(band => band.At == ClockBandAt.Clock && band.Enabled)
                .Select(band =>
                {
                    var minute = (int)Math.Clamp(band.Minute ?? 0, 0, 59);
                    return new DialMark(
                        minute,
                        string.Create(CultureInfo.InvariantCulture, $"{band.Kind} :{minute:00}"),
                        !CanProduce(band.Kind, producible));
                }),
        ];
    }

    /// <summary>
    /// Whether the station can make a kind. An unanswered list says nothing, so it counts as yes:
    /// warning about every band because a read failed would be the page inventing a fault.
    /// </summary>
    public static bool CanProduce(string kind, IReadOnlyCollection<string>? producible) =>
        producible is null || producible.Contains(kind);

    private static bool IsOffAir(Topic topic) =>
        topic.Config.TryGetValue("offAir", out var value) && value.ValueKind == JsonValueKind.True;
}
