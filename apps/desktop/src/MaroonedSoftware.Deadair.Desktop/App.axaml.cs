using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
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

            // Where the controls find it. A control is built by XAML and can be handed nothing, so
            // this is the one thing the app reaches for statically, set once from the container.
            ArtworkLoader.Shared = _services.GetRequiredService<ArtworkLoader>();

            var shell = _services.GetRequiredService<ShellViewModel>();

            desktop.MainWindow = new MainWindow { DataContext = shell };

            // Everything that needs the station address, a settings file or a first reading happens
            // here rather than in a constructor, so the window is on screen while it happens.
            _ = shell.StartAsync();
        }

        base.OnFrameworkInitializationCompleted();
    }

    /// <summary>
    /// Lets go of everything the container holds, once the main loop has ended.
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
    /// It is called from <c>Program</c> after the loop rather than from the event for two reasons.
    /// The event can be CANCELLED, and a container disposed by a shutdown that was then called off is
    /// an app that keeps running with nothing behind it. And disposing after the loop means there is
    /// no dispatcher left to deadlock against, so the wait for the pollers to stop is a plain wait.
    /// </para>
    /// </remarks>
    internal ValueTask DisposeServicesAsync()
    {
        var services = _services;
        _services = null;

        return services?.DisposeAsync() ?? ValueTask.CompletedTask;
    }
}
