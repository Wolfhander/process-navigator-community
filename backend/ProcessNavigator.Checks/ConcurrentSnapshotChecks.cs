using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class ConcurrentSnapshotChecks
{
    public static async Task<int> RunAsync()
    {
        var root = Directory.CreateTempSubdirectory("pn-snapshot-").FullName;
        var count = 0;
        void Check(bool value, string label) { if (!value) throw new Exception(label); count++; }
        try
        {
            var path = Path.Combine(root, "snapshot.json");
            await AtomicTextFile.WriteAsync(path, "old");
            await using (var old = AtomicTextFile.OpenRead(path))
            {
                await AtomicTextFile.WriteAsync(path, "new");
                using var reader = new StreamReader(old);
                Check(await reader.ReadToEndAsync() == "old", "Open reader retains the old complete snapshot");
                Check(await AtomicTextFile.ReadAsync(path) == "new", "New reader sees the replacement");
            }
            await File.WriteAllTextAsync(path, "Данные — текст", Encoding.Unicode);
            Check(await AtomicTextFile.ReadAsync(path) == "Данные — текст", "BOM and Unicode are preserved");
            using (var cancelled = new CancellationTokenSource())
            {
                cancelled.Cancel();
                try { await AtomicTextFile.ReadAsync(path, cancelled.Token); throw new Exception("Cancelled read succeeded"); }
                catch (OperationCanceledException) { count++; }
                try { await AtomicTextFile.WriteAsync(path, "bad", cancelled.Token); throw new Exception("Cancelled write succeeded"); }
                catch (OperationCanceledException) { count++; }
                Check(await AtomicTextFile.ReadAsync(path) == "Данные — текст", "Cancelled write preserves source");
            }
            try { await AtomicTextFile.ReadAsync(Path.Combine(root, "absent")); throw new Exception("Missing read succeeded"); }
            catch (FileNotFoundException) { count++; }
            await using (var exclusive = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
            {
                try { await AtomicTextFile.ReadAsync(path); throw new Exception("Exclusive lock was hidden"); }
                catch (IOException) { count++; }
            }
            // External programs which do not share delete still legitimately
            // block replacement. We must not silently swallow/retry that write.
            await using (var external = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (OperatingSystem.IsWindows())
                {
                    try { await AtomicTextFile.WriteAsync(path, "blocked"); throw new Exception("Blocked replacement succeeded"); }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { count++; }
                }
            }
            Check(!Directory.EnumerateFiles(root, "*.tmp").Any(), "Failed/cancelled writes clean their staging files");
            var copied = Path.Combine(root, "copy.json");
            await AtomicTextFile.CopyAsync(path, copied);
            Check((await File.ReadAllBytesAsync(path)).SequenceEqual(await File.ReadAllBytesAsync(copied)), "Atomic copy preserves BOM and exact bytes");
            using (var oldCopy = AtomicTextFile.OpenRead(copied))
            {
                await AtomicTextFile.WriteAsync(path, "updated copy");
                await AtomicTextFile.CopyAsync(path, copied);
                using var reader = new StreamReader(oldCopy);
                Check(await reader.ReadToEndAsync() == "Данные — текст", "Copy replacement leaves existing parser snapshot intact");
                Check(await AtomicTextFile.ReadAsync(copied) == "updated copy", "Copy replacement publishes new complete bytes");
            }

            static string Snapshot(int version) => JsonSerializer.Serialize(new { version, payload = new string((char)('a' + version % 26), 8192) });
            await AtomicTextFile.WriteAsync(path, Snapshot(0));
            var readers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
            {
                for (var n = 0; n < 100; n++)
                {
                    using var json = JsonDocument.Parse(await AtomicTextFile.ReadAsync(path));
                    var version = json.RootElement.GetProperty("version").GetInt32();
                    if (json.RootElement.GetProperty("payload").GetString() != new string((char)('a' + version % 26), 8192))
                        throw new Exception("Torn JSON snapshot");
                }
            })).ToArray();
            var writer = Task.Run(async () => { for (var n = 1; n <= 50; n++) await AtomicTextFile.WriteAsync(path, Snapshot(n)); });
            await Task.WhenAll(readers.Append(writer));
            Check(await AtomicTextFile.ReadAsync(path) == Snapshot(50), "400 reads and 50 replacements keep complete snapshots");

            var host = new Host(root);
            var catalog = new ProcessCatalogService(new BpmnProcessLoader(host));
            await catalog.CreateAsync(new CreateProcessModel("concurrent", "Учебная модель"));
            var workflowWriter = Task.Run(async () =>
            {
                for (var n = 0; n < 30; n++)
                    await catalog.ConfigureWorkflowAsync("concurrent", new ProcessWorkflowRouteUpdateModel([new("Проверка " + n)]));
            });
            var workflowReaders = Enumerable.Range(0, 3).Select(_ => Task.Run(async () =>
            {
                for (var n = 0; n < 80; n++)
                {
                    var item = await catalog.WorkflowAsync("concurrent");
                    if (item.Status != "Draft") throw new Exception("Invalid workflow snapshot");
                    await catalog.LoadAsync("concurrent", true);
                }
            })).ToArray();
            await Task.WhenAll(workflowReaders.Append(workflowWriter));
            Check((await catalog.WorkflowAsync("concurrent")).Stages.Single().Name == "Проверка 29", "Workflow and BPMN loader read during 30 context replacements");
            var model = (await catalog.LoadAsync("concurrent", true)) with { Status = "Published" };
            var executions = new ProcessExecutionService(host);
            var starts = Task.Run(async () => { for (var n = 0; n < 30; n++) await executions.StartAsync(model, "actor", "Запуск " + n, default); });
            var lists = Enumerable.Range(0, 3).Select(_ => Task.Run(async () =>
            {
                for (var n = 0; n < 100; n++) await executions.ListAsync("concurrent", default);
            })).ToArray();
            await Task.WhenAll(lists.Append(starts));
            Check((await executions.ListAsync("concurrent", default)).Count == 30, "300 list reads during execution writes lose no instances");
        }
        finally
        {
            var full = Path.GetFullPath(root);
            var allowed = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(allowed, StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(full).StartsWith("pn-snapshot-"))
                throw new Exception("Unsafe snapshot test cleanup");
            Directory.Delete(full, true);
        }
        return count;
    }
    private sealed class Host(string root) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "SnapshotChecks";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = root;
        public string WebRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
