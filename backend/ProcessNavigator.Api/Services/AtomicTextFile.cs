using System.Text;

namespace ProcessNavigator.Api.Services;

public static class AtomicTextFile
{
    // Bounded striped gates coordinate this process only. Parsers receive an
    // independent snapshot and never hold a live file open across await.
    private static readonly SemaphoreSlim[] Gates = Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    private static SemaphoreSlim Gate(string path) =>
        Gates[(uint)StringComparer.OrdinalIgnoreCase.GetHashCode(Path.GetFullPath(path)) % Gates.Length];

    public static Stream OpenRead(string path)
    {
        var gate = Gate(path);
        gate.Wait();
        try
        {
            using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
            var bytes = new byte[checked((int)source.Length)];
            source.ReadExactly(bytes);
            return new MemoryStream(bytes, writable: false);
        }
        finally { gate.Release(); }
    }

    public static async Task<string> ReadAsync(string path, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var gate = Gate(path);
        await gate.WaitAsync(cancellationToken);
        try
        {
            using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete,
                bufferSize: 4096, useAsync: true);
            using var reader = new StreamReader(source, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            return await reader.ReadToEndAsync(cancellationToken);
        }
        finally { gate.Release(); }
    }

    public static async Task WriteAsync(string path,string content,CancellationToken cancellationToken=default)
    {
        var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        try
        {
            await File.WriteAllTextAsync(temporary,content,new UTF8Encoding(false),cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            Commit(temporary,path);
        }
        finally {if(File.Exists(temporary))File.Delete(temporary);}
    }

    public static async Task CopyAsync(string source, string path, CancellationToken cancellationToken = default)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var snapshot = OpenRead(source);
            await using (var target = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, true))
                await snapshot.CopyToAsync(target, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            Commit(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public static void Commit(string temporary, string path)
    {
        var gate = Gate(path);
        gate.Wait();
        try { File.Move(temporary, path, true); }
        finally { gate.Release(); }
    }
}
