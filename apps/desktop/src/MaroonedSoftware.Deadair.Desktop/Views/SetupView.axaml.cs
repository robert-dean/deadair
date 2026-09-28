using System.ComponentModel;
using Avalonia.Controls;
using Avalonia.Threading;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class SetupView : UserControl
{
    private SetupViewModel? _setup;

    public SetupView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_setup is not null)
        {
            _setup.PropertyChanged -= OnSetupChanged;
        }

        _setup = DataContext as SetupViewModel;

        if (_setup is not null)
        {
            _setup.PropertyChanged += OnSetupChanged;
        }
    }

    /// <remarks>
    /// Find your station leads to a box, so the box has the caret: the click that asked for it is the
    /// last thing anybody should need to do with the mouse before typing. Posted rather than done at
    /// once, because the half holding the box is still hidden when the step changes, and focus asked
    /// of a control that is not visible is refused with nothing said.
    /// </remarks>
    private void OnSetupChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(SetupViewModel.Step) || _setup is null)
        {
            return;
        }

        if (_setup.Finding)
        {
            Dispatcher.UIThread.Post(() => AddressBox.Focus(), DispatcherPriority.Loaded);
        }
        else if (_setup.SigningIn)
        {
            // The same for the sign-in form, which also puts its password back out of sight.
            Dispatcher.UIThread.Post(Login.Prepare, DispatcherPriority.Loaded);
        }
    }
}
