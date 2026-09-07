using Avalonia.Threading;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
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

        services.AddSingleton<ISecretStore>(_ => OperatingSystem.IsMacOS()
            ? new MacKeychainSecretStore()

            // Windows and Linux get their own store when they get their own player. Until then a
            // session lasts as long as the process, which is honest rather than silently unencrypted.
            : new InMemorySecretStore());

        // ONE client for the whole app: API, artwork and — through the agent it is given — the audio
        // as well. The station counts an HLS listener per IP and User-Agent, so a second client is a
        // second listener.
        //
        // The session handler is built with a callback rather than the manager itself, because the
        // manager needs the client and the client needs the handler. The knot is tied here and
        // nowhere else.
        services.AddSingleton(provider => StationHttp.Create(
            new SessionHandler(() => provider.GetRequiredService<SessionManager>())));

        services.AddSingleton(provider => new SessionManager(
            provider.GetRequiredService<ISecretStore>(),
            provider.GetRequiredService<HttpClient>()));

        services.AddSingleton(provider => new OperatorActions(provider.GetRequiredService<SessionManager>()));
        services.AddSingleton(provider => new StationProbe(provider.GetRequiredService<HttpClient>()));

        services.AddSingleton<IStationPlayer>(_ => OperatingSystem.IsMacOS()
            ? new MacStationPlayer(UserAgent.Value)

            // Windows and Linux are later phases. A silent player rather than a crash means the rest
            // of the app can be worked on and looked at anywhere.
            : new NullStationPlayer());

        services.AddSingleton<ISystemNowPlaying>(_ => OperatingSystem.IsMacOS()
            ? new MacSystemNowPlaying()
            : new NullSystemNowPlaying());

        services.AddSingleton<ShellViewModel>();
        services.AddSingleton<LoginViewModel>();
        services.AddSingleton<TransportViewModel>();
        services.AddSingleton<RunningOrderViewModel>();
        services.AddSingleton<NavigationViewModel>();
        services.AddSingleton<ProgrammeViewModel>();
        services.AddSingleton<LibraryViewModel>();
        services.AddSingleton<HistoryViewModel>();
        services.AddSingleton<CheckupViewModel>();
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
