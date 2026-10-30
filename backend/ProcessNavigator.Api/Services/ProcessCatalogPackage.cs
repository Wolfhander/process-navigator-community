using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessCatalogService
{
    private static readonly JsonSerializerOptions PackageJson = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true, PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private static readonly string[] PackageContextFields =
        ["version", "owner", "status", "ownerLegalEntityId", "ownerUnitId", "passport", "elements"];

    public async Task<byte[]> ExportPackageAsync(string processId, bool draft, CancellationToken cancellationToken = default)
    {
        if (!SafeProcessId().IsMatch(processId)) throw new FileNotFoundException();
        await contextWriteLock.WaitAsync(cancellationToken);
        try
        {
            var paths = draft ? DraftPaths(processId) : (Bpmn: loader.GetBpmnPath(processId), Context: Path.ChangeExtension(loader.GetBpmnPath(processId), ".context.json"));
            var before = await File.ReadAllBytesAsync(paths.Context, cancellationToken);
            var bpmn = await File.ReadAllBytesAsync(paths.Bpmn, cancellationToken);
            if (before.Length > MaximumFileSize || bpmn.Length > MaximumFileSize) throw new InvalidDataException("Файлы модели превышают предел 2 МБ.");
            var model = await LoadAsync(processId, draft, cancellationToken);
            var raw = JsonNode.Parse(before) as JsonObject ?? throw new InvalidDataException("Пустое описание модели.");
            var context = new JsonObject();
            foreach (var key in PackageContextFields) if (raw.TryGetPropertyValue(key, out var value)) context[key] = value?.DeepClone();
            var payload = new JsonObject { ["format"] = "ProcessNavigator.Context", ["schemaVersion"] = 1, ["processId"] = processId, ["sourceVersion"] = model.Version, ["context"] = context };
            var metadata = await ReadPackageMetadataAsync(paths.Bpmn, cancellationToken);
            NormalizePackageContext(payload.ToJsonString(), metadata);
            var payloadText = payload.ToJsonString(PackageJson);
            if (Encoding.UTF8.GetByteCount(payloadText) > MaximumFileSize) throw new InvalidDataException("Описание ZIP превышает предел 2 МБ.");
            if (!before.SequenceEqual(await File.ReadAllBytesAsync(paths.Context, cancellationToken)) ||
                !bpmn.SequenceEqual(await File.ReadAllBytesAsync(paths.Bpmn, cancellationToken)))
                throw new InvalidDataException("Модель изменилась при выгрузке. Повторите экспорт.");
            using var stream = new MemoryStream();
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
            {
                await using (var entry = archive.CreateEntry(processId + ".bpmn").Open()) await entry.WriteAsync(bpmn, cancellationToken);
                await WritePackageTextAsync(archive, processId + ".pn-context.json", payloadText, cancellationToken);
                await WritePackageTextAsync(archive, "README.txt", "Process Navigator: одна модель BPMN и её редактируемое описание. Импорт создаёт новый черновик 0.1 и не заменяет существующие модели. Подпроцессы, оргструктура, пользователи, файлы материалов, история и согласования не включены; ссылки нужно проверить на принимающей стороне. Автор основания — справочное поле, не проверенная подпись.", cancellationToken);
            }
            return stream.ToArray();
        }
        finally { contextWriteLock.Release(); }
    }

    private static async Task WritePackageTextAsync(ZipArchive archive, string name, string text, CancellationToken token)
    {
        await using var stream = archive.CreateEntry(name).Open();
        await stream.WriteAsync(Encoding.UTF8.GetBytes(text), token);
    }

    private static JsonObject NormalizePackageContext(string text, PackageProcessMetadata metadata)
    {
        try { return ReadPackageContext(text, metadata); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException or ArgumentException)
        { throw new InvalidDataException("Неверный тип или значение поля контекста пакета.", exception); }
    }

    private static JsonObject ReadPackageContext(string text, PackageProcessMetadata metadata)
    {
        using var document = JsonDocument.Parse(text);
        static void CheckDuplicates(JsonElement value)
        {
            if (value.ValueKind == JsonValueKind.Object)
            {
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var property in value.EnumerateObject())
                {
                    if (!names.Add(property.Name)) throw new InvalidDataException("Повтор поля JSON: " + property.Name);
                    CheckDuplicates(property.Value);
                }
            }
            else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Null) throw new InvalidDataException("Массив контекста содержит null.");
                CheckDuplicates(item);
            }
        }
        CheckDuplicates(document.RootElement);
        var payload = JsonNode.Parse(text) as JsonObject ?? throw new InvalidDataException("Контекст пакета должен быть объектом.");
        if (payload.Any(p => !new[] { "format", "schemaVersion", "processId", "sourceVersion", "context" }.Contains(p.Key)) ||
            payload["format"]?.GetValue<string>() != "ProcessNavigator.Context" ||
            payload["schemaVersion"]?.GetValue<int>() != 1 ||
            payload["processId"]?.GetValue<string>() != metadata.Id)
            throw new InvalidDataException("Неизвестный формат контекста или несовпадение ID процесса.");
        RequiredText(payload["sourceVersion"]?.GetValue<string>(), 100, "Source version");
        var root = payload["context"] as JsonObject ?? throw new InvalidDataException("В пакете отсутствует context.");
        if (root.Any(p => !PackageContextFields.Contains(p.Key))) throw new InvalidDataException("Неизвестные поля контекста пакета.");
        RequiredText(root["version"]?.GetValue<string>(), 100, "Version");
        if (root["version"]?.GetValue<string>() != payload["sourceVersion"]?.GetValue<string>())
            throw new InvalidDataException("Обозначения исходной версии не совпадают.");
        RequiredText(root["owner"]?.GetValue<string>(), 300, "Owner");
        if (root["passport"] is JsonNode passportNode)
        {
            var passport = passportNode.Deserialize<ProcessPassportModel>(PackageJson) ?? throw new InvalidDataException("Неверный паспорт.");
            if (passport.Level is < 0 or > 20 || passport.Classification is not ("Основной" or "Управляющий" or "Обеспечивающий" or "Обслуживающий"))
                throw new InvalidDataException("Неверный уровень или классификация паспорта.");
            if ((passport.TriggerOptions?.Count ?? 0) > 20) throw new InvalidDataException("Не более 20 вариантов запуска.");
            root["passport"] = JsonSerializer.SerializeToNode(passport with { SourceRequirements = NormalizeSourceRequirements(passport.SourceRequirements) }, PackageJson);
        }
        var elements = root["elements"] as JsonObject ?? throw new InvalidDataException("Отсутствует описание элементов.");
        var known = metadata.Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var entry in elements.ToArray())
        {
            if (!known.Contains(entry.Key)) throw new InvalidDataException("Контекст неизвестного элемента: " + entry.Key);
            var update = entry.Value?.Deserialize<ElementContextUpdateModel>(PackageJson) ?? throw new InvalidDataException("Пустое описание элемента: " + entry.Key);
            root["elements"]![entry.Key] = JsonSerializer.SerializeToNode(NormalizeContext(update), PackageJson);
        }
        return root;
    }
}
