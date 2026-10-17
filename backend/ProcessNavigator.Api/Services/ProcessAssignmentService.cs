using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class ProcessAssignmentService(IWebHostEnvironment environment)
{
    private readonly string root = Path.Combine(environment.ContentRootPath, "Data", "Assignments");
    private readonly SemaphoreSlim writeLock = new(1, 1);

    public async Task<ProcessAssignmentsModel> LoadAsync(ProcessModel process, IReadOnlyList<UserProfileModel> users, CancellationToken cancellationToken)
    {
        var stored = await ReadAsync(process.Id, cancellationToken);
        var lanes = process.Lanes.Select(lane => new LaneAssignmentModel(lane.Id, lane.Name,
            stored.FirstOrDefault(item => item.LaneId == lane.Id)?.UserIds ?? [])).ToArray();
        return new(process.Id, lanes, users.Where(user => user.IsActive).OrderBy(user => user.DisplayName).ToArray());
    }

    public async Task<ProcessAssignmentsModel> SaveAsync(ProcessModel process, ProcessAssignmentsUpdateModel update,
        IReadOnlyList<UserProfileModel> users, CancellationToken cancellationToken)
    {
        var laneIds = process.Lanes.Select(lane => lane.Id).ToHashSet(StringComparer.Ordinal);
        var userIds = users.Where(user => user.IsActive).Select(user => user.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (update.Lanes.Any(item => !laneIds.Contains(item.LaneId))) throw new InvalidDataException("Назначение содержит неизвестную дорожку BPMN.");
        if (update.Lanes.SelectMany(item => item.UserIds).Any(id => !userIds.Contains(id))) throw new InvalidDataException("Назначение содержит неизвестного или отключённого пользователя.");
        var normalized = process.Lanes.Select(lane => new StoredAssignment(lane.Id,
            update.Lanes.FirstOrDefault(item => item.LaneId == lane.Id)?.UserIds.Distinct(StringComparer.OrdinalIgnoreCase).ToArray() ?? [])).ToArray();
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(root);
            var path = PathFor(process.Id); var temporary = path + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(normalized, new JsonSerializerOptions { WriteIndented = true }), cancellationToken);
            File.Move(temporary, path, true);
        }
        finally { writeLock.Release(); }
        return await LoadAsync(process, users, cancellationToken);
    }

    private async Task<IReadOnlyList<StoredAssignment>> ReadAsync(string processId, CancellationToken cancellationToken)
    {
        var path = PathFor(processId);
        if (!File.Exists(path)) return [];
        return JsonSerializer.Deserialize<List<StoredAssignment>>(await File.ReadAllTextAsync(path, cancellationToken), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
    }

    private string PathFor(string processId)
    {
        if (processId.Length is < 1 or > 100 || processId.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.')))
            throw new InvalidDataException("Недопустимый идентификатор процесса.");
        return Path.Combine(root, processId + ".json");
    }
    private sealed record StoredAssignment(string LaneId, IReadOnlyList<string> UserIds);
}
