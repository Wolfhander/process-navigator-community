using System.Text.Json;
using System.Xml;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class CatalogAuditService(BpmnProcessLoader loader, ProcessCatalogService catalog,
    OrganizationMapService organizations, ProcessValidationService validation,
    InformationObjectRegistryService informationObjects)
{
    public async Task<CatalogAuditReportModel> RunAsync(CancellationToken cancellationToken = default)
    {
        var organization = await organizations.LoadAsync(cancellationToken);
        var known = await catalog.ListAsync(cancellationToken);
        var registry = await informationObjects.BuildAsync(true, cancellationToken);
        var registryObjects = registry.Objects.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var items = new List<CatalogAuditItemModel>();
        foreach (var (directory, edition) in new[] { (loader.DataRoot, "Published"), (Path.Combine(loader.DataRoot, "Drafts"), "Draft") })
        {
            if (!Directory.Exists(directory)) continue;
            foreach (var path in Directory.EnumerateFiles(directory, "*.bpmn", SearchOption.TopDirectoryOnly).Order(StringComparer.OrdinalIgnoreCase))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var fileName = Path.GetFileName(path);
                try
                {
                    var contextPath = Path.ChangeExtension(path, ".context.json");
                    if (!File.Exists(contextPath)) throw new InvalidDataException("Не найден файл контекста процесса.");
                    var process = await loader.LoadFilesAsync(path, contextPath, cancellationToken: cancellationToken);
                    var report = await validation.ValidateModelAsync(process, organization, known, cancellationToken);
                    var summary = known.FirstOrDefault(item => item.Id.Equals(process.Id, StringComparison.OrdinalIgnoreCase));
                    var issues = report.Issues.ToList();
                    if (edition == "Draft" || summary?.HasDraft != true)
                        AppendInformationIssues(process.Id, registry, registryObjects, issues);
                    var errorCount = issues.Count(issue => issue.Severity == "Error");
                    var warningCount = issues.Count - errorCount;
                    items.Add(new(process.Id, process.Name, edition, fileName, process.Version, true, summary?.HasDraft == true,
                        Quality(errorCount, warningCount), errorCount, warningCount,
                        issues.OrderBy(issue => issue.Severity == "Error" ? 0 : 1).ThenBy(issue => issue.Message).ToArray()));
                }
                catch (Exception exception) when (exception is InvalidDataException or IOException or UnauthorizedAccessException or XmlException or JsonException)
                {
                    var processId = Path.GetFileNameWithoutExtension(path);
                    var summary = known.FirstOrDefault(item => item.Id.Equals(processId, StringComparison.OrdinalIgnoreCase));
                    items.Add(new(processId, fileName, edition, fileName, null, false, summary?.HasDraft == true, "Blocked", 1, 0,
                        [new("source-unreadable", "Error", $"Не удалось прочитать BPMN или контекст: {exception.Message}", Category: "Source")]));
                }
            }
        }
        var categories = items.SelectMany(item => item.Issues.Select(issue => new { Item = item, Issue = issue }))
            .GroupBy(entry => entry.Issue.Category, StringComparer.OrdinalIgnoreCase)
            .Select(group => new CatalogAuditCategoryModel(group.Key, CategoryName(group.Key),
                group.Count(entry => entry.Issue.Severity == "Error"), group.Count(entry => entry.Issue.Severity != "Error"),
                group.Select(entry => $"{entry.Item.Edition}:{entry.Item.FileName}").Distinct(StringComparer.OrdinalIgnoreCase).Count()))
            .OrderByDescending(item => item.ErrorCount).ThenByDescending(item => item.WarningCount).ThenBy(item => item.Name)
            .ToArray();
        return new(known.Count, items.Count, items.Count(item => !item.Openable),
            items.Sum(item => item.ErrorCount), items.Sum(item => item.WarningCount),
            items.Count(item => item.QualityStatus == "Ready"), items.Count(item => item.QualityStatus == "Blocked"),
            items.Count(item => item.QualityStatus == "Incomplete"), categories, items);
    }

    private static string Quality(int errors, int warnings) => errors > 0 ? "Blocked" : warnings > 0 ? "Incomplete" : "Ready";

    private static string CategoryName(string id) => id switch
    {
        "Route" => "Маршрут",
        "Organization" => "Оргпривязки",
        "Description" => "Полнота описания",
        "Information" => "Входы и результаты",
        "Decomposition" => "Декомпозиция",
        "Source" => "Исходные файлы",
        _ => "Прочее"
    };

    private static void AppendInformationIssues(
        string processId,
        InformationObjectRegistryModel registry,
        IReadOnlyDictionary<string, InformationObjectModel> objects,
        ICollection<ProcessValidationIssueModel> target)
    {
        foreach (var issue in registry.Issues)
        {
            if (!objects.TryGetValue(issue.ObjectId, out var informationObject)) continue;
            var occurrences = issue.Code switch
            {
                "missing-producer" => informationObject.Consumers,
                "missing-consumer" => informationObject.Producers,
                "multiple-producers" => informationObject.Producers,
                _ => informationObject.Producers.Concat(informationObject.Consumers).Concat(informationObject.References).ToArray()
            };
            var occurrence = occurrences.FirstOrDefault(item => item.ProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase));
            if (occurrence is null) continue;
            target.Add(new($"information-{issue.Code}", issue.Severity,
                $"«{informationObject.Name}»: {issue.Message}", occurrence.ElementId, occurrence.ElementName, "Information"));
        }
    }
}
