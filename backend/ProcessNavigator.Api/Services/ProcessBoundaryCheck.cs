using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public static class ProcessBoundaryCheck
{
    public static IReadOnlyList<ProcessValidationIssueModel> Compare(NodeModel parent, ProcessModel child)
    {
        var issues = new List<ProcessValidationIssueModel>();
        var reported = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Warn(string code, string message, string objectId = "")
        {
            if (reported.Add(code + ":" + objectId))
                issues.Add(new("linked-process-boundary-" + code, "Warning", message, parent.Id, parent.Name, "Decomposition"));
        }
        var bindings = (parent.InformationObjects ?? []).Where(item => item.Role is "Input" or "Output").ToArray();
        var nested = child.Nodes.SelectMany(node => node.InformationObjects ?? []).ToArray();
        if (bindings.Length == 0)
        {
            Warn("unmapped", $"У этапа «{parent.Name}» нет структурированных входов/выходов. Сопоставление с «{child.Name}» по ID невозможно; заполненный текст не подтверждает согласованность границ.");
        }
        foreach (var binding in bindings.Where(item => item.Required))
        {
            var candidates = nested.Where(item => item.Role == binding.Role && item.ObjectId.Equals(binding.ObjectId, StringComparison.OrdinalIgnoreCase)).ToArray();
            var direction = binding.Role == "Input" ? "вход" : "выход";
            if (candidates.Length == 0)
            {
                Warn(binding.Role == "Input" ? "input-missing" : "output-missing",
                    $"{(string.IsNullOrWhiteSpace(binding.Condition) ? "Обязательный" : "Условный обязательный")} {direction} «{binding.Name}» [{binding.ObjectId}] этапа не сопоставлен по ID с {direction}ом задач детального процесса «{child.Name}». Условия ветвей требуют ручной проверки.", binding.ObjectId);
                continue;
            }
            if (!string.IsNullOrWhiteSpace(binding.Version) && !candidates.Any(item => item.Version == binding.Version))
                Warn("version", $"Для объекта «{binding.Name}» [{binding.ObjectId}] на границе указана версия «{binding.Version}», но в соответствующих задачах «{child.Name}» такая версия не указана. Проверьте версии и условия передачи.", binding.ObjectId);
        }
        // A missing producer is a structural indication, not proof of an external source.
        // If a producer exists, route/branch analysis is deliberately left to later checks.
        foreach (var input in nested.Where(item => item.Role == "Input" && item.Required))
        {
            if (nested.Any(item => item.Role == "Output" && item.ObjectId.Equals(input.ObjectId, StringComparison.OrdinalIgnoreCase))) continue;
            var candidates = bindings.Where(item => item.Role == "Input" && item.ObjectId.Equals(input.ObjectId, StringComparison.OrdinalIgnoreCase)).ToArray();
            var conditional = !string.IsNullOrWhiteSpace(input.Condition);
            if (candidates.Length == 0)
                Warn(conditional ? "conditional-external-input" : "external-input",
                    $"{(conditional ? "Условный обязательный" : "Обязательный")} вход «{input.Name}» [{input.ObjectId}] нужен задачам «{child.Name}», но отсутствует среди входов родительского этапа. Производитель внутри детального процесса не указан; проверьте внешний источник{(conditional ? $" и условие «{input.Condition}»" : "")}.", input.ObjectId);
            else if (!conditional && !candidates.Any(item => item.Required && string.IsNullOrWhiteSpace(item.Condition)))
                Warn("input-obligation", $"Вход «{input.Name}» [{input.ObjectId}] обязателен в детальном процессе «{child.Name}», но у родительского этапа отмечен только как необязательный или условный. Проверьте условия передачи.", input.ObjectId);
            if (candidates.Length > 0 && !string.IsNullOrWhiteSpace(input.Version) && !candidates.Any(item => item.Version == input.Version))
                Warn("version", $"Детальный процесс «{child.Name}» требует объект «{input.Name}» [{input.ObjectId}] версии «{input.Version}», но такая версия не указана среди входов родительского этапа. Проверьте передачу и условия ветвей.", input.ObjectId);
        }
        return issues;
    }
}
