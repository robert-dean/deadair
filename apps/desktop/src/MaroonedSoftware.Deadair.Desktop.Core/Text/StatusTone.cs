namespace MaroonedSoftware.Deadair.Desktop.Core.Text;

/// <summary>
/// The five states of a thing worth telling apart, and the app's ONLY vocabulary for them.
/// </summary>
/// <remarks>
/// <para>
/// Ported from the console's <c>status.ts</c>, including its central rule: <b>a tone is deliberately
/// not a colour</b>, and nothing outside the theme may name one for a status. The failure being
/// closed off is a screen deciding for itself that "misconfigured" is a bit red.
/// </para>
/// <para>
/// <see cref="Live"/> and <see cref="Fault"/> are both urgent and must never be drawn alike: one is
/// the station working and the other is the station broken, and red means ON AIR in a studio. The
/// pair below them is the one a console has no way to express without this: waiting for a listener
/// is not the same as being stood down, and drawing either as a fault makes a working station look
/// broken.
/// </para>
/// </remarks>
public enum StatusTone
{
    /// <summary>On air. The tally.</summary>
    Live,

    /// <summary>Working.</summary>
    Ok,

    /// <summary>Waiting for something ordinary, such as an audience.</summary>
    Standby,

    /// <summary>Broken, and somebody has to do something.</summary>
    Fault,

    /// <summary>Stood down. Not broken.</summary>
    Off,
}

/// <summary>
/// How badly something went, which is a different question from what state a thing is in.
/// </summary>
/// <remarks>
/// Both vocabularies are needed and they cannot be one, because they disagree about red: a lamp's
/// red means on air, while a failure's red means the hard failure. <see cref="Notice"/> is the arm
/// that is not a failure at all — a thing nobody has set up yet — and it exists because a list that
/// draws "you have not done this" in the same colour as "this broke" is one people learn to skim.
/// </remarks>
public enum Severity
{
    Failure,
    Warning,
    Notice,
}
