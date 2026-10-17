using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class RegistryLifecycleChecks
{
    public static async Task<int> RunAsync()
    {
        var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root = Path.Combine(temp, "pn-registry-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "Data", "InformationObjects"));
        var path = Path.Combine(root, "Data", "InformationObjects", "registry.json");
        var count = 0;
        void Check(bool condition, string label) { if (!condition) throw new Exception(label); count++; }
        async Task Reject(InformationObjectRegistryService service, InformationObjectUpdateModel update)
        {
            var before = await File.ReadAllTextAsync(path);
            var rejected = false;
            try { await service.SaveAsync("legacy", update, false); } catch (InvalidDataException) { rejected = true; }
            Check(rejected && before == await File.ReadAllTextAsync(path), "Rejected transition must leave persisted data unchanged");
        }
        try
        {
            await File.WriteAllTextAsync(path, """
                [{"id":"legacy","name":"Документ","kind":"Document","version":"1","lifecycleState":"Draft","aliases":["Документ"]}]
                """);
            var environment = new Environment(root);
            var catalog = new ProcessCatalogService(new BpmnProcessLoader(environment));
            var service = new InformationObjectRegistryService(catalog, environment);
            var initial = (await service.BuildAsync(false)).Objects.Single();
            Check(initial.History?.Count == 0, "Legacy registry without history must remain readable");
            InformationObjectUpdateModel Update(string version, string state, string expectedVersion, string expectedState) =>
                new("Документ", "Document", version, state, ["Документ"], expectedVersion, expectedState);
            var active = (await service.SaveAsync("legacy", Update("1", "Active", "1", "Draft"), false)).Objects.Single();
            Check(active.History?.Single().LifecycleState == "Draft", "Activation preserves previous draft metadata");
            await Reject(service, Update("1", "Archived", "1", "Draft"));
            await Reject(service, Update("2", "Active", "1", "Active"));
            var archived = (await service.SaveAsync("legacy", Update("1", "Archived", "1", "Active"), false)).Objects.Single();
            Check(archived.History?.Count == 2, "Archiving preserves the active metadata");
            await Reject(service, Update("1", "Draft", "1", "Archived"));
            var next = (await service.SaveAsync("legacy", Update("2", "Draft", "1", "Archived"), false)).Objects.Single();
            Check(next.Version == "2" && next.History?.Count == 3 && next.History.Last().LifecycleState == "Archived", "New version starts as draft and preserves archived predecessor");
            var reloaded = new InformationObjectRegistryService(catalog, environment);
            Check((await reloaded.BuildAsync(false)).Objects.Single().History?.Count == 3, "History survives service reload");
            var unchanged = (await reloaded.SaveAsync("legacy", Update("2", "Draft", "2", "Draft"), false)).Objects.Single();
            Check(unchanged.History?.Count == 3, "Unchanged save does not add a false revision");
            await Reject(reloaded, Update("1", "Draft", "2", "Draft"));
            await reloaded.SaveAsync("part", new("Часть", "Document", "1", "Draft", []), false);
            var kitUpdate = Update("2", "Draft", "2", "Draft") with { Components = [new("part", false, "1", "По запросу")] };
            var kit = (await reloaded.SaveAsync("legacy", kitUpdate, false)).Objects.Single(item => item.Id == "legacy");
            Check(kit.Components?.Single().Condition == "По запросу", "Composition stored with condition");
            var retained = (await reloaded.SaveAsync("legacy", Update("2", "Draft", "2", "Draft"), false)).Objects.Single(item => item.Id == "legacy");
            Check(retained.Components?.Count == 1, "Legacy update preserves composition");
            var beforeCycle = await File.ReadAllTextAsync(path);
            var cycleRejected = false;
            try { await reloaded.SaveAsync("part", new("Часть", "Document", "1", "Draft", [], Components: [new("legacy")]), false); }
            catch (InvalidDataException) { cycleRejected = true; }
            Check(cycleRejected && beforeCycle == await File.ReadAllTextAsync(path), "Cycle rejection leaves file unchanged");
            var cleared = (await reloaded.SaveAsync("legacy", kitUpdate with { Components = [] }, false)).Objects.Single(item => item.Id == "legacy");
            Check(cleared.Components?.Count == 0 && cleared.History?.Last().Components?.Single().ObjectId == "part", "Clear snapshots previous composition");
            var loadedAgain = new InformationObjectRegistryService(catalog, environment);
            var externalUpdate = Update("2", "Draft", "2", "Draft") with { ExternalSource = "Поставщик: учебный контрагент", ExternalRecipient = "Клиент: учебный заказчик" };
            var external = (await loadedAgain.SaveAsync("legacy", externalUpdate, false)).Objects.Single(item => item.Id == "legacy");
            Check(external.ExternalSource == externalUpdate.ExternalSource && external.ExternalRecipient == externalUpdate.ExternalRecipient, "Explicit external endpoints persist");
            var legacySave = (await loadedAgain.SaveAsync("legacy", Update("2", "Draft", "2", "Draft"), false)).Objects.Single(item => item.Id == "legacy");
            Check(legacySave.ExternalSource == externalUpdate.ExternalSource, "Old clients preserve external endpoints");
            await Reject(loadedAgain, externalUpdate with { ExternalSource = new string('x', 301) });
            var noExternal = (await loadedAgain.SaveAsync("legacy", externalUpdate with { ExternalSource = "", ExternalRecipient = "" }, false)).Objects.Single(item => item.Id == "legacy");
            Check(noExternal.ExternalSource == "" && noExternal.History?.Last().ExternalSource == externalUpdate.ExternalSource, "Explicit clear snapshots external participant");
            var finalReload = new InformationObjectRegistryService(catalog, environment);
            Check((await finalReload.BuildAsync(false)).Objects.Single(item => item.Id == "legacy").History?.Any(snapshot => snapshot.Components?.Count == 1) == true, "Composition history survives reload");
        }
        finally
        {
            if (Path.GetDirectoryName(root) != temp || !Path.GetFileName(root).StartsWith("pn-registry-check-")) throw new Exception("Unsafe fixture cleanup path");
            Directory.Delete(root, true);
        }
        return count;
    }

    private sealed class Environment(string root) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "RegistryChecks";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = root;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
