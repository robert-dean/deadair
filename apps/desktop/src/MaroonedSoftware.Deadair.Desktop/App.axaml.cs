using System.Diagnostics;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Desktop.Views;
using Microsoft.Extensions.DependencyInjection;

namespace MaroonedSoftware.Deadair.Desktop;

public partial class App : Application
{
    private ServiceProvider? _services;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            _services = Composition.Build();

            // Every way out passes through here, including the ones that never return to Program.
            desktop.Exit += (_, _) => ReleaseOnExit();

            // Where the controls find it. A control is built by XAML and can be handed nothing, so
            // this is the one thing the app reaches for statically, set once from the container.
            ArtworkLoader.Shared = _services.GetRequiredService<ArtworkLoader>();

            var shell = _services.GetRequiredService<ShellViewModel>();

            // Read before the window exists, so it opens where it was left rather than at the default
            // frame and then jumping, and in the right appearance on its first frame. Blocking here is
            // safe: the loop has not started, and the read never comes back to this thread.
            var settings = _services.GetRequiredService<ISettingsStore>();
            settings.LoadAsync().GetAwaiter().GetResult();

            var window = new MainWindow { DataContext = shell };
            window.RememberFrame(settings);
            desktop.MainWindow = window;

            // Before StartAsync, so the Dock's reopen and a link that launched the app are heard from
            // the first moment it runs.
            var keeper = new WindowKeeper(desktop, window);
            keeper.UriOpened += uri =>
            {
                if (StationLink.TryParse(uri, out var station))
                {
                    _ = shell.OpenStationAsync(station);
                }
                else
                {
                    Trace.WriteLine($"link: {uri.Scheme}:// link that names no station, ignored");
                }
            };
            shell.Window = keeper;

            // For the native menu in App.axaml and nothing else. A NativeMenu has no visual parent,
            // so it cannot inherit the window's; windows still set their own and none of them read
            // this.
            DataContext = shell;

            // Everything that needs the station address, a settings file or a first reading happens
            // here rather than in a constructor, so the window is on screen while it happens.
            _ = shell.StartAsync();
        }

        base.OnFrameworkInitializationCompleted();
    }

    /// <summary>How long quitting waits for the container to let go. A speaker's own stop is bounded at three seconds.</summary>
    private static readonly TimeSpan ExitGrace = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Lets go of everything the container holds as the app ends, a speaker it was playing to above all.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This used to be <c>ShutdownRequested += (_, _) =&gt; _services?.Dispose()</c>, and closing the
    /// window ABORTED the process every time: three view models are <see cref="IAsyncDisposable"/>
    /// and only that, so the container refuses a synchronous <c>Dispose</c> and throws. The crash was
    /// never noticed because closing an app is the last thing anybody does with it, and the exit code
    /// is not something you see when you close a window.
    /// </para>
    /// <para>
    /// Then it moved to <c>Program</c>, after the main loop, and that was wrong on macOS in a way
    /// nothing showed. <b>A quit from the menu, ⌘Q, the Dock or a logout ends the process from inside
    /// Avalonia's shutdown</b>: AppKit is told the app may terminate and calls <c>exit</c>, so the
    /// loop never returns and nothing after it runs. Measured: exit code 0 and no closing line in the
    /// log. So quitting never disposed the container, which is the code that asks a network speaker
    /// to stop, and a speaker left streaming is a listener the station goes on counting.
    /// </para>
    /// <para>
    /// <see cref="IClassicDesktopStyleApplicationLifetime"/>'s <c>Exit</c> is the last managed code
    /// that runs on every way out, and it cannot be cancelled, which was the reason for avoiding
    /// <c>ShutdownRequested</c>. It is raised on the UI thread and returns before the process ends, so
    /// the work goes to the pool and is waited for, BOUNDED: nothing in the container needs the UI
    /// thread to finish (every await in it is <c>ConfigureAwait(false)</c>), but an app that hangs
    /// on its way out because one speaker stopped answering is worse than one that gives up.
    /// </para>
    /// </remarks>
    private void ReleaseOnExit()
    {
        Trace.WriteLine("deadair exiting");

        var releasing = Task.Run(() => DisposeServicesAsync().AsTask());

        try
        {
            if (!releasing.Wait(ExitGrace))
            {
                Trace.WriteLine($"exit: gave up after {ExitGrace.TotalSeconds:0} seconds waiting for the app to let go");
            }
        }
        catch (AggregateException error)
        {
            Trace.WriteLine($"exit: letting go failed: {error.InnerException}");
        }
    }

    /// <summary>Disposes the container once; a second call does nothing.</summary>
    internal ValueTask DisposeServicesAsync()
    {
        var services = _services;
        _services = null;

        return services?.DisposeAsync() ?? ValueTask.CompletedTask;
    }
}
