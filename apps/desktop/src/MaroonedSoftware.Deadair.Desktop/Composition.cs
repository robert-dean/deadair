using Avalonia.Threading;
using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Player.Mac;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using Microsoft.Extensions.DependencyInjection;

namespace MaroonedSoftware.Deadair.Desktop;

/// <summary>
/// Where the app is assembled, and the only place that knows which platform it is on.
/// </summary>
/// <remarks>
/// The player is chosen here and nowhere else: every other file in the app sees
/// <see cref="IStationPlayer"/>. That is what makes a Windows or Linux implementation a project and
/// one line rather than a port.
/// </remarks>
internal static class Composition
{
    public static ServiceProvider Build()
    {
        var services = new ServiceCollection();

        services.AddSingleton<IUiDispatcher, AvaloniaUiDispatcher>();
        services.AddSingleton<ISettingsStore>(_ => new FileSettingsStore());

        // ONE client for the whole app: API, artwork and — through the agent it is given — the audio
        // as well. The station counts an HLS listener per IP and User-Agent, so a second client is a
        // second listener.
        services.AddSingleton(_ => StationHttp.Create());
        services.AddSingleton(provider => new StationProbe(provider.GetRequiredService<HttpClient>()));

        services.AddSingleton<IStationPlayer>(_ => OperatingSystem.IsMacOS()
            ? new MacStationPlayer(UserAgent.Value)

            // Windows and Linux are later phases. A silent player rather than a crash means the rest
            // of the app can be worked on and looked at anywhere.
            : new NullStationPlayer());

        services.AddSingleton<ShellViewModel>();
        services.AddSingleton<ListenerViewModel>();
        services.AddSingleton<SetupViewModel>();

        return services.BuildServiceProvider();
    }
}

/// <summary>The Core project's threading seam, implemented with Avalonia's dispatcher.</summary>
internal sealed class AvaloniaUiDispatcher : IUiDispatcher
{
    public void Post(Action action) => Dispatcher.UIThread.Post(action);
}
