namespace MaroonedSoftware.Deadair.Desktop.Core.Playout;

/// <summary>
/// A button that has to be pressed twice, and disarms itself.
/// </summary>
/// <remarks>
/// Stop takes the station off the air. It is one press away from every other transport control and
/// there is no undo, so the first press arms and the second confirms — the arrangement the web
/// console uses, for the same reason.
///
/// It disarms on its own after a few seconds, so a half-pressed Stop nobody meant does not sit there
/// waiting to be completed by an unrelated click a minute later.
/// </remarks>
public sealed class ArmedStop(TimeProvider? time = null)
{
    private static readonly TimeSpan Window = TimeSpan.FromSeconds(5);

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private DateTimeOffset? _armedAt;

    public bool IsArmed(DateTimeOffset? now = null)
    {
        if (_armedAt is not { } armed)
        {
            return false;
        }

        var moment = now ?? _time.GetUtcNow();
        if (moment - armed <= Window)
        {
            return true;
        }

        _armedAt = null;
        return false;
    }

    /// <summary>Registers a press. True means "do it".</summary>
    public bool Press(DateTimeOffset? now = null)
    {
        var moment = now ?? _time.GetUtcNow();

        if (IsArmed(moment))
        {
            _armedAt = null;
            return true;
        }

        _armedAt = moment;
        return false;
    }

    public void Disarm() => _armedAt = null;
}
