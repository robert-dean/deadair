using MaroonedSoftware.Deadair.Desktop.PluginSdk;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;

/// <summary>
/// Sends the volume a player should be at, without sending every value on the way there.
/// </summary>
/// <remarks>
/// <para>
/// A slider dragged across its travel is dozens of values in a second, and each one here is a
/// request over the network to a small computer in another room. One request at a time, and while
/// one is in flight the newest wanted level replaces any other that was waiting: at most one request
/// per round trip, and the value the hand stopped on always lands.
/// </para>
/// <para>
/// The app debounces its own writes as well, and this is not a duplicate of that. That one is about
/// not writing a settings file forty times; this one is about not queueing forty requests behind a
/// player that answers in eighty milliseconds.
/// </para>
/// <para>
/// Nothing here throws at the caller. The seam's volume is a property setter, so there is nobody to
/// throw to; a request that fails is a line in the log and the next value will try again.
/// </para>
/// </remarks>
internal sealed class VolumeCoalescer(Func<int, CancellationToken, Task> send, IPluginLogger logger) : IDisposable
{
    private readonly Lock _gate = new();
    private readonly CancellationTokenSource _stopped = new();

    private int? _wanted;
    private bool _sending;

    /// <summary>Asks for a level. Returns at once; the sending happens behind it.</summary>
    public void Want(int level)
    {
        lock (_gate)
        {
            _wanted = level;

            if (_sending)
            {
                // Something is already on the wire. Whatever it is, this newer value is what should
                // follow it, and any value that was waiting is now out of date.
                return;
            }

            _sending = true;
        }

        _ = SendUntilSettledAsync();
    }

    public void Dispose()
    {
        _stopped.Cancel();
        _stopped.Dispose();
    }

    private async Task SendUntilSettledAsync()
    {
        while (true)
        {
            int level;

            lock (_gate)
            {
                if (_wanted is not { } next)
                {
                    _sending = false;
                    return;
                }

                level = next;
                _wanted = null;
            }

            try
            {
                await send(level, _stopped.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                lock (_gate)
                {
                    _sending = false;
                }

                return;
            }
            catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
            {
                // A volume that did not take is worth saying and not worth stopping over: the hand
                // is probably still moving, and the next value will try again.
                logger.Warn($"could not set the volume to {level}", error);
            }
        }
    }
}
