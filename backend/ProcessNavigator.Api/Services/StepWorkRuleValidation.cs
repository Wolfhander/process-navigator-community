using System.Text.Json;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

public static class StepWorkRuleValidation
{
    public static IReadOnlyList<StepWorkRuleModel>? Normalize(IReadOnlyList<StepWorkRuleModel>? rules)
    {
        if (rules is null) return null; // Omitted field preserves old data; [] clears explicitly.
        if (rules.Count > 40) throw new InvalidDataException("Не более 40 правил работы на шаг.");
        string? Text(string? value, int limit)
        {
            var text = value?.Trim();
            if (text?.Length > limit) throw new InvalidDataException($"Поле правила превышает {limit} символов.");
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }
        var result = rules.Select(rule =>
        {
            if (rule is null || rule.Kind is not ("document" or "exception"))
                throw new InvalidDataException("Тип правила должен быть document или exception.");
            var item = new StepWorkRuleModel(rule.Kind, Text(rule.ObjectId, 100), Text(rule.RequiredState, 200), Text(rule.Condition, 1000), Text(rule.Response, 2000), Text(rule.Responsible, 200));
            if (item.Kind == "document" && (item.ObjectId is null || item.RequiredState is null))
                throw new InvalidDataException("Для требования документа обязательны ID объекта и требуемое состояние.");
            if (item.Kind == "exception" && (item.Condition is null || item.Response is null))
                throw new InvalidDataException("Для исключения обязательны условие и действие.");
            if (item.Kind == "document" && item.Response is not null || item.Kind == "exception" && (item.ObjectId is not null || item.RequiredState is not null))
                throw new InvalidDataException("Поля документа и исключения нельзя смешивать.");
            return item;
        }).ToArray();
        if (JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web)).Length > 30000)
            throw new InvalidDataException("Правила работы превышают 30000 символов JSON; сократите описание.");
        return result;
    }
}
