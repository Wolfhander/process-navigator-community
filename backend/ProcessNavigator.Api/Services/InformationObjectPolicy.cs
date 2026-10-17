using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public static class InformationObjectPolicy
{
    public static IEnumerable<InformationObjectOccurrenceModel> AffectedConsumers(InformationObjectModel item, string code)
    {
        var required = item.Consumers.Where(value => value.Required);
        if (code is not ("version-source-missing" or "version-unverified")) return required;
        var unknown = item.Producers.Any(value => string.IsNullOrWhiteSpace(value.Version));
        if (item.Producers.Count == 0 || (code == "version-unverified") != unknown) return [];
        return required.Where(value => !string.IsNullOrWhiteSpace(value.Version)
            && !item.Producers.Any(producer => string.Equals(producer.Version, value.Version, StringComparison.OrdinalIgnoreCase)));
    }

    public static IReadOnlyList<InformationObjectIssueModel> Check(InformationObjectModel item)
    {
        var issues = new List<InformationObjectIssueModel>();
        void Warn(string code, string message) => issues.Add(new(item.Id, code, "Warning", message));
        var used = item.Producers.Concat(item.Consumers).Select(value => value.Version)
            .Where(value => !string.IsNullOrWhiteSpace(value)).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (used.Length > 1 || item.Managed && used.Any(value => !value.Equals(item.Version, StringComparison.OrdinalIgnoreCase)))
            Warn("version-conflict", $"Обозначения версий различаются: {string.Join(", ", used)}. Версия реестра: {item.Version}. Само различие не доказывает несовместимость; проверьте требования получателей.");

        var required = item.Consumers.Where(value => value.Required).ToArray();
        foreach (var group in required.Where(value => !string.IsNullOrWhiteSpace(value.Version)).GroupBy(value => value.Version!, StringComparer.OrdinalIgnoreCase))
        {
            if (item.Producers.Count == 0 || item.Producers.Any(value => string.Equals(value.Version, group.Key, StringComparison.OrdinalIgnoreCase))) continue;
            var unknown = item.Producers.Any(value => string.IsNullOrWhiteSpace(value.Version));
            var recipients = string.Join("; ", group.Select(value => (value.ElementName is null ? value.ProcessName : $"{value.ProcessName} / {value.ElementName}") + (string.IsNullOrWhiteSpace(value.Condition) ? "" : $" (при условии: {value.Condition})")).Distinct());
            Warn(unknown ? "version-unverified" : "version-source-missing",
                $"Получатели требуют версию «{group.Key}»: {recipients}. " + (unknown
                    ? "У части источников версия не указана — возможность передачи не подтверждена."
                    : "Источник этой версии среди доступных моделей не найден.") + " Условия ветвей и внешние источники требуют отдельной проверки.");
        }
        if (item.Managed && required.Length > 0 && item.LifecycleState is "Archived" or "Draft")
            Warn(item.LifecycleState == "Archived" ? "archived-in-use" : "draft-in-use",
                $"Объект реестра имеет состояние «{(item.LifecycleState == "Archived" ? "Архивный" : "Черновик") }», но используется как обязательный вход. Уточните допустимое состояние и версии у получателей; статус реестра не является статусом каждого файла.");
        return issues.GroupBy(issue => issue.Code).Select(group => group.First() with { Message = string.Join(" ", group.Select(issue => issue.Message)) }).ToArray();
    }
}
