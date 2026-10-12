using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>
/// What the desk says when the operator asks the station to say something now.
/// </summary>
/// <remarks>
/// <para>
/// Either answer is said. An accepted request because the break is not heard until it has been
/// written and spoken, which is longer than a press should go unanswered; a decline with the station's
/// own reason, because "breaks are off" or "one went in a moment ago" is what the operator needs to
/// read. A decline is a 200 rather than a refusal, so it never reaches the failure path of
/// <see cref="OperatorActions"/> and has to be told.
/// </para>
/// <para>
/// Neither is a fault, so neither is drawn in the fault colour: a decline is the station working as
/// it was told to, and the words say why. The Android and iOS apps say the same sentences.
/// </para>
/// </remarks>
public static class BreakWords
{
    /// <summary>The notice an answer is said as.</summary>
    public static Notice Answer(RequestableBreakKind kind, StationBreakRequest answer)
    {
        ArgumentNullException.ThrowIfNull(answer);

        if (!answer.Accepted)
        {
            // The reason is the station's words: a clause in its own language, passed through rather
            // than rewritten.
            return new Notice.Said(
                string.IsNullOrWhiteSpace(answer.Reason) ? "The station declined to say anything just now." : $"The station declined: {answer.Reason}.",
                StatusTone.Standby);
        }

        return new Notice.Said(
            kind switch
            {
                RequestableBreakKind.News => "The news is on its way. It goes out once it has been written.",
                RequestableBreakKind.Weather => "The weather is on its way. It goes out once it has been written.",
                RequestableBreakKind.Talkbreak => "The host will have a word once it has been written.",
                _ => "The station will say it once it has been written.",
            },
            StatusTone.Ok);
    }
}
