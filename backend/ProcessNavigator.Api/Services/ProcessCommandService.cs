using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class ProcessCommandService(IWebHostEnvironment environment, OneCIntegrationService oneC)
{
    private readonly string root = Path.Combine(environment.ContentRootPath, "Data", "Commands");
    private readonly SemaphoreSlim writeLock = new(1, 1);

    public async Task<CommandExecutionModel> ExecuteAsync(ProcessModel process, string elementId, string actionId,
        string? instanceId, string? resultText, string userId, CancellationToken cancellationToken)
    {
        var node = process.Nodes.FirstOrDefault(item => item.Id == elementId) ?? throw new KeyNotFoundException("Element");
        var action = node.Actions?.FirstOrDefault(item => item.Id == actionId) ?? throw new KeyNotFoundException("Action");
        var kind = action.Kind.Trim().ToUpperInvariant();
        if (kind is not ("ERP" or "REPORT" or "URL" or "FILE" or "MANUAL"))
            throw new InvalidDataException($"Тип команды '{action.Kind}' не поддерживается.");
        var resultNote = string.IsNullOrWhiteSpace(resultText) ? null : resultText.Trim();
        if (resultNote?.Length > 1000) throw new InvalidDataException("Результат действия не может превышать 1000 символов.");
        if (kind == "URL" && !IsSafeNavigationTarget(action.Target))
            throw new InvalidDataException("Для ссылки укажите безопасный адрес http(s), mailto или внутренний путь /…. ");
        if (kind == "FILE" && (string.IsNullOrWhiteSpace(action.Target) || !action.Target.StartsWith("artifact:", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidDataException("Файл действия должен быть выбран из внутреннего репозитория.");
        if (kind == "REPORT" && !string.IsNullOrWhiteSpace(action.Target) && !IsSafeNavigationTarget(action.Target))
            throw new InvalidDataException("Ссылка на отчёт должна быть адресом http(s), mailto или внутренним путём /…. ");

        var oneCResult = kind == "ERP" ? await oneC.ExecuteAsync(new OneCCommandRequestModel(process.Id, process.Version,
            node.Id, node.Name, action.Id, action.Label, action.Target, instanceId, userId), cancellationToken) : null;
        var externalReference = kind == "MANUAL" ? null : oneCResult?.ExternalReference ?? action.Target;
        var message = kind switch
        {
            "ERP" => oneCResult!.Message,
            "REPORT" => string.IsNullOrWhiteSpace(action.Target) ? "Запуск отчёта зафиксирован; ссылка пока не настроена." : "Отчёт подготовлен к открытию.",
            "URL" => "Ссылка проверена и подготовлена к открытию.",
            "FILE" => "Файл подготовлен к открытию.",
            _ => "Ручное действие зафиксировано."
        };
        var result = new CommandExecutionModel(Guid.NewGuid().ToString("N"), process.Id, elementId, action.Id,
            action.Label, kind, action.Target, instanceId, userId, oneCResult?.Succeeded == false ? "Failed" : "Succeeded", message, externalReference, resultNote, DateTimeOffset.UtcNow);
        await AppendAsync(result, cancellationToken);
        return result;
    }

    private static bool IsSafeNavigationTarget(string? target)
    {
        var value = target?.Trim();
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (value.StartsWith('/') && !value.StartsWith("//")) return true;
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" or "mailto";
    }

    public async Task<IReadOnlyList<CommandExecutionModel>> ListAsync(string processId, string elementId, CancellationToken cancellationToken) =>
        (await ReadAsync(processId, cancellationToken)).Where(item => item.ElementId == elementId)
            .OrderByDescending(item => item.ExecutedAt).Take(20).ToArray();

    public async Task<IReadOnlyList<CommandExecutionModel>> ListInstanceAsync(string processId, string instanceId,
        CancellationToken cancellationToken) => (await ReadAsync(processId, cancellationToken))
        .Where(item => string.Equals(item.InstanceId, instanceId, StringComparison.Ordinal))
        .OrderBy(item => item.ExecutedAt).ToArray();

    private async Task AppendAsync(CommandExecutionModel execution, CancellationToken cancellationToken)
    {
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var items = (await ReadAsync(execution.ProcessId, cancellationToken)).Append(execution).ToArray();
            Directory.CreateDirectory(root); var path = PathFor(execution.ProcessId); var temporary = path + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(items, new JsonSerializerOptions { WriteIndented = true }), cancellationToken);
            File.Move(temporary, path, true);
        }
        finally { writeLock.Release(); }
    }

    private async Task<IReadOnlyList<CommandExecutionModel>> ReadAsync(string processId, CancellationToken cancellationToken)
    {
        var path = PathFor(processId); if (!File.Exists(path)) return [];
        return JsonSerializer.Deserialize<List<CommandExecutionModel>>(await File.ReadAllTextAsync(path, cancellationToken),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
    }

    private string PathFor(string processId)
    {
        if (processId.Length is < 1 or > 100 || processId.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.')))
            throw new InvalidDataException("Недопустимый идентификатор процесса.");
        return Path.Combine(root, processId + ".json");
    }
}
