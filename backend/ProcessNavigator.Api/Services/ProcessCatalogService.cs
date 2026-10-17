using System.Text.RegularExpressions;
using System.IO.Compression;
using System.Xml.Linq;
using System.Text.Json.Nodes;
using System.Text;
using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessCatalogService(BpmnProcessLoader loader)
{
    private const long MaximumFileSize = 2 * 1024 * 1024;
    private const long MaximumPackageSize = 50 * 1024 * 1024;
    private const int MaximumPackageEntries = 500;
    private readonly SemaphoreSlim contextWriteLock = new(1, 1);
    private string DraftRoot => Path.Combine(loader.DataRoot, "Drafts");
    private string VersionRoot => Path.Combine(loader.DataRoot, "Versions");

    public async Task<IReadOnlyList<ProcessSummaryModel>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(loader.DataRoot)) return [];
        var summaries = new List<ProcessSummaryModel>();
        foreach (var bpmnPath in Directory.EnumerateFiles(loader.DataRoot, "*.bpmn", SearchOption.TopDirectoryOnly))
        {
            var contextPath = Path.ChangeExtension(bpmnPath, ".context.json");
            if (!File.Exists(contextPath)) continue;
            try
            {
                var process = await loader.LoadFilesAsync(bpmnPath, contextPath, cancellationToken: cancellationToken);
                ProcessModel? draft = null;
                try { draft = await TryLoadDraftAsync(process.Id, cancellationToken); }
                catch (Exception exception) when (exception is InvalidDataException or IOException or UnauthorizedAccessException or System.Xml.XmlException or JsonException)
                {
                    // A damaged draft must not hide its valid published edition. The catalog audit reports the broken file.
                }
                summaries.Add(ToSummary(process, draft));
            }
            catch (Exception exception) when (exception is InvalidDataException or IOException or UnauthorizedAccessException or System.Xml.XmlException or System.Text.Json.JsonException)
            {
                // Invalid source files are not exposed as usable catalog entries.
            }
        }
        if (Directory.Exists(DraftRoot))
        {
            foreach (var draftBpmn in Directory.EnumerateFiles(DraftRoot, "*.bpmn", SearchOption.TopDirectoryOnly))
            {
                var id = Path.GetFileNameWithoutExtension(draftBpmn);
                if (summaries.Any(item => string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase))) continue;
                var draftContext = Path.ChangeExtension(draftBpmn, ".context.json");
                if (!File.Exists(draftContext)) continue;
                try
                {
                    var draft = await loader.LoadFilesAsync(draftBpmn, draftContext, id, cancellationToken);
                    summaries.Add(ToSummary(draft, draft));
                }
                catch (Exception exception) when (exception is InvalidDataException or IOException or System.Xml.XmlException or JsonException) { }
            }
        }
        return summaries.OrderBy(process => process.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
    }

    public async Task<IReadOnlyList<ProcessHierarchyNodeModel>> HierarchyAsync(CancellationToken cancellationToken = default)
    {
        var catalog = await ListAsync(cancellationToken);
        var processes = new List<ProcessModel>();
        foreach (var item in catalog) processes.Add(await LoadAsync(item.Id, item.HasDraft, cancellationToken));
        var ids = processes.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var result = new List<ProcessHierarchyNodeModel>();
        foreach (var process in processes)
        {
            var passport = process.Passport ?? new ProcessPassportModel(); var issues = new List<string>();
            if (passport.ParentProcessId is not null && !ids.Contains(passport.ParentProcessId)) issues.Add("Родительский процесс не найден");
            if (passport.ParentProcessId is not null)
            {
                var parentProcess = processes.FirstOrDefault(item => item.Id.Equals(passport.ParentProcessId, StringComparison.OrdinalIgnoreCase));
                if (parentProcess is not null && (parentProcess.Passport?.Level ?? 0) != passport.Level - 1)
                    issues.Add("Уровень родителя должен быть на один выше");
            }
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { process.Id }; var parent = passport.ParentProcessId;
            while (parent is not null && ids.Contains(parent))
            {
                if (!visited.Add(parent)) { issues.Add("Обнаружена циклическая иерархия"); break; }
                parent = processes.First(item => item.Id.Equals(parent, StringComparison.OrdinalIgnoreCase)).Passport?.ParentProcessId;
            }
            if (passport.Level > 0 && passport.ParentProcessId is null) issues.Add("Для уровня выше 0 не выбран родитель");
            result.Add(new(process.Id, process.Name, process.Status, passport.Level, passport.Classification, passport.ParentProcessId, issues));
        }
        return result.OrderBy(item => item.Level).ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
    }

    public async Task<ProcessDecompositionMapModel> DecompositionAsync(bool includeDrafts = false, CancellationToken cancellationToken = default)
    {
        var hierarchy = await HierarchyAsync(cancellationToken);
        var hierarchyById = hierarchy.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var summaries = await ListAsync(cancellationToken);
        var links = new List<ProcessDecompositionLinkModel>();
        foreach (var summary in summaries)
        {
            if (summary.Status == "Draft" && !includeDrafts) continue;
            var source = await LoadAsync(summary.Id, draft: includeDrafts && (summary.HasDraft || summary.Status == "Draft"), cancellationToken);
            var sourceLevel = hierarchyById.GetValueOrDefault(summary.Id)?.Level ?? source.Passport?.Level ?? 2;
            foreach (var element in source.Nodes.Where(node => !string.IsNullOrWhiteSpace(node.LinkedProcessId)))
            {
                hierarchyById.TryGetValue(element.LinkedProcessId!, out var targetHierarchy);
                ProcessModel? target = null;
                var targetSummary = summaries.FirstOrDefault(item => item.Id.Equals(element.LinkedProcessId, StringComparison.OrdinalIgnoreCase));
                if (targetSummary is not null && (targetSummary.Status != "Draft" || includeDrafts))
                    target = await LoadAsync(targetSummary.Id, draft: includeDrafts && (targetSummary.HasDraft || targetSummary.Status == "Draft"), cancellationToken);
                var missingBoundaries = new List<string>();
                if ((element.Inputs?.Count ?? 0) == 0) missingBoundaries.Add("входы этапа верхнего уровня");
                if (string.IsNullOrWhiteSpace(element.ExpectedResult)) missingBoundaries.Add("результат этапа верхнего уровня");
                if (target is null) missingBoundaries.Add("доступная детальная схема");
                else
                {
                    if (string.IsNullOrWhiteSpace(target.Passport?.Trigger)) missingBoundaries.Add("событие запуска детального процесса");
                    if ((target.Passport?.Inputs?.Count ?? 0) == 0) missingBoundaries.Add("входы детального процесса");
                    if (string.IsNullOrWhiteSpace(target.Passport?.Result)) missingBoundaries.Add("результат детального процесса");
                    if ((target.Passport?.Outputs?.Count ?? 0) == 0) missingBoundaries.Add("выходы детального процесса");
                }
                links.Add(new(
                    summary.Id,
                    source.Name,
                    sourceLevel,
                    element.Id,
                    element.Name,
                    element.LinkedProcessId!,
                    target?.Name,
                    targetHierarchy?.Level,
                    missingBoundaries.Count == 0,
                    missingBoundaries));
            }
        }
        return new(hierarchy, links.OrderBy(item => item.SourceLevel).ThenBy(item => item.SourceProcessName).ThenBy(item => item.ElementName).ToArray());
    }

    public async Task<ProcessHierarchyNodeModel> SaveDraftHierarchyAsync(string processId, ProcessHierarchyUpdateModel update, CancellationToken cancellationToken = default)
    {
        if (update.Level is < 0 or > 20) throw new InvalidDataException("Process level must be between 0 and 20.");
        if (update.Classification is not ("Основной" or "Управляющий" or "Обеспечивающий" or "Обслуживающий")) throw new InvalidDataException("Unknown process classification.");
        if (processId.Equals(update.ParentProcessId, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Процесс не может быть родителем самому себе.");
        var parentId = string.IsNullOrWhiteSpace(update.ParentProcessId) ? null : update.ParentProcessId;
        if (parentId is not null)
        {
            var hierarchy = await HierarchyAsync(cancellationToken);
            var byId = hierarchy.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
            if (!byId.ContainsKey(parentId)) throw new InvalidDataException("Выбранный родительский процесс не найден.");
            string? cursor = parentId; var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            while (cursor is not null && visited.Add(cursor) && byId.TryGetValue(cursor, out var node))
            {
                if (cursor.Equals(processId, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Такая связь создаёт цикл в иерархии процессов.");
                cursor = node.ParentProcessId;
            }
        }
        var paths = DraftPaths(processId); if (!File.Exists(paths.Context)) await CreateDraftAsync(processId, cancellationToken);
        await contextWriteLock.WaitAsync(cancellationToken); string? temporaryPath = null;
        try
        {
            var root = JsonNode.Parse(await File.ReadAllTextAsync(paths.Context, cancellationToken))?.AsObject() ?? throw new InvalidDataException("Process context JSON is empty.");
            var current = root["passport"]?.Deserialize<ProcessPassportModel>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new ProcessPassportModel();
            var updated = current with { Level = update.Level, Classification = update.Classification, ParentProcessId = parentId };
            root["passport"] = JsonSerializer.SerializeToNode(updated, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            temporaryPath = Path.Combine(Path.GetDirectoryName(paths.Context)!, $".{Guid.NewGuid():N}.context.tmp");
            await File.WriteAllTextAsync(temporaryPath, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false), cancellationToken);
            var validated = await loader.LoadFilesAsync(paths.Bpmn, temporaryPath, processId, cancellationToken); File.Move(temporaryPath, paths.Context, true); temporaryPath = null;
            return new(validated.Id, validated.Name, validated.Status, updated.Level, updated.Classification, updated.ParentProcessId, []);
        }
        finally { if (temporaryPath is not null) File.Delete(temporaryPath); contextWriteLock.Release(); }
    }

    public async Task<IReadOnlyList<ProcessHierarchyNodeModel>> SaveDraftHierarchyBulkAsync(ProcessHierarchyBulkUpdateModel update, CancellationToken cancellationToken = default)
    {
        var ids = update.ProcessIds.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (ids.Length is 0 or > 200) throw new InvalidDataException("Выберите от 1 до 200 процессов.");
        if (update.Level is null && string.IsNullOrWhiteSpace(update.Classification)) throw new InvalidDataException("Не выбрано ни одного изменения.");
        if (update.Level is < 0 or > 20) throw new InvalidDataException("Process level must be between 0 and 20.");
        if (update.Classification is not null && update.Classification is not ("Основной" or "Управляющий" or "Обеспечивающий" or "Обслуживающий"))
            throw new InvalidDataException("Unknown process classification.");

        var hierarchy = await HierarchyAsync(cancellationToken);
        var byId = hierarchy.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        if (ids.FirstOrDefault(id => !byId.ContainsKey(id)) is { } missing) throw new FileNotFoundException($"Process '{missing}' was not found.");
        var result = new List<ProcessHierarchyNodeModel>(ids.Length);
        foreach (var id in ids)
        {
            var current = byId[id];
            result.Add(await SaveDraftHierarchyAsync(id, new(update.Level ?? current.Level, update.Classification ?? current.Classification, current.ParentProcessId), cancellationToken));
        }
        return result;
    }

    public async Task<ProcessImportResultModel> CreateAsync(CreateProcessModel request, CancellationToken cancellationToken = default)
    {
        var id = request.Id?.Trim();
        if (string.IsNullOrWhiteSpace(id)) id = $"process-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}";
        if (!SafeProcessId().IsMatch(id))
            throw new InvalidDataException("Process ID may contain only Latin letters, digits, dots, underscores and hyphens.");
        var name = RequiredText(request.Name, 200, "Process name");
        const string owner = "Не назначен";
        const string laneName = "Подразделение";
        if (File.Exists(loader.GetBpmnPath(id)) || File.Exists(DraftPaths(id).Bpmn))
            throw new ProcessConflictException($"Process '{id}' already exists.");

        Directory.CreateDirectory(DraftRoot);
        var paths = DraftPaths(id);
        var xml = BlankBpmn(id, name, laneName);
        var context = JsonSerializer.Serialize(new { version = "0.1", owner, status = "Draft", elements = new { } },
            new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });
        await File.WriteAllTextAsync(paths.Bpmn, xml, new UTF8Encoding(false), cancellationToken);
        try
        {
            await File.WriteAllTextAsync(paths.Context, context, new UTF8Encoding(false), cancellationToken);
            var process = await loader.LoadFilesAsync(paths.Bpmn, paths.Context, id, cancellationToken);
            return new ProcessImportResultModel(ToSummary(process), ContextWarnings(process));
        }
        catch
        {
            File.Delete(paths.Bpmn); File.Delete(paths.Context); throw;
        }
    }

    public async Task<ProcessImportResultModel> ImportAsync(
        IFormFile bpmnFile,
        IFormFile? contextFile,
        CancellationToken cancellationToken = default)
    {
        ValidateUpload(bpmnFile, ".bpmn", "BPMN");
        if (contextFile is not null) ValidateUpload(contextFile, ".json", "context");

        var temporaryDirectory = Directory.CreateTempSubdirectory("process-navigator-");
        try
        {
            var temporaryBpmn = Path.Combine(temporaryDirectory.FullName, "process.bpmn");
            var temporaryContext = Path.Combine(temporaryDirectory.FullName, "process.context.json");
            await SaveUploadAsync(bpmnFile, temporaryBpmn, cancellationToken);
            if (contextFile is not null)
                await SaveUploadAsync(contextFile, temporaryContext, cancellationToken);
            else
                await File.WriteAllTextAsync(temporaryContext,
                    "{\"version\":\"0.1\",\"owner\":\"Не назначен\",\"status\":\"Draft\",\"elements\":{}}",
                    cancellationToken);

            var process = await loader.LoadFilesAsync(temporaryBpmn, temporaryContext, cancellationToken: cancellationToken);
            if (!SafeProcessId().IsMatch(process.Id))
                throw new InvalidDataException("Process ID may contain only Latin letters, digits, dots, underscores and hyphens.");

            if (File.Exists(loader.GetBpmnPath(process.Id)))
                throw new ProcessConflictException($"Process '{process.Id}' already exists.");

            Directory.CreateDirectory(loader.DataRoot);
            var destinationBpmn = Path.Combine(loader.DataRoot, $"{process.Id}.bpmn");
            var destinationContext = Path.Combine(loader.DataRoot, $"{process.Id}.context.json");
            File.Copy(temporaryBpmn, destinationBpmn, overwrite: false);
            try
            {
                File.Copy(temporaryContext, destinationContext, overwrite: false);
            }
            catch
            {
                File.Delete(destinationBpmn);
                throw;
            }

            var warnings = new List<string>();
            var elementsWithoutContext = process.Nodes.Count(node =>
                string.IsNullOrWhiteSpace(node.Description) &&
                string.IsNullOrWhiteSpace(node.Responsible) &&
                (node.Actions?.Count ?? 0) == 0 &&
                (node.Artifacts?.Count ?? 0) == 0);
            if (elementsWithoutContext > 0)
                warnings.Add($"{elementsWithoutContext} element(s) have no Process Navigator context.");

            return new ProcessImportResultModel(ToSummary(process), warnings);
        }
        finally
        {
            temporaryDirectory.Delete(recursive: true);
        }
    }

    public async Task<ProcessPackageImportResultModel> ImportPackageAsync(
        IFormFile packageFile,
        CancellationToken cancellationToken = default)
    {
        if (packageFile.Length == 0) throw new InvalidDataException("The process package is empty.");
        if (packageFile.Length > MaximumPackageSize) throw new InvalidDataException("The process package exceeds the 50 MB limit.");
        if (!string.Equals(Path.GetExtension(packageFile.FileName), ".zip", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The process package must be a ZIP file.");

        var temporaryDirectory = Directory.CreateTempSubdirectory("process-navigator-package-");
        try
        {
            var packagePath = Path.Combine(temporaryDirectory.FullName, "package.zip");
            await SaveUploadAsync(packageFile, packagePath, cancellationToken);
            using var archive = ZipFile.OpenRead(packagePath);
            if (archive.Entries.Count > MaximumPackageEntries)
                throw new InvalidDataException($"The package contains more than {MaximumPackageEntries} entries.");

            var bpmnEntries = archive.Entries
                .Where(entry => string.Equals(Path.GetExtension(entry.Name), ".bpmn", StringComparison.OrdinalIgnoreCase))
                .OrderBy(entry => entry.FullName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (bpmnEntries.Length == 0) throw new InvalidDataException("The package contains no BPMN files.");

            var passportEntries = archive.Entries
                .Where(entry => string.Equals(Path.GetExtension(entry.Name), ".md", StringComparison.OrdinalIgnoreCase))
                .ToDictionary(entry => Path.GetFileNameWithoutExtension(entry.Name), StringComparer.OrdinalIgnoreCase);
            var items = new List<ProcessPackageImportItemModel>();
            Directory.CreateDirectory(DraftRoot);
            Directory.CreateDirectory(Path.Combine(loader.DataRoot, "Passports"));

            foreach (var entry in bpmnEntries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (entry.Length <= 0 || entry.Length > MaximumFileSize)
                {
                    items.Add(new(entry.FullName, "Failed", null, [], "The BPMN file is empty or exceeds 2 MB."));
                    continue;
                }

                var itemDirectory = Directory.CreateDirectory(Path.Combine(temporaryDirectory.FullName, Guid.NewGuid().ToString("N")));
                var temporaryBpmn = Path.Combine(itemDirectory.FullName, "process.bpmn");
                var temporaryContext = Path.Combine(itemDirectory.FullName, "process.context.json");
                try
                {
                    await using (var source = entry.Open())
                    await using (var destination = File.Create(temporaryBpmn))
                        await source.CopyToAsync(destination, cancellationToken);

                    var metadata = await ReadPackageMetadataAsync(temporaryBpmn, cancellationToken);
                    if (!SafeProcessId().IsMatch(metadata.Id))
                        throw new InvalidDataException($"Process ID '{metadata.Id}' contains unsupported characters.");
                    if (File.Exists(loader.GetBpmnPath(metadata.Id)) || File.Exists(DraftPaths(metadata.Id).Bpmn))
                    {
                        items.Add(new(entry.FullName, "Skipped", null, [], $"Process '{metadata.Id}' already exists."));
                        continue;
                    }

                    passportEntries.TryGetValue(Path.GetFileNameWithoutExtension(entry.Name), out var passportEntry);
                    var passport = passportEntry is null ? null : await ReadTextEntryAsync(passportEntry, cancellationToken);
                    var owner = PassportOwner(passport) ?? "Не назначен";
                    var elements = metadata.Elements.ToDictionary(
                        element => element.Id,
                        element => new
                        {
                            description = element.Documentation ?? element.Name,
                            responsible = element.LaneName,
                            duration = (string?)null,
                            artifacts = Array.Empty<ArtifactModel>(),
                            actions = Array.Empty<ActionModel>()
                        });
                    var context = JsonSerializer.Serialize(new
                    {
                        version = "0.1",
                        owner,
                        status = "Draft",
                        source = new { package = packageFile.FileName, bpmn = entry.FullName, passport = passportEntry?.FullName },
                        elements
                    }, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });
                    await File.WriteAllTextAsync(temporaryContext, context, new UTF8Encoding(false), cancellationToken);
                    var validated = await loader.LoadFilesAsync(temporaryBpmn, temporaryContext, metadata.Id, cancellationToken);

                    var paths = DraftPaths(metadata.Id);
                    File.Copy(temporaryBpmn, paths.Bpmn, overwrite: false);
                    try
                    {
                        File.Copy(temporaryContext, paths.Context, overwrite: false);
                        if (!string.IsNullOrWhiteSpace(passport))
                            await File.WriteAllTextAsync(Path.Combine(loader.DataRoot, "Passports", $"{metadata.Id}.md"), passport, new UTF8Encoding(false), cancellationToken);
                    }
                    catch
                    {
                        File.Delete(paths.Bpmn);
                        File.Delete(paths.Context);
                        throw;
                    }

                    var warnings = new List<string>();
                    if (passportEntry is null) warnings.Add("No process passport was found in the package.");
                    warnings.Add("Organization bindings must be reviewed before publication.");
                    items.Add(new(entry.FullName, "Imported", ToSummary(validated, validated), warnings));
                }
                catch (Exception exception) when (exception is InvalidDataException or IOException or System.Xml.XmlException or JsonException)
                {
                    items.Add(new(entry.FullName, "Failed", null, [], exception.Message));
                }
            }

            return new ProcessPackageImportResultModel(
                bpmnEntries.Length,
                items.Count(item => item.Status == "Imported"),
                items.Count(item => item.Status == "Skipped"),
                items.Count(item => item.Status == "Failed"),
                items);
        }
        catch (InvalidDataException) { throw; }
        catch (Exception exception) when (exception is InvalidDataException or IOException)
        {
            throw new InvalidDataException("The ZIP package could not be read.", exception);
        }
        finally
        {
            temporaryDirectory.Delete(recursive: true);
        }
    }

    public async Task<ProcessModel> LoadAsync(string processId, bool draft, CancellationToken cancellationToken = default)
    {
        if (!draft) return await loader.LoadAsync(processId, cancellationToken);
        var (bpmnPath, contextPath) = DraftPaths(processId);
        if (!File.Exists(bpmnPath) || !File.Exists(contextPath))
            throw new FileNotFoundException($"Draft for process '{processId}' was not found.");
        return await loader.LoadFilesAsync(bpmnPath, contextPath, processId, cancellationToken);
    }

    public async Task<ProcessModel> LoadArchivedAsync(string processId, string version, CancellationToken cancellationToken = default)
    {
        var directory = Path.Combine(VersionRoot, processId, SafeFilePart(version));
        var bpmnPath = Path.Combine(directory, "process.bpmn");
        var contextPath = Path.Combine(directory, "process.context.json");
        if (!File.Exists(bpmnPath) || !File.Exists(contextPath))
            throw new FileNotFoundException($"Archived version '{version}' of process '{processId}' was not found.");
        return await loader.LoadFilesAsync(bpmnPath, contextPath, processId, cancellationToken);
    }

    public string GetBpmnSourcePath(string processId, bool draft)
    {
        if (!draft) return loader.GetBpmnPath(processId);
        var path = DraftPaths(processId).Bpmn;
        return File.Exists(path) ? path : Path.Combine(DraftRoot, "__missing__.bpmn");
    }

    public async Task<ProcessImportResultModel> SaveDraftXmlAsync(string processId, string xml, CancellationToken cancellationToken = default)
    {
        await EnsureDraftEditableAsync(processId, cancellationToken);
        if (string.IsNullOrWhiteSpace(xml)) throw new InvalidDataException("BPMN XML is empty.");
        if (Encoding.UTF8.GetByteCount(xml) > MaximumFileSize) throw new InvalidDataException("The BPMN file exceeds the 2 MB limit.");
        var paths = DraftPaths(processId);
        if (!File.Exists(paths.Bpmn) || !File.Exists(paths.Context))
            throw new FileNotFoundException($"Draft for process '{processId}' was not found.");

        var temporaryPath = Path.Combine(Path.GetTempPath(), $"process-navigator-{Guid.NewGuid():N}.bpmn");
        try
        {
            await File.WriteAllTextAsync(temporaryPath, xml, new UTF8Encoding(false), cancellationToken);
            var validated = await loader.LoadFilesAsync(temporaryPath, paths.Context, processId, cancellationToken);
            File.Copy(temporaryPath, paths.Bpmn, overwrite: true);
            return new ProcessImportResultModel(ToSummary(validated), ContextWarnings(validated));
        }
        finally
        {
            File.Delete(temporaryPath);
        }
    }

    public async Task<ProcessSummaryModel> SaveGeneratedDraftAsync(
        string processId,
        string bpmnXml,
        string contextJson,
        CancellationToken cancellationToken = default)
    {
        if (!SafeProcessId().IsMatch(processId)) throw new InvalidDataException("The process ID is invalid.");
        if (string.IsNullOrWhiteSpace(bpmnXml) || Encoding.UTF8.GetByteCount(bpmnXml) > MaximumFileSize)
            throw new InvalidDataException("The generated BPMN is empty or exceeds the 2 MB limit.");
        if (string.IsNullOrWhiteSpace(contextJson) || Encoding.UTF8.GetByteCount(contextJson) > MaximumFileSize)
            throw new InvalidDataException("The generated context is empty or exceeds the 2 MB limit.");

        var paths = DraftPaths(processId);
        var publishedPath = loader.GetBpmnPath(processId);
        var version = "0.1";
        if (File.Exists(paths.Bpmn) && File.Exists(paths.Context))
        {
            await EnsureDraftEditableAsync(processId, cancellationToken);
            version = (await loader.LoadFilesAsync(paths.Bpmn, paths.Context, processId, cancellationToken)).Version;
        }
        else if (File.Exists(publishedPath))
            version = NextVersion((await loader.LoadAsync(processId, cancellationToken)).Version);

        var temporaryDirectory = Directory.CreateTempSubdirectory("process-navigator-table-");
        try
        {
            var temporaryBpmn = Path.Combine(temporaryDirectory.FullName, "process.bpmn");
            var temporaryContext = Path.Combine(temporaryDirectory.FullName, "process.context.json");
            await File.WriteAllTextAsync(temporaryBpmn, bpmnXml, new UTF8Encoding(false), cancellationToken);
            await File.WriteAllTextAsync(temporaryContext, contextJson, new UTF8Encoding(false), cancellationToken);
            await UpdateContextAsync(temporaryContext, version, "Draft", cancellationToken);
            var validated = await loader.LoadFilesAsync(temporaryBpmn, temporaryContext, processId, cancellationToken);

            Directory.CreateDirectory(DraftRoot);
            File.Move(temporaryBpmn, paths.Bpmn, overwrite: true);
            File.Move(temporaryContext, paths.Context, overwrite: true);
            return ToSummary(validated);
        }
        finally { temporaryDirectory.Delete(recursive: true); }
    }

    public async Task<NodeModel> SaveDraftElementContextAsync(
        string processId,
        string elementId,
        ElementContextUpdateModel update,
        CancellationToken cancellationToken = default)
    {
        await EnsureDraftEditableAsync(processId, cancellationToken);
        if (!SafeProcessId().IsMatch(processId)) throw new FileNotFoundException();
        if (string.IsNullOrWhiteSpace(elementId) || elementId.Length > 200)
            throw new InvalidDataException("The BPMN element ID is invalid.");
        var normalized = NormalizeContext(update);
        await ValidateLinkedProcessAsync(processId, normalized.LinkedProcessId, cancellationToken);
        await ValidateParticipantUnitRefsAsync(normalized.ParticipantUnitRefs ?? [], cancellationToken);
        var paths = DraftPaths(processId);
        if (!File.Exists(paths.Bpmn) || !File.Exists(paths.Context))
            throw new FileNotFoundException($"Draft for process '{processId}' was not found.");

        await contextWriteLock.WaitAsync(cancellationToken);
        string? temporaryPath = null;
        try
        {
            var current = await loader.LoadFilesAsync(paths.Bpmn, paths.Context, processId, cancellationToken);
            if (current.Nodes.All(node => !string.Equals(node.Id, elementId, StringComparison.Ordinal)))
                throw new KeyNotFoundException(elementId);

            var root = JsonNode.Parse(await File.ReadAllTextAsync(paths.Context, cancellationToken))?.AsObject()
                ?? throw new InvalidDataException("Process context JSON is empty.");
            var elements = root["elements"] as JsonObject ?? new JsonObject();
            root["elements"] = elements;
            elements[elementId] = JsonSerializer.SerializeToNode(normalized,
                new JsonSerializerOptions(JsonSerializerDefaults.Web));

            temporaryPath = Path.Combine(Path.GetDirectoryName(paths.Context)!, $".{Guid.NewGuid():N}.context.tmp");
            await File.WriteAllTextAsync(temporaryPath,
                root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false), cancellationToken);
            var validated = await loader.LoadFilesAsync(paths.Bpmn, temporaryPath, processId, cancellationToken);
            File.Move(temporaryPath, paths.Context, overwrite: true);
            temporaryPath = null;
            return validated.Nodes.Single(node => string.Equals(node.Id, elementId, StringComparison.Ordinal));
        }
        finally
        {
            if (temporaryPath is not null) File.Delete(temporaryPath);
            contextWriteLock.Release();
        }
    }

    public async Task<ProcessModel> SaveDraftPropertiesAsync(
        string processId,
        ProcessPropertiesUpdateModel update,
        CancellationToken cancellationToken = default)
    {
        await EnsureDraftEditableAsync(processId, cancellationToken);
        if (!SafeProcessId().IsMatch(processId)) throw new FileNotFoundException();
        if (string.IsNullOrWhiteSpace(update.Owner) || update.Owner.Length > 300)
            throw new InvalidDataException("Process owner department is required.");
        if (update.Passport is { Level: < 0 or > 20 }) throw new InvalidDataException("Process level must be between 0 and 20.");
        if (update.Passport is not null && update.Passport.Classification is not ("Основной" or "Управляющий" or "Обеспечивающий" or "Обслуживающий"))
            throw new InvalidDataException("Unknown process classification.");
        var triggerOptions = (update.Passport?.TriggerOptions ?? []).Select(item => item?.Trim())
            .Where(item => !string.IsNullOrWhiteSpace(item)).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase).Take(21).ToArray();
        if (triggerOptions.Length > 20) throw new InvalidDataException("В паспорте процесса допускается не более 20 вариантов запуска.");
        if (triggerOptions.Any(item => item!.Length > 300)) throw new InvalidDataException("Вариант запуска не должен превышать 300 символов.");
        var normalizedRequirements = NormalizeSourceRequirements(update.Passport?.SourceRequirements);
        var passport = (update.Passport ?? new ProcessPassportModel()) with { TriggerOptions = triggerOptions, SourceRequirements = normalizedRequirements };
        var paths = DraftPaths(processId);
        if (!File.Exists(paths.Bpmn) || !File.Exists(paths.Context))
            throw new FileNotFoundException($"Draft for process '{processId}' was not found.");

        await contextWriteLock.WaitAsync(cancellationToken);
        string? temporaryPath = null;
        try
        {
            var root = JsonNode.Parse(await File.ReadAllTextAsync(paths.Context, cancellationToken))?.AsObject()
                ?? throw new InvalidDataException("Process context JSON is empty.");
            root["owner"] = update.Owner.Trim();
            root["ownerLegalEntityId"] = update.OwnerLegalEntityId;
            root["ownerUnitId"] = update.OwnerUnitId;
            root["passport"] = JsonSerializer.SerializeToNode(passport, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            temporaryPath = Path.Combine(Path.GetDirectoryName(paths.Context)!, $".{Guid.NewGuid():N}.context.tmp");
            await File.WriteAllTextAsync(temporaryPath,
                root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false), cancellationToken);
            var validated = await loader.LoadFilesAsync(paths.Bpmn, temporaryPath, processId, cancellationToken);
            File.Move(temporaryPath, paths.Context, overwrite: true);
            temporaryPath = null;
            return validated;
        }
        finally
        {
            if (temporaryPath is not null) File.Delete(temporaryPath);
            contextWriteLock.Release();
        }
    }

    public async Task<ProcessSummaryModel> CreateDraftAsync(string processId, CancellationToken cancellationToken = default)
    {
        var published = await loader.LoadAsync(processId, cancellationToken);
        var (draftBpmn, draftContext) = DraftPaths(processId);
        if (File.Exists(draftBpmn) || File.Exists(draftContext))
            throw new ProcessConflictException($"Process '{processId}' already has a draft.");

        Directory.CreateDirectory(DraftRoot);
        File.Copy(loader.GetBpmnPath(processId), draftBpmn, overwrite: false);
        try
        {
            File.Copy(Path.ChangeExtension(loader.GetBpmnPath(processId), ".context.json"), draftContext, overwrite: false);
            await UpdateContextAsync(draftContext, NextVersion(published.Version), "Draft", cancellationToken);
            var draft = await loader.LoadFilesAsync(draftBpmn, draftContext, processId, cancellationToken);
            return ToSummary(published, draft);
        }
        catch
        {
            File.Delete(draftBpmn);
            File.Delete(draftContext);
            throw;
        }
    }

    public async Task<ProcessImportResultModel> ReplaceDraftAsync(
        string processId,
        IFormFile bpmnFile,
        IFormFile? contextFile,
        CancellationToken cancellationToken = default)
    {
        await EnsureDraftEditableAsync(processId, cancellationToken);
        ValidateUpload(bpmnFile, ".bpmn", "BPMN");
        if (contextFile is not null) ValidateUpload(contextFile, ".json", "context");
        var existingDraft = await LoadAsync(processId, draft: true, cancellationToken);
        var temporaryDirectory = Directory.CreateTempSubdirectory("process-navigator-draft-");
        try
        {
            var temporaryBpmn = Path.Combine(temporaryDirectory.FullName, "process.bpmn");
            var temporaryContext = Path.Combine(temporaryDirectory.FullName, "process.context.json");
            await SaveUploadAsync(bpmnFile, temporaryBpmn, cancellationToken);
            if (contextFile is null)
                File.Copy(DraftPaths(processId).Context, temporaryContext);
            else
                await SaveUploadAsync(contextFile, temporaryContext, cancellationToken);
            await UpdateContextAsync(temporaryContext, existingDraft.Version, "Draft", cancellationToken);
            var validated = await loader.LoadFilesAsync(temporaryBpmn, temporaryContext, processId, cancellationToken);
            var paths = DraftPaths(processId);
            File.Copy(temporaryBpmn, paths.Bpmn, overwrite: true);
            File.Copy(temporaryContext, paths.Context, overwrite: true);
            return new ProcessImportResultModel(ToSummary(validated), ContextWarnings(validated));
        }
        finally
        {
            temporaryDirectory.Delete(recursive: true);
        }
    }

    public async Task<ProcessSummaryModel> PublishDraftAsync(string processId, CancellationToken cancellationToken = default)
    {
        var draft = await LoadAsync(processId, draft: true, cancellationToken);
        if (!draft.Status.Equals("Approved", StringComparison.OrdinalIgnoreCase))
            throw new IOException("Перед публикацией редакция должна пройти согласование и получить статус «Одобрено».");
        var publishedBpmn = loader.GetBpmnPath(processId);
        var publishedContext = Path.ChangeExtension(publishedBpmn, ".context.json");
        if (File.Exists(publishedBpmn) && File.Exists(publishedContext))
        {
            var published = await loader.LoadAsync(processId, cancellationToken);
            var archiveDirectory = Path.Combine(VersionRoot, processId, SafeFilePart(published.Version));
            Directory.CreateDirectory(archiveDirectory);
            File.Copy(publishedBpmn, Path.Combine(archiveDirectory, "process.bpmn"), overwrite: false);
            File.Copy(publishedContext, Path.Combine(archiveDirectory, "process.context.json"), overwrite: false);
        }

        var draftPaths = DraftPaths(processId);
        await UpdateContextAsync(draftPaths.Context, draft.Version, "Published", cancellationToken);
        File.Copy(draftPaths.Bpmn, publishedBpmn, overwrite: true);
        File.Copy(draftPaths.Context, publishedContext, overwrite: true);
        File.Delete(draftPaths.Bpmn);
        File.Delete(draftPaths.Context);
        return ToSummary(await loader.LoadAsync(processId, cancellationToken));
    }

    public async Task<int> SyncDraftLaneNamesAsync(string processId, IReadOnlyList<LaneOrganizationModel> mappings,
        OrganizationMapModel organization, CancellationToken cancellationToken = default)
    {
        await EnsureDraftEditableAsync(processId, cancellationToken);
        var paths = DraftPaths(processId);
        var current = await loader.LoadFilesAsync(paths.Bpmn, paths.Context, processId, cancellationToken);
        var mapped = mappings.ToDictionary(item => item.LaneId, StringComparer.Ordinal);
        if (mapped.Count != current.Lanes.Count || current.Lanes.Any(lane => !mapped.ContainsKey(lane.Id)))
            throw new InvalidDataException("Состав дорожек изменился после сохранения оргпривязок. Проверьте их в процессе.");

        var document = XDocument.Parse(await File.ReadAllTextAsync(paths.Bpmn, cancellationToken), LoadOptions.PreserveWhitespace);
        var lanes = document.Descendants().Where(item => item.Name.LocalName == "lane" &&
            item.Name.NamespaceName == "http://www.omg.org/spec/BPMN/20100524/MODEL")
            .ToDictionary(item => (string?)item.Attribute("id") ?? "", StringComparer.Ordinal);
        var renamed = 0;
        foreach (var lane in current.Lanes)
        {
            var mapping = mapped[lane.Id];
            var entity = organization.LegalEntities.FirstOrDefault(item => item.Id.Equals(mapping.LegalEntityId, StringComparison.OrdinalIgnoreCase));
            var unit = entity?.Units?.FirstOrDefault(item => item.Id.Equals(mapping.UnitId, StringComparison.OrdinalIgnoreCase));
            if (unit is null || !lanes.TryGetValue(lane.Id, out var laneElement))
                throw new InvalidDataException($"Не удалось сопоставить дорожку «{lane.Name}» с подразделением оргструктуры.");
            var expected = mapping.DisplayNameMode == "short" && !string.IsNullOrWhiteSpace(unit.ShortName) ? unit.ShortName : unit.Name;
            if (lane.Name.Equals(expected, StringComparison.Ordinal)) continue;
            laneElement.SetAttributeValue("name", expected);
            renamed++;
        }
        if (renamed == 0) return 0;

        var temporaryPath = Path.Combine(Path.GetDirectoryName(paths.Bpmn)!, $".{Guid.NewGuid():N}.bpmn.tmp");
        try
        {
            await File.WriteAllTextAsync(temporaryPath, document.ToString(SaveOptions.DisableFormatting), new UTF8Encoding(false), cancellationToken);
            await loader.LoadFilesAsync(temporaryPath, paths.Context, processId, cancellationToken);
            File.Move(temporaryPath, paths.Bpmn, overwrite: true);
            return renamed;
        }
        finally { File.Delete(temporaryPath); }
    }

    public async Task EnsureDraftEditableAsync(string processId, CancellationToken cancellationToken = default)
    {
        var draft = await LoadAsync(processId, draft: true, cancellationToken);
        if (draft.Status is not ("Draft" or "ChangesRequested"))
            throw new IOException("Редакция находится на согласовании. Для изменения верните её в черновик или на доработку.");
    }

    public async Task<ProcessWorkflowModel> WorkflowAsync(string processId, CancellationToken cancellationToken = default)
    {
        var paths = DraftPaths(processId);
        if (!File.Exists(paths.Context)) throw new FileNotFoundException();
        var root = JsonNode.Parse(await File.ReadAllTextAsync(paths.Context, cancellationToken))?.AsObject() ?? throw new InvalidDataException("Process context JSON is empty.");
        var status = root["status"]?.GetValue<string>() ?? "Draft";
        var events = root["workflow"]?.Deserialize<List<ProcessWorkflowEventModel>>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
        return BuildWorkflow(processId, status, root, events);
    }

    public async Task<ProcessWorkflowModel> ConfigureWorkflowAsync(string processId, ProcessWorkflowRouteUpdateModel request, CancellationToken cancellationToken = default)
    {
        var paths = DraftPaths(processId);
        if (!File.Exists(paths.Context)) throw new FileNotFoundException();
        if (request.Stages.Count is < 1 or > 10) throw new InvalidDataException("Маршрут должен содержать от одного до десяти этапов.");
        var stages = request.Stages.Select(stage => new ProcessWorkflowStageModel(
            stage.Name.Trim(), Math.Clamp(stage.RequiredApprovals, 1, 20),
            (stage.ApproverUserIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray())).ToArray();
        if (stages.Any(stage => string.IsNullOrWhiteSpace(stage.Name))) throw new InvalidDataException("Укажите название каждого этапа согласования.");
        if (stages.Any(stage => stage.ApproverUserIds is { Count: > 0 } && stage.RequiredApprovals > stage.ApproverUserIds.Count))
            throw new InvalidDataException("Число обязательных решений не может превышать число назначенных согласующих.");
        await contextWriteLock.WaitAsync(cancellationToken); string? temporaryPath = null;
        try
        {
            var root = JsonNode.Parse(await File.ReadAllTextAsync(paths.Context, cancellationToken))?.AsObject() ?? throw new InvalidDataException("Process context JSON is empty.");
            var status = root["status"]?.GetValue<string>() ?? "Draft";
            if (status is not ("Draft" or "ChangesRequested")) throw new InvalidDataException("Маршрут можно менять только в черновике или после возврата на доработку.");
            root["workflowStages"] = JsonSerializer.SerializeToNode(stages, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            root["workflowCurrentStage"] = 0;
            root["workflowReviewDueAt"] = request.ReviewDueAt is null ? null : JsonValue.Create(request.ReviewDueAt.Value);
            temporaryPath = Path.Combine(Path.GetDirectoryName(paths.Context)!, $".{Guid.NewGuid():N}.context.tmp");
            await File.WriteAllTextAsync(temporaryPath, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false), cancellationToken);
            await loader.LoadFilesAsync(paths.Bpmn, temporaryPath, processId, cancellationToken); File.Move(temporaryPath, paths.Context, true); temporaryPath = null;
            var events = root["workflow"]?.Deserialize<List<ProcessWorkflowEventModel>>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
            return BuildWorkflow(processId, status, root, events);
        }
        finally { if (temporaryPath is not null) File.Delete(temporaryPath); contextWriteLock.Release(); }
    }

    public async Task<ProcessWorkflowModel> TransitionWorkflowAsync(string processId, string action, ProcessWorkflowActionModel request, UserProfileModel user, CancellationToken cancellationToken = default)
    {
        var paths = DraftPaths(processId);
        if (!File.Exists(paths.Context)) throw new FileNotFoundException();
        await contextWriteLock.WaitAsync(cancellationToken); string? temporaryPath = null;
        try
        {
            var root = JsonNode.Parse(await File.ReadAllTextAsync(paths.Context, cancellationToken))?.AsObject() ?? throw new InvalidDataException("Process context JSON is empty.");
            var from = root["status"]?.GetValue<string>() ?? "Draft";
            var stages = ReadWorkflowStages(root);
            var currentStage = Math.Clamp(root["workflowCurrentStage"]?.GetValue<int>() ?? 0, 0, stages.Count - 1);
            var stage = stages[currentStage];
            var events = root["workflow"]?.Deserialize<List<ProcessWorkflowEventModel>>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
            if (action.Equals("approve", StringComparison.OrdinalIgnoreCase) && stage.ApproverUserIds is { Count: > 0 } && !stage.ApproverUserIds.Contains(user.Id, StringComparer.OrdinalIgnoreCase))
                throw new InvalidDataException($"Текущий пользователь не включён в список согласующих этапа «{stage.Name}».");
            var cycleStartedAt = events.Where(item => item.Action is "submit" or "reject" or "reopen").Select(item => item.OccurredAt).DefaultIfEmpty(DateTimeOffset.MinValue).Max();
            var currentApprovals = events.Where(item => item.Action == "approve" && item.StageIndex == currentStage && item.OccurredAt > cycleStartedAt).ToArray();
            if (action.Equals("approve", StringComparison.OrdinalIgnoreCase) && currentApprovals.Any(item => item.UserId.Equals(user.Id, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Вы уже согласовали текущий этап.");
            var approvalsAfterAction = currentApprovals.Length + (action.Equals("approve", StringComparison.OrdinalIgnoreCase) ? 1 : 0);
            var lastApproval = approvalsAfterAction >= stage.RequiredApprovals;
            var to = (action.ToLowerInvariant(), from) switch
            {
                ("submit", "Draft" or "ChangesRequested") => "InReview",
                ("approve", "InReview") when lastApproval && currentStage == stages.Count - 1 => "Approved",
                ("approve", "InReview") => "InReview",
                ("reject", "InReview") => "ChangesRequested",
                ("reopen", "Approved") => "Draft",
                _ => throw new InvalidDataException($"Переход «{action}» недоступен для статуса «{from}».")
            };
            var comment = string.IsNullOrWhiteSpace(request.Comment) ? null : request.Comment.Trim();
            if (action.Equals("reject", StringComparison.OrdinalIgnoreCase) && comment is null) throw new InvalidDataException("При возврате на доработку укажите замечание.");
            if (comment?.Length > 2000) throw new InvalidDataException("Комментарий не должен превышать 2000 символов.");
            events.Add(new(action, from, to, user.Id, user.DisplayName, comment, DateTimeOffset.UtcNow, currentStage, stage.Name)); root["status"] = to;
            if (action.Equals("submit", StringComparison.OrdinalIgnoreCase) || action.Equals("reject", StringComparison.OrdinalIgnoreCase) || action.Equals("reopen", StringComparison.OrdinalIgnoreCase)) root["workflowCurrentStage"] = 0;
            else if (action.Equals("approve", StringComparison.OrdinalIgnoreCase) && lastApproval && currentStage < stages.Count - 1) root["workflowCurrentStage"] = currentStage + 1;
            root["workflow"] = JsonSerializer.SerializeToNode(events, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            temporaryPath = Path.Combine(Path.GetDirectoryName(paths.Context)!, $".{Guid.NewGuid():N}.context.tmp");
            await File.WriteAllTextAsync(temporaryPath, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false), cancellationToken);
            await loader.LoadFilesAsync(paths.Bpmn, temporaryPath, processId, cancellationToken); File.Move(temporaryPath, paths.Context, true); temporaryPath = null;
            return BuildWorkflow(processId, to, root, events);
        }
        finally { if (temporaryPath is not null) File.Delete(temporaryPath); contextWriteLock.Release(); }
    }

    private static IReadOnlyList<ProcessWorkflowStageModel> ReadWorkflowStages(JsonObject root) =>
        root["workflowStages"]?.Deserialize<List<ProcessWorkflowStageModel>>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) is { Count: > 0 } stages
            ? stages : [new("Согласование", 1, [])];

    private static ProcessWorkflowModel BuildWorkflow(string processId, string status, JsonObject root, IReadOnlyList<ProcessWorkflowEventModel> events)
    {
        var stages = ReadWorkflowStages(root);
        var currentStage = Math.Clamp(root["workflowCurrentStage"]?.GetValue<int>() ?? 0, 0, stages.Count - 1);
        var cycleStartedAt = events.Where(item => item.Action is "submit" or "reject" or "reopen").Select(item => item.OccurredAt).DefaultIfEmpty(DateTimeOffset.MinValue).Max();
        var approved = events.Where(item => item.Action == "approve" && item.StageIndex == currentStage && item.OccurredAt > cycleStartedAt).Select(item => item.UserId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        DateTimeOffset? dueAt = root["workflowReviewDueAt"]?.GetValue<DateTimeOffset>();
        return new(processId, status, events.OrderByDescending(item => item.OccurredAt).ToArray(), stages, currentStage, approved, dueAt);
    }

    public async Task<IReadOnlyList<ProcessVersionModel>> VersionsAsync(string processId, CancellationToken cancellationToken = default)
    {
        var versions = new List<ProcessVersionModel>();
        if (File.Exists(loader.GetBpmnPath(processId)))
        {
            var published = await loader.LoadAsync(processId, cancellationToken);
            versions.Add(new ProcessVersionModel(published.Version, "Published", File.GetLastWriteTimeUtc(loader.GetBpmnPath(processId))));
        }
        var processArchive = Path.Combine(VersionRoot, processId);
        if (Directory.Exists(processArchive))
        {
            foreach (var contextPath in Directory.EnumerateFiles(processArchive, "process.context.json", SearchOption.AllDirectories))
            {
                var bpmnPath = Path.Combine(Path.GetDirectoryName(contextPath)!, "process.bpmn");
                var archived = await loader.LoadFilesAsync(bpmnPath, contextPath, processId, cancellationToken);
                versions.Add(new ProcessVersionModel(archived.Version, "Archived", File.GetLastWriteTimeUtc(contextPath)));
            }
        }
        var draft = await TryLoadDraftAsync(processId, cancellationToken);
        if (draft is not null)
            versions.Add(new ProcessVersionModel(draft.Version, "Draft", File.GetLastWriteTimeUtc(DraftPaths(processId).Context)));
        return versions
            .OrderBy(item => item.Status switch { "Draft" => 0, "Published" => 1, _ => 2 })
            .ThenByDescending(item => VersionSortKey(item.Version))
            .ToArray();
    }

    public Task DeleteAsync(string processId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!SafeProcessId().IsMatch(processId)) throw new FileNotFoundException();
        var publishedBpmn = loader.GetBpmnPath(processId);
        var draft = DraftPaths(processId);
        var archive = Path.Combine(VersionRoot, processId);
        var knownFiles = new[]
        {
            publishedBpmn, Path.ChangeExtension(publishedBpmn, ".context.json"), draft.Bpmn, draft.Context,
            Path.Combine(loader.DataRoot, "Assignments", $"{processId}.json"),
            Path.Combine(loader.DataRoot, "Executions", $"{processId}.json"),
            Path.Combine(loader.DataRoot, "Comments", $"{processId}.json"),
            Path.Combine(loader.DataRoot, "Commands", $"{processId}.json")
        };
        if (!knownFiles.Any(File.Exists) && !Directory.Exists(archive)) throw new FileNotFoundException();
        foreach (var path in knownFiles.Where(File.Exists)) File.Delete(path);
        if (Directory.Exists(archive)) Directory.Delete(archive, recursive: true);
        return Task.CompletedTask;
    }

    private ProcessSummaryModel ToSummary(ProcessModel process, ProcessModel? draft = null)
    {
        var files = ProcessFiles(process.Id).Where(File.Exists).ToArray();
        var createdAt = files.Length == 0 ? DateTimeOffset.UtcNow : files.Min(path => new DateTimeOffset(File.GetCreationTimeUtc(path), TimeSpan.Zero));
        var updatedAt = files.Length == 0 ? createdAt : files.Max(path => new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero));
        return new(
        process.Id,
        process.Name,
        process.Version,
        process.Owner,
        process.Status,
        process.Nodes.Count,
        process.Lanes.Count,
        draft is not null,
        draft?.Version,
        createdAt,
        updatedAt);
    }

    private IEnumerable<string> ProcessFiles(string processId)
    {
        var published = loader.GetBpmnPath(processId);
        var draft = DraftPaths(processId);
        yield return published;
        yield return Path.ChangeExtension(published, ".context.json");
        yield return draft.Bpmn;
        yield return draft.Context;
        var archive = Path.Combine(VersionRoot, processId);
        if (Directory.Exists(archive))
            foreach (var path in Directory.EnumerateFiles(archive, "*", SearchOption.AllDirectories)) yield return path;
    }

    private async Task<ProcessModel?> TryLoadDraftAsync(string processId, CancellationToken cancellationToken)
    {
        var paths = DraftPaths(processId);
        if (!File.Exists(paths.Bpmn) || !File.Exists(paths.Context)) return null;
        return await loader.LoadFilesAsync(paths.Bpmn, paths.Context, processId, cancellationToken);
    }

    private (string Bpmn, string Context) DraftPaths(string processId) => (
        Path.Combine(DraftRoot, $"{processId}.bpmn"),
        Path.Combine(DraftRoot, $"{processId}.context.json"));

    private static async Task UpdateContextAsync(string path, string version, string status, CancellationToken cancellationToken)
    {
        var root = JsonNode.Parse(await File.ReadAllTextAsync(path, cancellationToken))?.AsObject()
            ?? throw new InvalidDataException("Process context JSON is empty.");
        root["version"] = version;
        root["status"] = status;
        await File.WriteAllTextAsync(path, root.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }), cancellationToken);
    }

    private static string NextVersion(string version)
    {
        var parts = version.Split('.');
        return parts.Length >= 2 && int.TryParse(parts[1], out var minor)
            ? $"{parts[0]}.{minor + 1}"
            : $"{version}.1";
    }

    private static string SafeFilePart(string value) => Regex.Replace(value, "[^A-Za-z0-9._-]", "_");

    private static long VersionSortKey(string value)
    {
        var parts = value.Split('.');
        long result = 0;
        for (var index = 0; index < Math.Min(parts.Length, 4); index++)
        {
            result = result * 10_000 + (int.TryParse(parts[index], out var part) ? Math.Clamp(part, 0, 9_999) : 0);
        }
        for (var index = parts.Length; index < 4; index++) result *= 10_000;
        return result;
    }

    private static IReadOnlyList<string> ContextWarnings(ProcessModel process)
    {
        var count = process.Nodes.Count(node => string.IsNullOrWhiteSpace(node.Description) &&
            string.IsNullOrWhiteSpace(node.Responsible) && (node.Actions?.Count ?? 0) == 0 && (node.Artifacts?.Count ?? 0) == 0);
        return count == 0 ? [] : [$"{count} element(s) have no Process Navigator context."];
    }

    private static ElementContextUpdateModel NormalizeContext(ElementContextUpdateModel update)
    {
        static string? Text(string? value, int maximum, string field)
        {
            var result = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
            if (result?.Length > maximum) throw new InvalidDataException($"{field} exceeds {maximum} characters.");
            return result;
        }

        var artifacts = (update.Artifacts ?? []).Take(21).Select(item => new ArtifactModel(
            Text(item.Name, 200, "Artifact name") ?? throw new InvalidDataException("Artifact name is required."),
            Text(item.Kind, 80, "Artifact kind") ?? throw new InvalidDataException("Artifact kind is required."),
            Text(item.Version, 40, "Artifact version") ?? throw new InvalidDataException("Artifact version is required."),
            Text(item.Reference, 500, "Artifact reference"))).ToArray();
        if (artifacts.Length > 20) throw new InvalidDataException("An element cannot contain more than 20 artifacts.");

        static bool SafeNavigationTarget(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            if (value.StartsWith('/') && !value.StartsWith("//")) return true;
            return Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" or "mailto";
        }

        var actions = (update.Actions ?? []).Take(21).Select(item =>
        {
            var kind = Text(item.Kind, 50, "Action kind") ?? throw new InvalidDataException("Action kind is required.");
            var target = kind.Equals("manual", StringComparison.OrdinalIgnoreCase) ? null : Text(item.Target, 500, "Action target");
            return new ActionModel(
                Text(item.Id, 100, "Action ID") ?? throw new InvalidDataException("Action ID is required."),
                Text(item.Label, 200, "Action label") ?? throw new InvalidDataException("Action label is required."),
                kind,
                target);
        }).ToArray();
        if (actions.Length > 20) throw new InvalidDataException("An element cannot contain more than 20 actions.");
        if (actions.Select(item => item.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != actions.Length)
            throw new InvalidDataException("Action IDs must be unique within an element.");
        if (actions.Any(item => item.Kind.ToUpperInvariant() is not ("ERP" or "REPORT" or "URL" or "FILE" or "MANUAL")))
            throw new InvalidDataException("Action kind must be manual, url, file, report or erp.");
        if (actions.Any(item => item.Kind.Equals("url", StringComparison.OrdinalIgnoreCase) && !SafeNavigationTarget(item.Target)))
            throw new InvalidDataException("URL action target must be a safe http(s), mailto or application-relative address.");
        if (actions.Any(item => item.Kind.Equals("file", StringComparison.OrdinalIgnoreCase) &&
            (string.IsNullOrWhiteSpace(item.Target) || !item.Target.StartsWith("artifact:", StringComparison.OrdinalIgnoreCase))))
            throw new InvalidDataException("File action target must reference an artifact from the repository.");
        if (actions.Any(item => item.Kind.Equals("report", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(item.Target) && !SafeNavigationTarget(item.Target)))
            throw new InvalidDataException("Report action target must be empty or a safe navigation address.");

        static IReadOnlyList<string> TextList(IReadOnlyList<string>? values, int maximumItems, int maximumLength, string field)
        {
            var normalized = (values ?? []).Select(value => Text(value, maximumLength, field))
                .Where(value => value is not null).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase).Take(maximumItems + 1).ToArray();
            if (normalized.Length > maximumItems) throw new InvalidDataException($"{field} cannot contain more than {maximumItems} values.");
            return normalized;
        }

        var executionMode = Text(update.ExecutionMode, 30, "Execution mode");
        var executorKind = Text(update.ExecutorKind, 30, "Executor kind");
        if (executorKind is not (null or "human" or "system"))
            throw new InvalidDataException("Исполнитель действия должен быть human или system.");
        if (executionMode is not null && executionMode is not ("manual" or "external" or "system"))
            throw new InvalidDataException("Execution mode must be manual, external or system.");

        var channels = (update.Channels ?? []).Take(21).Select(item => new ProcessChannelModel(
            Text(item.Id, 100, "Channel ID") ?? throw new InvalidDataException("Идентификатор канала обязателен."),
            Text(item.Kind, 30, "Channel kind") ?? throw new InvalidDataException("Тип канала обязателен."),
            Text(item.Label, 200, "Channel label") ?? throw new InvalidDataException("Название канала обязательно."),
            Text(item.SystemName, 200, "Channel system"),
            Text(item.DocumentName, 300, "Channel document"),
            Text(item.Flow, 30, "Channel flow") ?? "primary",
            Text(item.Direction, 30, "Channel direction") ?? "work")).ToArray();
        if (channels.Length > 20) throw new InvalidDataException("У элемента не может быть более 20 каналов.");
        if (channels.Select(item => item.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != channels.Length)
            throw new InvalidDataException("Идентификаторы каналов элемента должны быть уникальны.");
        var allowedKinds = new HashSet<string>(["system", "email", "paper", "phone", "memo", "meeting", "other"], StringComparer.OrdinalIgnoreCase);
        var allowedFlows = new HashSet<string>(["primary", "alternative", "parallel"], StringComparer.OrdinalIgnoreCase);
        var allowedDirections = new HashSet<string>(["input", "work", "output"], StringComparer.OrdinalIgnoreCase);
        foreach (var channel in channels)
        {
            if (!allowedKinds.Contains(channel.Kind)) throw new InvalidDataException($"Неизвестный тип канала «{channel.Kind}».");
            if (!allowedFlows.Contains(channel.Flow)) throw new InvalidDataException($"Неизвестный режим канала «{channel.Flow}».");
            if (!allowedDirections.Contains(channel.Direction)) throw new InvalidDataException($"Неизвестное направление канала «{channel.Direction}».");
            if (channel.Kind.Equals("system", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(channel.SystemName))
                throw new InvalidDataException("Для канала информационной системы укажите систему.");
        }

        var informationObjects = (update.InformationObjects ?? []).Take(41).Select(item => new InformationObjectBindingModel(
            Text(item.ObjectId, 100, "Information object ID") ?? throw new InvalidDataException("Идентификатор объекта реестра обязателен."),
            Text(item.Name, 300, "Information object name") ?? throw new InvalidDataException("Название объекта реестра обязательно."),
            Text(item.Role, 30, "Information object role") ?? throw new InvalidDataException("Роль объекта реестра обязательна."),
            item.Required,
            Text(item.Condition, 500, "Information object condition"),
            Text(item.Version, 50, "Information object version"))).ToArray();
        if (informationObjects.Length > 40) throw new InvalidDataException("К этапу можно привязать не более 40 объектов реестра.");
        if (informationObjects.Any(item => !SafeProcessId().IsMatch(item.ObjectId)))
            throw new InvalidDataException("Некорректный идентификатор объекта реестра.");
        if (informationObjects.Any(item => item.Role is not ("Input" or "Output" or "Reference")))
            throw new InvalidDataException("Роль объекта должна быть Input, Output или Reference.");
        if (informationObjects.GroupBy(item => $"{item.ObjectId}:{item.Role}", StringComparer.OrdinalIgnoreCase).Any(group => group.Skip(1).Any()))
            throw new InvalidDataException("Один объект нельзя дважды привязать к этапу с одинаковой ролью.");

        return new ElementContextUpdateModel(
            Text(update.Description, 4000, "Description"),
            Text(update.Responsible, 200, "Responsible"),
            Text(update.Duration, 100, "Duration"),
            artifacts,
            actions,
            TextList(update.Inputs, 20, 300, "Inputs"),
            Text(update.ExpectedResult, 2000, "Expected result"),
            Text(update.CompletionCriteria, 2000, "Completion criteria"),
            Text(update.Instruction, 6000, "Instruction"),
            executionMode,
            Text(update.SystemName, 200, "System name"),
            Text(update.WorkDuration, 100, "Work duration"),
            Text(update.WaitDuration, 100, "Wait duration"),
            TextList(update.ParticipantUnits, 20, 300, "Participant units"),
            Text(update.LinkedProcessId, 200, "Linked process ID"),
            NormalizeParticipantUnitRefs(update.ParticipantUnitRefs),
            channels,
            informationObjects,
            executorKind,
            NormalizeEvidence(update.Evidence));
    }

    internal static IReadOnlyList<SourceRequirementModel> NormalizeSourceRequirements(IReadOnlyList<SourceRequirementModel>? entries)
    {
        var requirements = entries ?? [];
        if (requirements.Count > 100) throw new InvalidDataException("Допускается не более 100 пунктов исходного описания.");
        var requirementIds = new HashSet<string>(StringComparer.Ordinal);
        return requirements.Select(item =>
        {
            if (item is null || string.IsNullOrWhiteSpace(item.Id) || item.Id.Length > 100 || !requirementIds.Add(item.Id.Trim()))
                throw new InvalidDataException("Пункт исходного описания должен иметь уникальный ID до 100 символов.");
            if (string.IsNullOrWhiteSpace(item.Text) || item.Text.Length > 2000 || string.IsNullOrWhiteSpace(item.Source) || item.Source.Length > 1000 || item.Locator?.Length > 300)
                throw new InvalidDataException("Заполните содержание (до 2000 символов), источник (до 1000) и место (до 300).");
            if ((item.ElementIds?.Count ?? 0) > 20 || (item.ElementIds ?? []).Any(id => string.IsNullOrWhiteSpace(id) || id.Length > 200))
                throw new InvalidDataException("Для пункта допускается до 20 ссылок на элементы, ID до 200 символов.");
            if (item.CheckSequence && (item.ElementIds?.Select(id => id.Trim()).Distinct(StringComparer.Ordinal).Count() ?? 0) < 2)
                throw new InvalidDataException("Для проверки маршрута выберите не менее двух разных элементов.");
            return new SourceRequirementModel(item.Id.Trim(), item.Text.Trim(), item.Source.Trim(), item.Locator?.Trim(), (item.ElementIds ?? []).Select(id => id.Trim()).Distinct(StringComparer.Ordinal).ToArray(), item.CheckSequence);
        }).ToArray();
    }

    internal static IReadOnlyList<StepEvidenceModel> NormalizeEvidence(IReadOnlyList<StepEvidenceModel>? entries)
    {
        static string? Text(string? value, int limit, string label)
        {
            var text = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
            if (text?.Length > limit) throw new InvalidDataException($"{label}: допустимо не более {limit} символов.");
            return text;
        }
        if ((entries?.Count ?? 0) > 20) throw new InvalidDataException("Допускается не более 20 оснований и вопросов на шаг.");
        return (entries ?? []).Select(entry =>
        {
            if (entry is null || entry.Status is not ("fact" or "assumption" or "question"))
                throw new InvalidDataException("Укажите статус: fact, assumption или question.");
            var statement = Text(entry.Statement, 2000, "Evidence statement");
            var source = Text(entry.Source, 1000, "Evidence source");
            if (string.IsNullOrWhiteSpace(statement)) throw new InvalidDataException("Заполните содержание основания или вопроса.");
            if (entry.Status == "fact" && string.IsNullOrWhiteSpace(source)) throw new InvalidDataException("Для подтверждённого факта укажите источник.");
            return new StepEvidenceModel(entry.Status, statement, source, Text(entry.Locator, 300, "Evidence locator"), Text(entry.Author, 200, "Evidence author"));
        }).ToArray();
    }

    private static IReadOnlyList<ParticipantUnitRefModel> NormalizeParticipantUnitRefs(IReadOnlyList<ParticipantUnitRefModel>? references)
    {
        if ((references?.Count ?? 0) > 20)
            throw new InvalidDataException("К задаче можно привязать не более 20 подразделений.");
        var result = new List<ParticipantUnitRefModel>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var reference in references ?? [])
        {
            var entityId = reference.LegalEntityId?.Trim();
            var unitId = reference.UnitId?.Trim();
            if (string.IsNullOrWhiteSpace(entityId) || string.IsNullOrWhiteSpace(unitId) || entityId.Length > 100 || unitId.Length > 100)
                throw new InvalidDataException("Участник должен ссылаться на юридическое лицо и подразделение.");
            if (!seen.Add($"{entityId}\u001f{unitId}"))
                throw new InvalidDataException("Одно подразделение указано среди участников несколько раз.");
            result.Add(new ParticipantUnitRefModel(entityId, unitId));
        }
        return result;
    }

    private async Task ValidateParticipantUnitRefsAsync(IReadOnlyList<ParticipantUnitRefModel> references, CancellationToken cancellationToken)
    {
        if (references.Count == 0) return;
        var path = Path.Combine(loader.DataRoot, "organization.json");
        if (!File.Exists(path)) throw new InvalidDataException("Оргструктура не найдена.");
        var organization = JsonSerializer.Deserialize<OrganizationMapModel>(
            await File.ReadAllBytesAsync(path, cancellationToken), new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidDataException("Оргструктура пуста.");
        foreach (var reference in references)
        {
            var entity = organization.LegalEntities.FirstOrDefault(item => item.Id.Equals(reference.LegalEntityId, StringComparison.OrdinalIgnoreCase));
            if (entity is null || !(entity.Units ?? []).Any(unit => unit.Id.Equals(reference.UnitId, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException($"Подразделение «{reference.UnitId}» не найдено в актуальной оргструктуре.");
        }
    }

    private async Task ValidateLinkedProcessAsync(string processId, string? linkedProcessId, CancellationToken cancellationToken)
    {
        if (linkedProcessId is null) return;
        if (linkedProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Элемент процесса нельзя связать с этим же процессом.");

        var items = await ListAsync(cancellationToken);
        var catalogById = items.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        if (!catalogById.ContainsKey(linkedProcessId))
            throw new InvalidDataException($"Связанный процесс «{linkedProcessId}» не найден в каталоге.");

        var queue = new Queue<string>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        queue.Enqueue(linkedProcessId);
        while (queue.TryDequeue(out var currentId))
        {
            if (currentId.Equals(processId, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Эта связь создаёт циклическую вложенность процессов.");
            if (!visited.Add(currentId) || !catalogById.TryGetValue(currentId, out var summary)) continue;
            var current = await LoadAsync(currentId, draft: summary.HasDraft || summary.Status == "Draft", cancellationToken);
            foreach (var target in current.Nodes.Select(node => node.LinkedProcessId).Where(id => !string.IsNullOrWhiteSpace(id)))
                queue.Enqueue(target!);
        }
    }

    private static void ValidateUpload(IFormFile file, string extension, string label)
    {
        if (file.Length == 0) throw new InvalidDataException($"The {label} file is empty.");
        if (file.Length > MaximumFileSize) throw new InvalidDataException($"The {label} file exceeds the 2 MB limit.");
        if (!string.Equals(Path.GetExtension(file.FileName), extension, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"The {label} file must have the '{extension}' extension.");
    }

    private static async Task SaveUploadAsync(IFormFile file, string destination, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await file.CopyToAsync(stream, cancellationToken);
    }

    private static async Task<PackageProcessMetadata> ReadPackageMetadataAsync(string bpmnPath, CancellationToken cancellationToken)
    {
        XNamespace bpmn = "http://www.omg.org/spec/BPMN/20100524/MODEL";
        await using var stream = File.OpenRead(bpmnPath);
        var document = await XDocument.LoadAsync(stream, LoadOptions.None, cancellationToken);
        var processes = document.Root?.Elements(bpmn + "process").ToArray() ?? [];
        if (processes.Length != 1)
            throw new InvalidDataException("A packaged BPMN file must contain exactly one process.");
        var process = processes[0];
        var id = (string?)process.Attribute("id") ?? throw new InvalidDataException("The packaged process has no ID.");
        var laneByNode = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var lane in process.Descendants(bpmn + "lane"))
        {
            var laneName = ((string?)lane.Attribute("name"))?.Trim();
            if (string.IsNullOrWhiteSpace(laneName)) laneName = (string?)lane.Attribute("id") ?? "Department";
            foreach (var reference in lane.Elements(bpmn + "flowNodeRef")) laneByNode[reference.Value.Trim()] = laneName;
        }
        var supported = new HashSet<string>(StringComparer.Ordinal)
        {
            "task", "userTask", "manualTask", "serviceTask", "sendTask", "receiveTask", "businessRuleTask",
            "callActivity", "subProcess", "startEvent", "endEvent", "exclusiveGateway", "parallelGateway"
        };
        var elements = process.Elements().Where(element => supported.Contains(element.Name.LocalName)).Select(element =>
        {
            var elementId = (string?)element.Attribute("id") ?? throw new InvalidDataException("A BPMN element has no ID.");
            var name = ((string?)element.Attribute("name"))?.Trim() ?? elementId;
            var documentation = element.Element(bpmn + "documentation")?.Value.Trim();
            laneByNode.TryGetValue(elementId, out var laneName);
            return new PackageElementMetadata(elementId, name, laneName, documentation);
        }).ToArray();
        return new PackageProcessMetadata(id, elements);
    }

    private static async Task<string> ReadTextEntryAsync(ZipArchiveEntry entry, CancellationToken cancellationToken)
    {
        if (entry.Length > MaximumFileSize) throw new InvalidDataException($"Package entry '{entry.FullName}' exceeds 2 MB.");
        await using var stream = entry.Open();
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return await reader.ReadToEndAsync(cancellationToken);
    }

    private static string? PassportOwner(string? passport)
    {
        if (string.IsNullOrWhiteSpace(passport)) return null;
        var match = Regex.Match(passport, @"(?im)^\s*(?:[-*]\s*)?Владелец(?:/ведущее подразделение)?\s*:\s*(.+?)\s*$", RegexOptions.CultureInvariant);
        return match.Success ? match.Groups[1].Value.Trim() : null;
    }

    private static string RequiredText(string? value, int maximum, string field)
    {
        var result = value?.Trim();
        if (string.IsNullOrWhiteSpace(result)) throw new InvalidDataException($"{field} is required.");
        if (result.Length > maximum) throw new InvalidDataException($"{field} exceeds {maximum} characters.");
        return result;
    }

    private static string BlankBpmn(string id, string name, string laneName)
    {
        static string X(string value) => System.Security.SecurityElement.Escape(value) ?? string.Empty;
        return $"""
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_{X(id)}" targetNamespace="https://process-navigator.local/bpmn">
  <bpmn:process id="{X(id)}" name="{X(name)}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1"><bpmn:lane id="Lane_1" name="{X(laneName)}"><bpmn:flowNodeRef>StartEvent_1</bpmn:flowNodeRef><bpmn:flowNodeRef>Task_1</bpmn:flowNodeRef><bpmn:flowNodeRef>EndEvent_1</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:startEvent id="StartEvent_1" name="Начало"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Первое действие"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="EndEvent_1" name="Результат"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1"/><bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="EndEvent_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="{X(id)}">
    <bpmndi:BPMNShape id="Lane_1_di" bpmnElement="Lane_1" isHorizontal="true"><dc:Bounds x="80" y="80" width="900" height="240"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="150" y="182" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="300" y="160" width="140" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1"><dc:Bounds x="570" y="182" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="186" y="200"/><di:waypoint x="300" y="200"/></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="440" y="200"/><di:waypoint x="570" y="200"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
""";
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeProcessId();

    private sealed record PackageProcessMetadata(string Id, IReadOnlyList<PackageElementMetadata> Elements);
    private sealed record PackageElementMetadata(string Id, string Name, string? LaneName, string? Documentation);
}

public sealed class ProcessConflictException(string message) : Exception(message);
