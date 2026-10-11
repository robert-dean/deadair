using Avalonia.Threading;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// A timer on the UI thread, for things that move between readings.
/// </summary>
/// <remarks>
/// Only the playhead needs one. It is a separate type so that nothing is tempted to give a view model
/// a timer of its own and forget to stop it: this one stops when the thing it drives stops, and a
/// ticker that outlives its screen is a screen that keeps redrawing after nobody is looking.
/// </remarks>
internal sealed class DispatcherTicker(TimeSpan interval, Action tick)
{
    private DispatcherTimer? _timer;

    /// <summary>How often it ticks. Changing it while running takes effect from the next tick.</summary>
    public TimeSpan Interval
    {
        get => interval;
        set
        {
            if (value == interval)
            {
                return;
            }

            interval = value;
            if (_timer is not null)
            {
                _timer.Interval = value;
            }
        }
    }

    public void Start()
    {
        if (_timer is not null)
        {
            return;
        }

        _timer = new DispatcherTimer { Interval = interval };
        _timer.Tick += (_, _) => tick();
        _timer.Start();
    }

    public void Stop()
    {
        _timer?.Stop();
        _timer = null;
    }
}
