using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public static class InformationObjectComposition
{
    public static void Validate(string id, IReadOnlyList<InformationObjectComponentModel> components,
        IReadOnlyDictionary<string, IReadOnlyList<InformationObjectComponentModel>> graph, ISet<string> knownIds)
    {
        if (components.Count > 100) throw new InvalidDataException("В одном комплекте допускается не более 100 частей.");
        if (components.Any(item => item is null)) throw new InvalidDataException("Часть комплекта не может быть пустой.");
        if (components.Select(item => item.ObjectId).Distinct(StringComparer.OrdinalIgnoreCase).Count() != components.Count)
            throw new InvalidDataException("Одна часть комплекта указана несколько раз.");
        foreach (var component in components)
        {
            if (string.IsNullOrWhiteSpace(component.ObjectId) || !knownIds.Contains(component.ObjectId)) throw new InvalidDataException("Часть комплекта не найдена в текущем реестре.");
            if (component.Version?.Length > 50 || component.Condition?.Length > 500) throw new InvalidDataException("Версия части должна быть не длиннее 50 символов, условие — 500.");
        }
        var active = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var stack = new Stack<(string Id, bool Exit)>();
        stack.Push((id, false));
        while (stack.TryPop(out var item))
        {
            if (item.Exit) { active.Remove(item.Id); visited.Add(item.Id); continue; }
            if (active.Contains(item.Id)) throw new InvalidDataException("Состав комплекта создаёт самоссылку или цикл.");
            if (visited.Contains(item.Id)) continue;
            if (visited.Count + active.Count > 5000) throw new InvalidDataException("Слишком большая цепочка составных результатов для проверки.");
            active.Add(item.Id); stack.Push((item.Id, true));
            var children = item.Id.Equals(id, StringComparison.OrdinalIgnoreCase) ? components : graph.GetValueOrDefault(item.Id) ?? [];
            foreach (var child in children) stack.Push((child.ObjectId, false));
        }
    }
}
