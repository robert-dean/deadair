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
            desktop.ShutdownRequested += (_, _) => _services?.Dispose();

            // Everything that needs the station address, a settings file or a first reading happens
            // here rather than in a constructor, so the window is on screen while it happens.
            _ = shell.StartAsync();
        }

        base.OnFrameworkInitializationCompleted();
    }
}
