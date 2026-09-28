namespace MaroonedSoftware.Deadair.Desktop.Core.Station;

/// <summary>
/// Which part of the setup screen is showing: the welcome, the address, or signing in to the station
/// the address found.
/// </summary>
/// <remarks>
/// The Android app's steps, for the same reason: an address box is a strange first thing to meet
/// in an app somebody has just installed to listen to the radio. Held by the setup screen rather than
/// pushed as a page, because setup sits above the page stack on purpose and nothing navigates to it.
/// </remarks>
public enum SetupStep
{
    Welcome,
    Station,

    /// <summary>
    /// Reached only from I run this station: sign in, once the station has been kept. Never where the
    /// screen opens, because an account belongs to a station and there is not one until the address
    /// has answered.
    /// </summary>
    SignIn,
}

/// <summary>Where the setup screen opens.</summary>
public static class SetupSteps
{
    /// <summary>
    /// The welcome on a first run; the address when somebody has already chosen to be asked for one.
    /// </summary>
    /// <param name="asking">
    /// Whether a <c>deadair://</c> link has put an address in the box, or Change station was pressed
    /// over a station that is still attached. A welcome in front of either is one more click for
    /// nothing: the first has chosen a station, and the second already knows the app.
    /// </param>
    public static SetupStep Initial(bool asking) => asking ? SetupStep.Station : SetupStep.Welcome;
}
