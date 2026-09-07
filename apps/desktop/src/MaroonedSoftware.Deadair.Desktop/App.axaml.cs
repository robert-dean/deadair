using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
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
