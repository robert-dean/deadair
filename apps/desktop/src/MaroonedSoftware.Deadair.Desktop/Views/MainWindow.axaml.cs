using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class MainWindow : Window
{
    private ISettingsStore? _settings;
    private DispatcherTicker? _frameSettles;
    private bool _frameMoved;

    public MainWindow()
    {
        InitializeComponent();
        AddHandler(KeyDownEvent, OnKeyDown, Avalonia.Interactivity.RoutingStrategies.Tunnel);
    }

    /// <summary>
    /// Opens where the window was left, if that is still on a screen, and keeps track of it from here.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Called before the window is shown, with the settings already read, so it opens in place rather
    /// than at the default frame and then jumping. A frame whose centre is on no connected screen is
    /// ignored: a laptop closed on an external display must not open its window on a display that is
    /// no longer there.
    /// </para>
    /// <para>
    /// Saved half a second after the window stops moving, the way the volume slider is: a drag is
    /// dozens of position changes, and each would otherwise be a write of the settings file. Only a
    /// normal window's frame is kept, so a maximised one is remembered as the frame to go back to
    /// plus the fact that it was maximised.
    /// </para>
    /// </remarks>
    internal void RememberFrame(ISettingsStore settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        _settings = settings;
        Restore(settings.Current.Window);

        _frameSettles = new DispatcherTicker(TimeSpan.FromMilliseconds(500), SaveFrame);

        PositionChanged += (_, _) => FrameMoved();
        Resized += (_, _) => FrameMoved();
        PropertyChanged += (_, e) =>
        {
            if (e.Property == WindowStateProperty)
            {
                FrameMoved();
            }
        };

        // A save still waiting when the window goes is written now rather than lost. Synchronous on
        // purpose: this can be the app quitting, and the settings file is a kilobyte on a local disk
        // whose writes never come back to this thread.
        Closing += (_, _) => FlushFrame();
    }

    private void Restore(WindowMemory? frame)
    {
        if (frame is null)
        {
            return;
        }

        var screens = Screens.All
            .Select(screen => new WindowMemory.ScreenArea(
                screen.WorkingArea.X,
                screen.WorkingArea.Y,
                screen.WorkingArea.Width,
                screen.WorkingArea.Height))
            .ToList();

        if (!WindowMemory.LandsOn(frame, screens, DesktopScaling))
        {
            return;
        }

        WindowStartupLocation = WindowStartupLocation.Manual;
        Position = new PixelPoint(frame.X, frame.Y);
        Width = Math.Max(frame.Width, MinWidth);
        Height = Math.Max(frame.Height, MinHeight);

        if (frame.Maximized)
        {
            WindowState = WindowState.Maximized;
        }
    }

    /// <remarks>
    /// Only notes that something moved. The frame is read when the save runs, not here: the first
    /// version read it here and saved (0, 505) for a window centred at (1970, 184), because the
    /// events fire part-way through Avalonia placing a window it has been asked to centre.
    /// </remarks>
    private void FrameMoved()
    {
        if (_frameSettles is null)
        {
            return;
        }

        _frameMoved = true;
        _frameSettles.Stop();
        _frameSettles.Start();
    }

    private void SaveFrame()
    {
        _frameSettles?.Stop();

        if (TakeFrame() is { } frame && _settings is not null)
        {
            _ = _settings.UpdateAsync(current => current with { Window = frame });
        }
    }

    private void FlushFrame()
    {
        _frameSettles?.Stop();

        if (TakeFrame() is { } frame && _settings is not null)
        {
            _settings.UpdateAsync(current => current with { Window = frame }).GetAwaiter().GetResult();
        }
    }

    /// <summary>The frame to save now, or null when there is nothing new or nothing worth keeping.</summary>
    /// <remarks>
    /// A maximised window keeps the normal frame it had before, marked as maximised, so coming back out
    /// of it after a relaunch goes somewhere sensible. A full-screen or minimised window has no frame
    /// worth reopening in, and is not saved at all.
    /// </remarks>
    private WindowMemory? TakeFrame()
    {
        if (!_frameMoved)
        {
            return null;
        }

        _frameMoved = false;

        return WindowState switch
        {
            WindowState.Normal => new WindowMemory
            {
                X = Position.X,
                Y = Position.Y,
                Width = ClientSize.Width,
                Height = ClientSize.Height,
            },
            WindowState.Maximized when _settings?.Current.Window is { } normal => normal with { Maximized = true },
            _ => null,
        };
    }

    /// <summary>
    /// The rail's letters, without a modifier, as the web console has them, and Space for Listen and Stop.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Tunnelled so the rail responds before anything else sees the key, and skipped entirely while a
    /// text box has focus — otherwise typing a station address or a password navigates away
    /// mid-word.
    /// </para>
    /// <para>
    /// Space is here and NOT a key equivalent on the Controls menu. AppKit offers every key press to
    /// the main menu first, so a bare Space on a menu item would take the space bar away from the
    /// address and password boxes, the same trap an Edit menu sets for paste. Tunnelling also means a
    /// focused button does not press itself as well; on a Mac, Space presses buttons only with Full
    /// Keyboard Access turned on, so outside a text box Space means one thing.
    /// </para>
    /// </remarks>
    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (DataContext is not ShellViewModel shell || shell.NeedsStation)
        {
            return;
        }

        // A Slider is not a TextBox and takes no letters, but it does take focus — so with the
        // volume slider focused, pressing "d" would navigate to the desk mid-drag.
        if (e.KeyModifiers != KeyModifiers.None || FocusManager?.GetFocusedElement() is TextBox or Slider)
        {
            return;
        }

        if (e.Key == Key.Space)
        {
            shell.Listener.ToggleCommand.Execute(null);
            e.Handled = true;
            return;
        }

        foreach (var item in shell.Navigation.Items)
        {
            if (item.IsVisible && string.Equals(item.Key, e.Key.ToString(), System.StringComparison.OrdinalIgnoreCase))
            {
                shell.Navigation.Show(item.Entry.Destination);
                e.Handled = true;
                return;
            }
        }
    }
}
