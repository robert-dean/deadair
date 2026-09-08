using System.Reflection;
using System.Runtime.Loader;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>
/// One plugin's assemblies, kept apart from the app's and from every other plugin's.
/// </summary>
/// <remarks>
/// <para>
/// <b>The contract is served from the app's own context, and that is the whole trick.</b> A type is
/// identified by its assembly AND the context that loaded it, so a plugin that loaded its own copy
/// of the contract would implement an <c>IStationPlayer</c> that is not the <c>IStationPlayer</c>
/// the app is asking for. The cast fails, the message says a type does not implement an interface it
/// visibly implements, and the reason is invisible in every line of code involved.
/// </para>
/// <para>
/// Everything else a plugin brings is loaded HERE, so two plugins may use different versions of the
/// same library without either of them knowing.
/// </para>
/// <para>
/// <b>Not collectible, deliberately.</b> Unloading only takes effect once nothing anywhere holds a
/// reference, and a plugin's device player is exactly the sort of thing an event subscription, a
/// pending request or an HTTP handler keeps alive — so a collectible context would usually just fail
/// to unload while reporting nothing. Reconfiguring a plugin disposes the instance and builds
/// another from the same context, which is what an operator actually needs; replacing the plugin's
/// CODE means restarting the app, and the settings page says so.
/// </para>
/// </remarks>
internal sealed class PluginLoadContext : AssemblyLoadContext
{
    /// <summary>
    /// The assemblies whose types cross the seam, which must therefore have exactly one identity.
    /// </summary>
    /// <remarks>
    /// The contract, and Core as a backstop. Core is not something a plugin should reference at all,
    /// but a plugin that does reference it by mistake is better off sharing the host's copy than
    /// quietly loading a second one and failing later in a way nobody can read.
    /// </remarks>
    private static readonly HashSet<string> Shared = new(StringComparer.OrdinalIgnoreCase)
    {
        typeof(PluginApi).Assembly.GetName().Name!,
        typeof(PluginLoadContext).Assembly.GetName().Name!,
    };

    private readonly AssemblyDependencyResolver _resolver;
    private readonly string _directory;

    public PluginLoadContext(string entryAssemblyPath)
        : base(name: $"plugin:{Path.GetFileNameWithoutExtension(entryAssemblyPath)}", isCollectible: false)
    {
        _resolver = new AssemblyDependencyResolver(entryAssemblyPath);
        _directory = Path.GetDirectoryName(entryAssemblyPath)!;
    }

    protected override Assembly? Load(AssemblyName assemblyName)
    {
        // Checked BEFORE the resolver, because a plugin's build may well have copied the contract
        // beside it: answering null here sends the runtime to the default context, which already
        // holds the copy the app itself is using.
        if (Shared.Contains(assemblyName.Name ?? string.Empty))
        {
            return null;
        }

        var resolved = _resolver.ResolveAssemblyToPath(assemblyName);

        if (resolved is not null)
        {
            return LoadFromAssemblyPath(resolved);
        }

        // No deps.json, or a library somebody dropped in beside the plugin by hand. The resolver
        // only knows what the plugin's build declared.
        var beside = Path.Combine(_directory, assemblyName.Name + ".dll");

        // Null for anything left, which is the framework: it resolves in the default context, so a
        // plugin runs on the same runtime the app does rather than on a second copy of it.
        return File.Exists(beside) ? LoadFromAssemblyPath(beside) : null;
    }

    protected override nint LoadUnmanagedDll(string unmanagedDllName)
    {
        var resolved = _resolver.ResolveUnmanagedDllToPath(unmanagedDllName);

        return resolved is null ? nint.Zero : LoadUnmanagedDllFromPath(resolved);
    }
}
