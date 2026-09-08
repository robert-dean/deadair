using Avalonia;
using Avalonia.Animation;
using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using Nav = MaroonedSoftware.Deadair.Desktop.Navigation;

namespace MaroonedSoftware.Deadair.Desktop.Views;

/// <summary>
/// The page the sidebar is pointing at.
/// </summary>
/// <remarks>
/// <para>
/// This replaces a `Panel` holding all seven pages at once with their visibility bound through the
/// window. That arrangement worked and cost two things worth being rid of: every page was laid out
/// on every frame whether or not anybody could see it, and each one had to reach back up through
/// `$parent[Window].((vm:ShellViewModel)DataContext)` to find its own view model, because setting
/// `DataContext` on a child re-scopes every binding on it. Here the context is set in code, once,
/// so a page binds to its own view model plainly.
/// </para>
/// <para>
/// The pages are built once and kept. They are singletons in the container, they hold subscriptions
/// and running pollers, and rebuilding one on every visit would be re-fetching a catalog somebody is
/// walking back and forth through.
/// </para>
/// </remarks>
public sealed class PageHost : TransitioningContentControl
{
    public static readonly StyledProperty<ShellViewModel?> ShellProperty =
        AvaloniaProperty.Register<PageHost, ShellViewModel?>(nameof(Shell));

    private readonly Dictionary<Type, Control> _pages = [];

    public PageHost()
    {
        // Short enough to be a settle rather than a transition. A page that visibly slides on every
        // press of a keyboard shortcut is a page you wait for.
        PageTransition = new CrossFade(TimeSpan.FromMilliseconds(120));
    }

    public ShellViewModel? Shell
    {
        get => GetValue(ShellProperty);
        set => SetValue(ShellProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property != ShellProperty)
        {
            return;
        }

        if (change.GetOldValue<ShellViewModel?>() is { } old)
        {
            old.Navigation.PropertyChanged -= OnNavigated;
        }

        if (change.GetNewValue<ShellViewModel?>() is { } shell)
        {
            shell.Navigation.PropertyChanged += OnNavigated;
            Show(shell);
        }
    }

    private void OnNavigated(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(NavigationViewModel.Current) && Shell is { } shell)
        {
            Show(shell);
        }
    }

    private void Show(ShellViewModel shell)
    {
        var page = shell.Navigation.Current switch
        {
            Nav.Destination.Programme => Page(() => new ProgrammeView(), shell.Programme),
            Nav.Destination.Library => Page(() => new LibraryView(), shell.Library),
            Nav.Destination.History => Page(() => new HistoryView(), shell.History),
            Nav.Destination.Checkup => Page(() => new CheckupView(), shell.Checkup),
            Nav.Destination.Voice => Page(() => new VoiceView(), shell.Voice),
            Nav.Destination.Settings => Page(() => new SettingsView(), shell.StationSettings),
            _ => Page(() => new ListenerView(), shell.Listener),
        };

        // Setting the same content again would run the cross-fade over itself, which reads as a
        // flicker on a page that did not change.
        if (!ReferenceEquals(Content, page))
        {
            Content = page;
        }
    }

    private Control Page<T>(Func<T> build, object dataContext)
        where T : Control
    {
        if (!_pages.TryGetValue(typeof(T), out var page))
        {
            page = build();
            page.DataContext = dataContext;
            _pages[typeof(T)] = page;
        }

        return page;
    }
}
