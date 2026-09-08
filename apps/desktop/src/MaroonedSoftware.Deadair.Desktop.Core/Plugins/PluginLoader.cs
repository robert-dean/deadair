using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>
/// Finds plugins and builds them, and answers with a record whatever happens.
/// </summary>
/// <remarks>
/// <para>
/// <b>Nothing here throws.</b> Every input is a directory somebody else wrote, so a missing file, a
/// stray comma, a renamed class and an exception from a constructor are all ordinary and all end the
/// same way: a row on the settings page with a sentence on it. A loader that threw would put the
/// app's startup at the mercy of a plugin nobody has even enabled.
/// </para>
/// <para>
/// The two steps are separate on purpose. <see cref="Discover"/> reads manifests and nothing else,
/// so a disabled plugin can be listed and configured with none of its code loaded, and the
/// compatibility check happens before an assembly is opened rather than after.
/// </para>
/// </remarks>
public sealed class PluginLoader(PluginDirectories directories)
{
    private readonly Dictionary<string, PluginLoadContext> _contexts = new(StringComparer.Ordinal);

    /// <summary>
    /// Every plugin candidate in both directories, bundled first.
    /// </summary>
    /// <remarks>
    /// Bundled first because a duplicate id is decided by who was seen first, and a plugin shipped
    /// with the app should not be replaceable by dropping a folder of the same name into a directory
    /// the app does not control.
    /// </remarks>
    public IReadOnlyList<PluginRecord> Discover()
    {
        var records = new List<PluginRecord>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (directory, origin) in new[]
        {
            (directories.Bundled, PluginOrigin.Bundled),
            (directories.User, PluginOrigin.User),
        })
        {
            foreach (var candidate in Candidates(directory))
            {
                var record = Read(candidate, origin);

                if (!seen.Add(record.Id))
                {
                    record = record with
                    {
                        Status = PluginStatus.Failed,
                        Error = string.Create(CultureInfo.InvariantCulture, $"""another plugin is already installed as "{record.Id}", and the copy found first is the one being used."""),
                    };
                }

                records.Add(record);
            }
        }

        return records;
    }

    /// <summary>
    /// Loads the assembly and builds the entry type. Answers a record carrying the instance, or one
    /// carrying why not.
    /// </summary>
    /// <remarks>
    /// Building is separate from starting: <see cref="IDeadairPlugin.InitializeAsync"/> is the
    /// caller's to run, under its own deadline, because a plugin that hangs on start is a different
    /// problem from one that cannot be constructed and wants a different sentence.
    /// </remarks>
    public PluginRecord Activate(PluginRecord discovered)
    {
        ArgumentNullException.ThrowIfNull(discovered);

        if (discovered.Manifest is not { } manifest)
        {
            return discovered;
        }

        var assemblyPath = Path.Combine(discovered.Directory, manifest.Entry.Assembly);

        if (!File.Exists(assemblyPath))
        {
            return Failed(discovered, $"""{manifest.Entry.Assembly} is not in the plugin's folder; it may not have been built.""");
        }

        try
        {
            if (!_contexts.TryGetValue(discovered.Directory, out var context))
            {
                context = new PluginLoadContext(assemblyPath);
                _contexts[discovered.Directory] = context;
            }

            var assembly = context.LoadFromAssemblyPath(assemblyPath);
            var type = assembly.GetType(manifest.Entry.Type, throwOnError: false);

            if (type is null)
            {
                return Failed(discovered, $"""{manifest.Entry.Assembly} has no type called "{manifest.Entry.Type}"; a rename would do this.""");
            }

            if (!typeof(IDeadairPlugin).IsAssignableFrom(type))
            {
                return Failed(discovered, $"""{manifest.Entry.Type} does not implement {nameof(IDeadairPlugin)}.""");
            }

            if (Activator.CreateInstance(type) is not IDeadairPlugin instance)
            {
                return Failed(discovered, $"""{manifest.Entry.Type} could not be built; it needs a public constructor taking nothing.""");
            }

            // Checked here rather than trusted at the point of use, so a mismatch is one sentence at
            // load rather than a plugin that is listed as working and then answers nothing when the
            // output picker asks it for devices.
            if (discovered.Declares(PluginCapabilities.OutputTarget) && instance is not IOutputTargetProvider)
            {
                return Failed(discovered, $"""{manifest.Entry.Type} declares "{PluginCapabilities.OutputTarget}" but does not implement {nameof(IOutputTargetProvider)}.""");
            }

            return discovered with { Status = PluginStatus.Active, Instance = instance };
        }
        catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
        {
            // A plugin built against a contract this app does not have arrives here as a
            // FileLoadException or a TypeLoadException, which is what catches one that declared a
            // range it does not really need.
            return Failed(discovered, $"{manifest.Entry.Assembly} could not be loaded: {error.Message}");
        }
    }

    private static PluginRecord Failed(PluginRecord record, string error) =>
        record with { Status = PluginStatus.Failed, Error = error, Instance = null };

    /// <summary>
    /// Directories holding a manifest, sorted so that a listing is the same on two machines.
    /// </summary>
    /// <remarks>
    /// A directory without one is skipped in silence rather than reported: a plugins folder may hold
    /// notes, an archive somebody downloaded, or a <c>.DS_Store</c>, and none of those is a broken
    /// plugin.
    /// </remarks>
    private static IEnumerable<string> Candidates(string directory)
    {
        string[] subdirectories;

        try
        {
            if (!Directory.Exists(directory))
            {
                return [];
            }

            subdirectories = Directory.GetDirectories(directory);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return [];
        }

        Array.Sort(subdirectories, StringComparer.Ordinal);

        return subdirectories.Where(path => File.Exists(Path.Combine(path, PluginApi.ManifestFileName)));
    }

    private static PluginRecord Read(string directory, PluginOrigin origin)
    {
        var name = Path.GetFileName(directory);
        var reading = PluginManifestReader.ReadFile(Path.Combine(directory, PluginApi.ManifestFileName));

        if (reading.Manifest is not { } manifest)
        {
            return new PluginRecord
            {
                Id = name,
                Directory = directory,
                Origin = origin,
                Status = PluginStatus.Failed,
                Error = reading.Problem,
            };
        }

        var problem = ApiVersionRange.TryParse(manifest.ApiVersion, out var range);

        if (problem is not null)
        {
            return new PluginRecord
            {
                Id = manifest.Id,
                Directory = directory,
                Origin = origin,
                Status = PluginStatus.Failed,
                Manifest = manifest,
                Error = problem,
            };
        }

        if (!range!.Allows(PluginApi.Version))
        {
            return new PluginRecord
            {
                Id = manifest.Id,
                Directory = directory,
                Origin = origin,
                Status = PluginStatus.Failed,
                Manifest = manifest,
                Error = string.Create(CultureInfo.InvariantCulture, $"""it needs plugin API "{range.Text}" and this app has {PluginApi.Version}."""),
            };
        }

        return new PluginRecord
        {
            Id = manifest.Id,
            Directory = directory,
            Origin = origin,
            Status = PluginStatus.Discovered,
            Manifest = manifest,
        };
    }
}
