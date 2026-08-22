// Polyfill required for C# 9+ records on .NET Framework targets.
// The compiler emits init-only setters that reference this marker class,
// which is built in on net5+ but absent from .NET Framework 4.x.
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
