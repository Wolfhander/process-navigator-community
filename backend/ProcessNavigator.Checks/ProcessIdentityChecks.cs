using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

public static class ProcessIdentityChecks
{
    public static async Task<int> RunAsync()
    {
        var root = Directory.CreateTempSubdirectory("pn-identity-").FullName;
        var count = 0;
        void Check(bool value, string message) { if (!value) throw new Exception(message); count++; }
        async Task Missing(Func<Task> action) {
            try { await action(); throw new Exception("Missing process was accepted"); }
            catch (FileNotFoundException) { count++; }
        }
        async Task Conflict(Func<Task> action) {
            try { await action(); throw new Exception("Occupied identity was accepted"); }
            catch (ProcessConflictException) { count++; }
        }
        const string context = """{"version":"0.1","status":"Approved","owner":"Учебный","elements":{}}""";
        var repository = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
        var template = await File.ReadAllTextAsync(Path.Combine(repository, "backend", "ProcessNavigator.Api", "Data", "demo-showcase-l4-drawing.bpmn"));
        string Xml(string id) => template.Replace("demo-showcase-l4-drawing", id);
        static IFormFile Upload(string text, string name) {
            var bytes = Encoding.UTF8.GetBytes(text);
            return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", name);
        }
        try
        {
            var loader = new BpmnProcessLoader(new Host(root));
            var catalog = new ProcessCatalogService(loader);
            Check(loader.FindBpmnPath("unknown") is null, "Empty installation has no published model");
            await Missing(() => loader.LoadAsync("unknown"));
            Check(catalog.FindBpmnSourcePath("unknown", true) is null, "Missing draft has no fallback source file");
            Check(catalog.FindBpmnSourcePath("../escape", true) is null, "Draft source rejects path-like process IDs");
            Directory.CreateDirectory(loader.DataRoot);
            var legacy = Path.Combine(loader.DataRoot, "__missing__.bpmn");
            var legacyContext = Path.ChangeExtension(legacy, ".context.json");
            await File.WriteAllTextAsync(legacy, Xml("legacy"));
            await File.WriteAllTextAsync(legacyContext, context);
            var before = await File.ReadAllBytesAsync(legacy);
            Check(loader.GetBpmnPath("legacy") == legacy, "Legacy sentinel-named file is found by XML ID");
            Check(loader.FindBpmnPath("unknown") is null, "Legacy file is not evidence of an unrelated ID");
            await Missing(() => loader.LoadAsync("unknown"));
            await Missing(() => catalog.DeleteAsync("unknown"));
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(legacy)), "Unknown delete never removes legacy model");
            Check((await catalog.VersionsAsync("unknown")).Count == 0, "Unknown model has no fabricated published version");
            var imported = await catalog.ImportAsync(Upload(Xml("second"), "second.bpmn"), Upload(context, "second.context.json"));
            Check(imported.Process.Id == "second", "Import after legacy publication creates an independent draft");
            await Conflict(() => catalog.ImportAsync(Upload(Xml("second"), "repeat.bpmn"), Upload(context, "repeat.context.json")));
            // The service-level publication test supplies an approved fixture.
            // Browser/API checks exercise the actual submission/approval gates.
            var secondContext = Path.Combine(loader.DataRoot, "Drafts", "second.context.json");
            await File.WriteAllTextAsync(secondContext, context);
            await catalog.PublishDraftAsync("second");
            Check(loader.GetBpmnPath("second") == Path.Combine(loader.DataRoot, "second.bpmn"), "New publication uses its own safe file name");
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(legacy)), "New publication preserves legacy bytes");
            Check((await loader.LoadAsync("second")).Id == "second", "Newly published model reopens by ID");
            await catalog.ImportAsync(Upload(Xml("third"), "third.bpmn"), Upload(context, "third.context.json"));
            await File.WriteAllTextAsync(Path.Combine(loader.DataRoot, "Drafts", "third.context.json"), context);
            await catalog.PublishDraftAsync("third");
            Check((await loader.LoadAsync("third")).Id == "third", "A third publication does not collide");
            await Conflict(() => catalog.ImportAsync(Upload(Xml("second"), "second.bpmn"), Upload(context, "second.context.json")));
            await catalog.CreateAsync(new CreateProcessModel("created", "Учебное создание"));
            Check((await catalog.LoadAsync("created", true)).Id == "created", "Manual creation after publication remains available");
            await catalog.DeleteAsync("created");
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(legacy)), "Draft deletion does not touch another published file");
            await catalog.SaveGeneratedDraftAsync("generated", Xml("generated"), context);
            Check((await catalog.LoadAsync("generated", true)).Id == "generated", "Generated/table draft does not load a sentinel model");
            await catalog.DeleteAsync("second");
            Check(loader.FindBpmnPath("second") is null && (await loader.LoadAsync("third")).Id == "third", "Deletion is isolated to the exact identity");
            // A mismatched or orphan destination must not be overwritten, even
            // when its basename resembles the requested process.
            await catalog.ImportAsync(Upload(Xml("occupied"), "occupied.bpmn"), Upload(context, "occupied.context.json"));
            await File.WriteAllTextAsync(Path.Combine(loader.DataRoot, "Drafts", "occupied.context.json"), context);
            var occupiedPath = Path.Combine(loader.DataRoot, "occupied.bpmn");
            await File.WriteAllTextAsync(occupiedPath, Xml("other"));
            await Conflict(() => catalog.PublishDraftAsync("occupied"));
            Check((await File.ReadAllTextAsync(occupiedPath)) == Xml("other"), "Mismatched destination is preserved");
            Check((await catalog.LoadAsync("occupied", true)).Status == "Approved", "Failed publication preserves draft status");
        }
        finally
        {
            var full = Path.GetFullPath(root);
            var allowed = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(allowed, StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(full).StartsWith("pn-identity-"))
                throw new Exception("Unsafe fixture cleanup");
            Directory.Delete(full, true);
        }
        return count;
    }
    private sealed class Host(string root) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "IdentityChecks";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = root;
        public string WebRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
