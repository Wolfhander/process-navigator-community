using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public static class ProcessBoundaryCheck
{
    public static IReadOnlyList<ProcessValidationIssueModel> Compare(NodeModel parent, ProcessModel child)
    {
        var issues = new List<ProcessValidationIssueModel>();
        void Warn(string code, string message) => issues.Add(new("linked-process-boundary-" + code, "Warning", message, parent.Id, parent.Name, "Decomposition"));
        var bindings = (parent.InformationObjects ?? []).Where(item => item.Role is "Input" or "Output").ToArray();
        var nested = child.Nodes.SelectMany(node => node.InformationObjects ?? []).ToArray();
        if (bindings.Length == 0)
        {
            Warn("unmapped", $"У этапа «{parent.Name}» нет структурированных входов/выходов. Сопоставление с «{child.Name}» по ID невозможно; заполненный текст не подтверждает согласованность границ.");
            return issues;
        }
        foreach (var binding in bindings.Where(item => item.Required))
        {
            var candidates = nested.Where(item => item.Role == binding.Role && item.ObjectId.Equals(binding.ObjectId, StringComparison.OrdinalIgnoreCase)).ToArray();
            var direction = binding.Role == "Input" ? "вход" : "выход";
            if (candidates.Length == 0)
            {
                Warn(binding.Role == "Input" ? "input-missing" : "output-missing",
                    $"Обязательный {direction} «{binding.Name}» [{binding.ObjectId}] этапа не сопоставлен по ID с {direction}ом задач детального процесса «{child.Name}». Условия ветвей требуют ручной проверки.");
                continue;
            }
            if (!string.IsNullOrWhiteSpace(binding.Version) && !candidates.Any(item => item.Version == binding.Version))
                Warn("version", $"Для объекта «{binding.Name}» [{binding.ObjectId}] на границе указана версия «{binding.Version}», но в соответствующих задачах «{child.Name}» такая версия не указана. Проверьте версии и условия передачи.");
        }
        return issues;
    }
}
