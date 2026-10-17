using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class InformationObjectRegistryService(ProcessCatalogService catalog, IWebHostEnvironment environment)
{
    private readonly SemaphoreSlim writeLock = new(1, 1);
    private string RegistryPath => Path.Combine(environment.ContentRootPath, "Data", "InformationObjects", "registry.json");
    private static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true };

    public async Task<InformationObjectRegistryModel> BuildAsync(bool includeDrafts, CancellationToken cancellationToken = default)
    {
        var summaries = await catalog.ListAsync(cancellationToken);
        var objects = new Dictionary<string, Entry>(StringComparer.Ordinal);
        var definitions = await LoadDefinitionsAsync(cancellationToken);
        var definitionsById = definitions.ToDictionary(definition => definition.Id, StringComparer.OrdinalIgnoreCase);
        var aliases = definitions.SelectMany(definition => definition.Aliases.Append(definition.Name).Select(alias => (Alias: Normalize(alias), Definition: definition)))
            .Where(item => item.Alias.Length > 1).GroupBy(item => item.Alias, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First().Definition, StringComparer.Ordinal);
        var loadedProcesses = 0;
        foreach (var summary in summaries)
        {
            ProcessModel process;
            try
            {
                var draft = summary.Status == "Draft" || (includeDrafts && summary.HasDraft);
                process = await catalog.LoadAsync(summary.Id, draft, cancellationToken);
            }
            catch (Exception exception) when (exception is IOException or InvalidDataException or System.Xml.XmlException or System.Text.Json.JsonException)
            {
                continue;
            }
            loadedProcesses++;
            var passport = process.Passport;
            AddMany(objects, aliases, passport?.Inputs, process, null, "Process", "Consumer", null);
            AddMany(objects, aliases, passport?.Outputs, process, null, "Process", "Producer", null);
            AddMany(objects, aliases, Values(passport?.Result), process, null, "Process", "Producer", null);
            AddMany(objects, aliases, passport?.Documents, process, null, "Process", "Reference", "Document");

            foreach (var node in process.Nodes)
            {
                foreach (var binding in node.InformationObjects ?? [])
                    AddBinding(objects, definitionsById, binding, process, node);
                AddMany(objects, aliases, node.Inputs, process, node, "Step", "Consumer", null);
                AddMany(objects, aliases, Values(node.ExpectedResult), process, node, "Step", "Producer", null);
                foreach (var artifact in node.Artifacts ?? [])
                    AddMany(objects, aliases, Values(artifact.Name), process, node, "Step", "Reference", "Document");
                foreach (var channel in node.Channels ?? [])
                {
                    if (string.IsNullOrWhiteSpace(channel.DocumentName)) continue;
                    var direction = channel.Direction.Equals("input", StringComparison.OrdinalIgnoreCase) ? "Consumer"
                        : channel.Direction.Equals("output", StringComparison.OrdinalIgnoreCase) ? "Producer" : "Reference";
                    AddMany(objects, aliases, Values(channel.DocumentName), process, node, "Step", direction, "Document");
                }
            }
        }

        foreach (var definition in definitions.Where(definition => !objects.ContainsKey(definition.Id)))
        {
            var entry = new Entry(definition.Id, definition.Name, definition.Kind, definition.Version, definition.LifecycleState, true, definition.History, definition.Components, definition.ExternalSource, definition.ExternalRecipient);
            foreach (var alias in definition.Aliases) entry.Aliases.Add(alias);
            objects[definition.Id] = entry;
        }

        var result = objects.Values.Select(ToModel).OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
        var issues = Diagnose(result);
        return new(DateTimeOffset.UtcNow, loadedProcesses, result.Length,
            result.Count(item => item.Kind == "Document"), result.Count(item => item.Kind == "Result"),
            issues.Count(item => item.Code == "missing-producer"), issues.Count(item => item.Code == "missing-consumer"),
            issues.Count(item => item.Code == "multiple-producers"), issues.Count(item => item.Code == "version-conflict"), result, issues);
    }

    public static IReadOnlyList<InformationObjectIssueModel> Diagnose(IReadOnlyList<InformationObjectModel> objects)
    {
        var issues = new List<InformationObjectIssueModel>();
        foreach (var item in objects)
        {
            if (item.Producers.Count == 0 && item.Consumers.Count > 0)
            {
                var required = item.Consumers.Any(value => value.Required);
                issues.Add(new(item.Id, "missing-producer", required ? "Error" : "Warning",
                    required ? "Обязательный объект используется как вход, но его источник не найден." : "Источник необязательного входа не найден."));
            }
            if (item.Producers.Count > 0 && item.Consumers.Count == 0)
                issues.Add(new(item.Id, "missing-consumer", "Warning", "Объект создаётся, но его следующий получатель не найден."));
            if (item.Producers.Select(LocationKey).Distinct(StringComparer.OrdinalIgnoreCase).Skip(1).Any())
                issues.Add(new(item.Id, "multiple-producers", "Warning", "Обнаружено несколько источников. Требуется проверить версии и условия возникновения."));
            issues.AddRange(InformationObjectPolicy.Check(item));
        }
        return issues;
    }

    public async Task<InformationObjectRegistryModel> SaveAsync(string id, InformationObjectUpdateModel update, bool includeDrafts,
        CancellationToken cancellationToken = default)
    {
        if (!SafeId().IsMatch(id)) throw new InvalidDataException("Некорректный идентификатор объекта.");
        var name = Required(update.Name, 300, "Наименование");
        var kind = update.Kind is "Document" or "Result" ? update.Kind : throw new InvalidDataException("Неизвестный тип объекта.");
        var version = Required(update.Version, 50, "Версия");
        var lifecycle = update.LifecycleState is "Draft" or "Active" or "Archived" ? update.LifecycleState : throw new InvalidDataException("Неизвестное состояние объекта.");
        var aliases = update.Aliases.Append(name).SelectMany(Split).Distinct(StringComparer.CurrentCultureIgnoreCase).Take(100).ToArray();
        if (aliases.Length == 0) throw new InvalidDataException("Добавьте хотя бы одно наименование или синоним.");
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var definitions = (await LoadDefinitionsAsync(cancellationToken)).ToList();
            var previous = definitions.FirstOrDefault(item => item.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
            if (update.ExpectedVersion is not null && (previous is null || previous.Version != update.ExpectedVersion || previous.LifecycleState != update.ExpectedLifecycleState))
                throw new InvalidDataException("Версия или состояние объекта изменены после открытия формы. Пересчитайте реестр и откройте форму заново; изменения не сохранены.");
            InformationObjectLifecycle.Validate(previous?.LifecycleState, previous?.Version, lifecycle, version);
            var history = (previous?.History ?? []).ToList();
            var externalSource = update.ExternalSource is null ? previous?.ExternalSource : update.ExternalSource.Trim();
            var externalRecipient = update.ExternalRecipient is null ? previous?.ExternalRecipient : update.ExternalRecipient.Trim();
            if (externalSource?.Length > 300 || externalRecipient?.Length > 300) throw new InvalidDataException("Описание внешнего участника превышает 300 символов.");
            var externalChanged = previous is not null && (previous.ExternalSource != externalSource || previous.ExternalRecipient != externalRecipient);
            var rawComponents = update.Components ?? previous?.Components ?? [];
            if (rawComponents.Any(item => item is null)) throw new InvalidDataException("Часть комплекта не может быть пустой.");
            var components = rawComponents.Select(item => item with { Version = string.IsNullOrWhiteSpace(item.Version) ? null : item.Version.Trim(), Condition = string.IsNullOrWhiteSpace(item.Condition) ? null : item.Condition.Trim() }).ToArray();
            var knownIds = (await BuildAsync(includeDrafts, cancellationToken)).Objects.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
            knownIds.Add(id);
            var graph = definitions.ToDictionary(item => item.Id, item => item.Components ?? (IReadOnlyList<InformationObjectComponentModel>)[], StringComparer.OrdinalIgnoreCase);
            InformationObjectComposition.Validate(id, components, graph, knownIds);
            var compositionChanged = previous is not null && !(previous.Components ?? []).SequenceEqual(components);
            if (compositionChanged && previous!.LifecycleState != "Draft" && previous.Version.Equals(version, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Для изменения состава действующего или архивного комплекта создайте новую версию в состоянии «Черновик».");
            if (previous is not null && !previous.Version.Equals(version, StringComparison.OrdinalIgnoreCase) && history.Any(item => item.Version.Equals(version, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Обозначение версии уже использовалось в истории этого объекта. Для новой редакции выберите новое обозначение.");
            var changed = previous is not null && (previous.Name != name || previous.Kind != kind || previous.Version != version || previous.LifecycleState != lifecycle || !previous.Aliases.SequenceEqual(aliases) || compositionChanged || externalChanged);
            if (changed) history.Add(new(previous!.Name, previous.Kind, previous.Version, previous.LifecycleState, previous.Aliases, DateTimeOffset.UtcNow, previous.Components, previous.ExternalSource, previous.ExternalRecipient));
            var collisions = definitions.Where(item => !item.Id.Equals(id, StringComparison.OrdinalIgnoreCase))
                .SelectMany(item => item.Aliases.Append(item.Name).Select(alias => (Id: item.Id, Alias: Normalize(alias))))
                .FirstOrDefault(item => aliases.Any(alias => Normalize(alias) == item.Alias));
            if (!string.IsNullOrWhiteSpace(collisions.Id)) throw new InvalidDataException("Один из синонимов уже принадлежит другому объекту реестра.");
            definitions.RemoveAll(item => item.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
            definitions.Add(new(id, name, kind, version, lifecycle, aliases, history, components, externalSource, externalRecipient));
            Directory.CreateDirectory(Path.GetDirectoryName(RegistryPath)!);
            var temporary = $"{RegistryPath}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllTextAsync(temporary, System.Text.Json.JsonSerializer.Serialize(definitions.OrderBy(item => item.Name).ToArray(), JsonOptions), new UTF8Encoding(false), cancellationToken);
            File.Move(temporary, RegistryPath, true);
        }
        finally { writeLock.Release(); }
        return await BuildAsync(includeDrafts, cancellationToken);
    }

    private static IEnumerable<string> Values(string? value) => string.IsNullOrWhiteSpace(value) ? [] : [value];

    private static void AddBinding(Dictionary<string, Entry> objects, IReadOnlyDictionary<string, Definition> definitions,
        InformationObjectBindingModel binding, ProcessModel process, NodeModel node)
    {
        definitions.TryGetValue(binding.ObjectId, out var definition);
        var key = definition?.Id ?? binding.ObjectId;
        if (!objects.TryGetValue(key, out var entry))
        {
            entry = definition is null
                ? new Entry(binding.ObjectId, binding.Name, DetectKind(binding.Name), binding.Version ?? "1.0", "Observed", false)
                : new Entry(definition.Id, definition.Name, definition.Kind, definition.Version, definition.LifecycleState, true, definition.History, definition.Components, definition.ExternalSource, definition.ExternalRecipient);
            if (definition is not null) foreach (var alias in definition.Aliases) entry.Aliases.Add(alias);
            objects[key] = entry;
        }
        entry.Aliases.Add(binding.Name);
        var direction = binding.Role == "Output" ? "Producer" : binding.Role == "Input" ? "Consumer" : "Reference";
        var occurrence = new InformationObjectOccurrenceModel(process.Id, process.Name, node.Id, node.Name, "Step", direction,
            binding.Required, binding.Condition, binding.Version);
        var target = direction == "Producer" ? entry.Producers : direction == "Consumer" ? entry.Consumers : entry.References;
        if (!target.Any(item => LocationKey(item).Equals(LocationKey(occurrence), StringComparison.OrdinalIgnoreCase))) target.Add(occurrence);
    }

    private static void AddMany(Dictionary<string, Entry> objects, IReadOnlyDictionary<string, Definition> definitions, IEnumerable<string>? values, ProcessModel process,
        NodeModel? node, string scope, string direction, string? forcedKind)
    {
        foreach (var raw in values ?? [])
        foreach (var name in Split(raw))
        {
            var normalized = Normalize(name);
            if (normalized.Length < 2) continue;
            definitions.TryGetValue(normalized, out var definition);
            var scopedKey = definition?.Id ?? (IsGeneric(normalized) ? $"{process.Id}:{normalized}" : normalized);
            if (!objects.TryGetValue(scopedKey, out var entry))
            {
                var expectedId = definition?.Id ?? IdFor(scopedKey);
                entry = objects.Values.FirstOrDefault(item => item.Id.Equals(expectedId, StringComparison.OrdinalIgnoreCase));
                if (entry is null)
                {
                    entry = definition is null
                        ? new Entry(expectedId, name, forcedKind ?? DetectKind(name), "1.0", "Observed", false)
                        : new Entry(definition.Id, definition.Name, definition.Kind, definition.Version, definition.LifecycleState, true, definition.History, definition.Components, definition.ExternalSource, definition.ExternalRecipient);
                    if (definition is not null) foreach (var alias in definition.Aliases) entry.Aliases.Add(alias);
                    objects[scopedKey] = entry;
                }
            }
            entry.Aliases.Add(name);
            if (!entry.Managed && (forcedKind == "Document" || DetectKind(name) == "Document")) entry.Kind = "Document";
            var occurrence = new InformationObjectOccurrenceModel(process.Id, process.Name, node?.Id, node?.Name, scope, direction);
            var target = direction == "Producer" ? entry.Producers : direction == "Consumer" ? entry.Consumers : entry.References;
            if (!target.Any(item => LocationKey(item).Equals(LocationKey(occurrence), StringComparison.OrdinalIgnoreCase))) target.Add(occurrence);
        }
    }

    private static InformationObjectModel ToModel(Entry entry)
    {
        var state = entry.Producers.Count == 0 && entry.Consumers.Count > 0 ? "Нет источника"
            : entry.Producers.Count > 0 && entry.Consumers.Count == 0 ? "Нет получателя"
            : entry.Producers.Select(LocationKey).Distinct(StringComparer.OrdinalIgnoreCase).Skip(1).Any() ? "Несколько источников"
            : entry.Producers.Count == 0 && entry.Consumers.Count == 0 ? "Только упоминание"
            : "Связан";
        return new(entry.Id, entry.Name, entry.Kind,
            entry.Aliases.OrderBy(value => value, StringComparer.CurrentCultureIgnoreCase).ToArray(),
            entry.Version, entry.LifecycleState, entry.Managed, state,
            entry.Producers.OrderBy(item => item.ProcessName).ThenBy(item => item.ElementName).ToArray(),
            entry.Consumers.OrderBy(item => item.ProcessName).ThenBy(item => item.ElementName).ToArray(),
            entry.References.OrderBy(item => item.ProcessName).ThenBy(item => item.ElementName).ToArray(), entry.History, entry.Components, entry.ExternalSource, entry.ExternalRecipient);
    }

    private static IEnumerable<string> Split(string value) => value.Split(['\r', '\n', ';', '•'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(item => item.Trim(' ', '-', '–', '—', '.', '\t')).Where(item => item.Length > 0);
    private static string Normalize(string value) => Spaces().Replace(NonWord().Replace(value.ToLowerInvariant().Replace('ё', 'е'), " "), " ").Trim();
    private static bool IsGeneric(string value) => value is "результат предыдущего этапа" or "входные данные" or "исходные данные" or "результат процесса" or "результаты процесса";
    private static string DetectKind(string value) => DocumentWords().IsMatch(value) ? "Document" : "Result";
    private static string IdFor(string value) => $"io-{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..16]}";
    private static string LocationKey(InformationObjectOccurrenceModel item) => $"{item.ProcessId}:{item.ElementId}:{item.Direction}";

    private async Task<IReadOnlyList<Definition>> LoadDefinitionsAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(RegistryPath)) return [];
        try { return System.Text.Json.JsonSerializer.Deserialize<Definition[]>(await File.ReadAllTextAsync(RegistryPath, cancellationToken), JsonOptions) ?? []; }
        catch (System.Text.Json.JsonException exception) { throw new InvalidDataException("Файл реестра документов и результатов повреждён.", exception); }
    }

    private static string Required(string? value, int maximum, string label)
    {
        var result = value?.Trim();
        if (string.IsNullOrWhiteSpace(result)) throw new InvalidDataException($"{label} не заполнено.");
        if (result.Length > maximum) throw new InvalidDataException($"{label} превышает {maximum} символов.");
        return result;
    }

    private sealed class Entry(string id, string name, string kind, string version, string lifecycleState, bool managed, IReadOnlyList<InformationObjectRevisionModel>? history = null, IReadOnlyList<InformationObjectComponentModel>? components = null, string? externalSource = null, string? externalRecipient = null)
    {
        public string Id { get; } = id;
        public string Name { get; } = name;
        public string Kind { get; set; } = kind;
        public string Version { get; } = version;
        public string LifecycleState { get; } = lifecycleState;
        public bool Managed { get; } = managed;
        public IReadOnlyList<InformationObjectRevisionModel> History { get; } = history ?? [];
        public IReadOnlyList<InformationObjectComponentModel> Components { get; } = components ?? [];
        public string? ExternalSource { get; } = externalSource;
        public string? ExternalRecipient { get; } = externalRecipient;
        public HashSet<string> Aliases { get; } = new(StringComparer.CurrentCultureIgnoreCase);
        public List<InformationObjectOccurrenceModel> Producers { get; } = [];
        public List<InformationObjectOccurrenceModel> Consumers { get; } = [];
        public List<InformationObjectOccurrenceModel> References { get; } = [];
    }

    private sealed record Definition(string Id, string Name, string Kind, string Version, string LifecycleState, IReadOnlyList<string> Aliases, IReadOnlyList<InformationObjectRevisionModel>? History = null, IReadOnlyList<InformationObjectComponentModel>? Components = null, string? ExternalSource = null, string? ExternalRecipient = null);

    [GeneratedRegex("[^a-zа-я0-9]+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex NonWord();
    [GeneratedRegex("\\s+", RegexOptions.CultureInvariant)] private static partial Regex Spaces();
    [GeneratedRegex("(документ|заявк|заказ|акт|отч[её]т|ведомост|накладн|сч[её]т|план|график|реестр|протокол|справк|записк|письм|черт[её]ж|спецификац|договор|карта|паспорт|сертификат|требован)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex DocumentWords();
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$", RegexOptions.CultureInvariant)] private static partial Regex SafeId();
}
