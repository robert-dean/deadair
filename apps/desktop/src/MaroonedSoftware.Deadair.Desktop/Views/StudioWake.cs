using System.ComponentModel;
using Avalonia.Controls;
using Avalonia.Platform;
using Avalonia.Threading;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

/// <summary>
/// Holds the display awake while Studio is up, playing and seen, as the Keep the display awake setting
/// allows (<see cref="KeepAwakeRule"/>).
/// </summary>
/// <remarks>
/// <para>
/// Decided again whenever Studio opens or closes, playing starts or stops, or the setting changes,
/// and every few seconds while Studio is up, because neither the power source nor the window being
/// covered raises anything this app hears. Nothing is read while Studio is down, and leaving it lets
/// the display go at once.
/// </para>
/// <para>
/// Quitting lets it go through the container, which disposes <see cref="IDisplayAwake"/>; and macOS
/// drops a process's assertions when it ends in any case.
/// </para>
/// </remarks>
internal sealed class StudioWake
{
    /// <summary>How often a Studio that is up reads the power source and whether it can be seen.</summary>
    private static readonly TimeSpan Recheck = TimeSpan.FromSeconds(5);

    private readonly ShellViewModel _shell;
    private readonly ISettingsStore _settings;
    private readonly IDisplayAwake _awake;
    private readonly IScreenFacts _facts;
    private readonly TopLevel _window;
    private readonly DispatcherTimer _timer;

    public StudioWake(ShellViewModel shell, ISettingsStore settings, IDisplayAwake awake, IScreenFacts facts, TopLevel window)
    {
        _shell = shell;
        _settings = settings;
        _awake = awake;
        _facts = facts;
        _window = window;
        _timer = new DispatcherTimer { Interval = Recheck };
        _timer.Tick += (_, _) => Decide();

        shell.PropertyChanged += OnShellChanged;
        shell.Listener.PropertyChanged += OnListenerChanged;
        settings.Changed += _ => Dispatcher.UIThread.Post(Decide);
    }

    private void OnShellChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ShellViewModel.IsStudio))
        {
            if (_shell.IsStudio)
            {
                _timer.Start();
            }
            else
            {
                _timer.Stop();
            }

            Decide();
        }
    }

    private void OnListenerChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ListenerViewModel.Playing))
        {
            Decide();
        }
    }

    private void Decide()
    {
        var setting = _settings.Current.KeepAwake;

        // The setting first, so a Studio left at Never reads nothing from the system at all.
        if (setting == KeepAwake.Never || !_shell.IsStudio)
        {
            _awake.Hold(false);
            return;
        }

        var seen = _facts.IsSeen(NativeWindow()) != false;
        var onPower = setting == KeepAwake.WhileCharging && _awake.OnPower;
        _awake.Hold(KeepAwakeRule.Holds(setting, onPower, _shell.Listener.Playing, inFront: seen));
    }

    private nint NativeWindow() => _window.TryGetPlatformHandle() is IMacOSTopLevelPlatformHandle mac ? mac.NSWindow : 0;
}
