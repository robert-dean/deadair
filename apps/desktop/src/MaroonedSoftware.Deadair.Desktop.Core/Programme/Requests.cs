using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Programme;

/// <summary>
/// A listener's request, as the operator's list says it.
/// </summary>
/// <remarks>
/// <para>
/// The web console's requests panel, ported. Open requests are the ones with a decision still to
/// make; <c>waiting</c> is drawn in the attention tone because it is the one state waiting on the
/// person looking at the list. Grant is offered only while a request is waiting, and Decline while it
/// is waiting or on its way; one already in the running order is taken out from the desk, where the
/// order is, so the list names the states that CAN be decided rather than the ones that cannot.
/// </para>
/// <para>
/// The dedication and message are the listener's own words, shown as theirs so an operator can decide
/// on them before the presenter passes them on.
/// </para>
/// </remarks>
public static class Requests
{
    /// <summary>The web console's own sentence for somebody without the role, in place of the list.</summary>
    public const string Forbidden = "Listener requests are for the station’s operators to decide on.";

    /// <summary>Whether a request still has a decision to make, or is on its way to the air.</summary>
    public static bool IsOpen(RequestStatus status) => status is RequestStatus.Waiting or RequestStatus.Pending or RequestStatus.Queued;

    public static bool CanGrant(RequestStatus status) => status == RequestStatus.Waiting;

    public static bool CanDecline(RequestStatus status) => status is RequestStatus.Waiting or RequestStatus.Pending;

    /// <summary>A state in the station's words.</summary>
    public static string Status(RequestStatus status) => status switch
    {
        RequestStatus.Waiting => "Needs a decision",
        RequestStatus.Pending => "On its way",
        RequestStatus.Queued => "In the running order",
        RequestStatus.Aired => "Played",
        RequestStatus.Declined => "Declined",
        RequestStatus.Expired => "Lapsed",
        _ => status.ToString(),
    };

    /// <summary>The tone a state is drawn in.</summary>
    public static StatusTone Tone(RequestStatus status) => status switch
    {
        RequestStatus.Waiting => StatusTone.Fault,
        RequestStatus.Pending => StatusTone.Standby,
        RequestStatus.Queued => StatusTone.Ok,
        _ => StatusTone.Off,
    };

    /// <summary>The listener's dedication and message in one sentence, or null when they left both out.</summary>
    public static string? Dedication(ListenerRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return (request.DedicateTo, request.Message) switch
        {
            (null, null) => null,
            (null, { } message) => $"Dedicated: “{message}”",
            ({ } name, null) => $"For {name}",
            ({ } name, { } message) => $"For {name}: “{message}”",
        };
    }

    /// <summary>Where it came from, and when.</summary>
    public static string From(RequestSource source, string when) =>
        source == RequestSource.Chat ? $"From a chat, {when}" : $"From an app, {when}";

    /// <summary>What declining tells the listener, which depends on where they asked.</summary>
    public static string Told(ListenerRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return request.Source == RequestSource.Chat
            ? $"{request.RequesterName} is told it will not be played, in the chat they asked from."
            : $"{request.RequesterName} is told it will not be played.";
    }
}
