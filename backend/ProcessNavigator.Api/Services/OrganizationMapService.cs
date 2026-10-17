using System.Text.Json;
using System.Security.Cryptography;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class OrganizationMapService(IWebHostEnvironment environment, ProcessCatalogService catalog, ProcessEditLockService editLocks)
{
    private readonly string path = Path.Combine(environment.ContentRootPath, "Data", "organization.json");
    private readonly SemaphoreSlim writeLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<OrganizationMapModel> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("Organization map configuration was not found.", path);
        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        var model = JsonSerializer.Deserialize<OrganizationMapModel>(bytes, JsonOptions)
            ?? throw new InvalidDataException("Organization map configuration is empty.");
        Validate(model);
        return model with { Revision = Convert.ToHexString(SHA256.HashData(bytes)) };
    }

    public async Task<OrganizationMapModel> SaveAsync(OrganizationMapModel model, CancellationToken cancellationToken = default)
    {
        Validate(model);
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(model.Revision) || !model.Revision.Equals(current.Revision, StringComparison.OrdinalIgnoreCase))
                throw new OrganizationConflictException("Оргструктура была изменена после открытия этого окна. Закройте его, обновите данные и повторите изменение.");
            await EnsureParticipantUnitsPreservedAsync(current, model, cancellationToken);
            var normalized = NormalizeDepartments(model);
            var revision = await WriteAsync(normalized, cancellationToken);
            return normalized with { Revision = revision };
        }
        finally { writeLock.Release(); }
    }

    public async Task<OrganizationMapModel> SaveProcessLanesAsync(string processId, ProcessLaneOrganizationUpdateModel update, CancellationToken cancellationToken = default)
    {
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            ProcessModel process;
            try { process = await catalog.LoadAsync(processId, draft: true, cancellationToken); }
            catch (FileNotFoundException) { process = await catalog.LoadAsync(processId, draft: false, cancellationToken); }

            var laneIds = process.Lanes.Select(lane => lane.Id).ToHashSet(StringComparer.Ordinal);
            if (update.Lanes is null || update.Lanes.Count != laneIds.Count ||
                update.Lanes.Select(lane => lane.LaneId).Distinct(StringComparer.Ordinal).Count() != laneIds.Count ||
                update.Lanes.Any(lane => !laneIds.Contains(lane.LaneId)))
                throw new InvalidDataException("Состав дорожек изменился. Обновите процесс и назначьте подразделение каждой текущей дорожке.");

            var current = await LoadAsync(cancellationToken);
            var mappings = update.Lanes.Select(lane =>
            {
                var entity = current.LegalEntities.FirstOrDefault(item => item.Id.Equals(lane.LegalEntityId, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidDataException($"Для дорожки «{lane.LaneId}» выбрано неизвестное юридическое лицо.");
                var unit = (entity.Units ?? []).FirstOrDefault(item => item.Id.Equals(lane.UnitId, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidDataException($"Для дорожки «{lane.LaneId}» выбрано отсутствующее подразделение в «{entity.Name}».");
                var mode = lane.DisplayNameMode ?? (string.IsNullOrWhiteSpace(unit.ShortName) ? "full" : "short");
                return new LaneOrganizationModel(lane.LaneId, entity.Id, unit.Name, unit.Id, mode);
            }).ToArray();
            var entityIds = mappings.Select(item => item.LegalEntityId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var entityNames = entityIds.Select(id => current.LegalEntities.First(entity => entity.Id.Equals(id, StringComparison.OrdinalIgnoreCase)).Name);
            var description = entityIds.Length > 1
                ? $"Сквозной процесс: {string.Join(" → ", entityNames)}."
                : $"Процесс внутри {entityNames.SingleOrDefault() ?? "одного юридического лица"}.";
            var updated = current with
            {
                CrossCompanyProcesses = current.CrossCompanyProcesses
                    .Where(item => !item.ProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase))
                    .Append(new CrossCompanyProcessModel(processId, entityIds, mappings, description)).ToArray()
            };
            Validate(updated);
            var revision = await WriteAsync(updated, cancellationToken);
            return updated with { Revision = revision };
        }
        finally { writeLock.Release(); }
    }

    public async Task<OrganizationMapModel> SaveProcessDirectionsAsync(ProcessDirectionBulkUpdateModel update, CancellationToken cancellationToken = default)
    {
        if (update.Processes is null || update.Processes.Count is < 1 or > 100 ||
            update.Processes.Any(item => string.IsNullOrWhiteSpace(item.ProcessId) || item.Directions is null) ||
            update.Processes.Select(item => item.ProcessId).Distinct(StringComparer.OrdinalIgnoreCase).Count() != update.Processes.Count)
            throw new InvalidDataException("Выберите от 1 до 100 разных процессов для изменения направлений.");

        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadAsync(cancellationToken);
            var knownProcesses = (await catalog.ListAsync(cancellationToken)).Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var selected = update.Processes.ToDictionary(item => item.ProcessId, StringComparer.OrdinalIgnoreCase);
            foreach (var item in update.Processes)
            {
                if (!knownProcesses.Contains(item.ProcessId)) throw new InvalidDataException($"Процесс «{item.ProcessId}» не найден в каталоге.");
                var references = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var reference in item.Directions)
                {
                    if (reference is null || string.IsNullOrWhiteSpace(reference.LegalEntityId) || string.IsNullOrWhiteSpace(reference.DirectionId) ||
                        !references.Add($"{reference.LegalEntityId}\u001f{reference.DirectionId}") ||
                        !current.LegalEntities.Any(entity => entity.Id.Equals(reference.LegalEntityId, StringComparison.OrdinalIgnoreCase) &&
                            entity.Directions.Any(direction => direction.Id.Equals(reference.DirectionId, StringComparison.OrdinalIgnoreCase))))
                        throw new InvalidDataException($"Для процесса «{item.ProcessId}» указано неизвестное или повторяющееся направление.");
                }
            }

            var entities = current.LegalEntities.Select(entity => entity with
            {
                Directions = entity.Directions.Select(direction => direction with
                {
                    ProcessIds = direction.ProcessIds.Where(id => !selected.ContainsKey(id))
                        .Concat(update.Processes.Where(item => item.Directions.Any(reference =>
                            reference.LegalEntityId.Equals(entity.Id, StringComparison.OrdinalIgnoreCase) &&
                            reference.DirectionId.Equals(direction.Id, StringComparison.OrdinalIgnoreCase))).Select(item => item.ProcessId))
                        .ToArray()
                }).ToArray()
            }).ToArray();
            var updated = current with { LegalEntities = entities };
            Validate(updated);
            var revision = await WriteAsync(updated, cancellationToken);
            return updated with { Revision = revision };
        }
        finally { writeLock.Release(); }
    }

    public async Task<DraftLaneSyncReportModel> SyncDraftLaneNamesAsync(CancellationToken cancellationToken = default)
    {
        var organization = await LoadAsync(cancellationToken);
        var catalogItems = await catalog.ListAsync(cancellationToken);
        var items = new List<DraftLaneSyncItemModel>();
        foreach (var binding in organization.CrossCompanyProcesses)
        {
            var summary = catalogItems.FirstOrDefault(item => item.Id.Equals(binding.ProcessId, StringComparison.OrdinalIgnoreCase));
            if (summary is null || !(summary.HasDraft || summary.Status == "Draft")) continue;
            if (editLocks.HasActiveLock(binding.ProcessId))
            {
                items.Add(new(binding.ProcessId, summary.Name, "Skipped", Reason: "Черновик открыт в BPMN-редакторе."));
                continue;
            }
            try
            {
                var count = await catalog.SyncDraftLaneNamesAsync(binding.ProcessId, binding.LaneOrganizations, organization, cancellationToken);
                items.Add(new(binding.ProcessId, summary.Name, count > 0 ? "Updated" : "Unchanged", count));
            }
            catch (Exception exception) when (exception is IOException or InvalidDataException or FileNotFoundException or System.Xml.XmlException)
            {
                items.Add(new(binding.ProcessId, summary.Name, "Skipped", Reason: exception.Message));
            }
        }
        return new DraftLaneSyncReportModel(items.Count(item => item.Status == "Updated"), items.Sum(item => item.RenamedLanes), items);
    }

    public async Task RemoveProcessAsync(string processId, CancellationToken cancellationToken = default)
    {
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadAsync(cancellationToken);
            var entities = current.LegalEntities.Select(entity => entity with
            {
                Directions = entity.Directions.Select(direction => direction with
                {
                    ProcessIds = direction.ProcessIds.Where(id => !id.Equals(processId, StringComparison.OrdinalIgnoreCase)).ToArray()
                }).ToArray()
            }).ToArray();
            var updated = current with
            {
                LegalEntities = entities,
                CrossCompanyProcesses = current.CrossCompanyProcesses.Where(item => !item.ProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase)).ToArray()
            };
            Validate(updated);
            await WriteAsync(updated, cancellationToken);
        }
        finally { writeLock.Release(); }
    }

    private static OrganizationMapModel NormalizeDepartments(OrganizationMapModel model) => model with
    {
        CrossCompanyProcesses = model.CrossCompanyProcesses.Select(process => process with
        {
            LaneOrganizations = process.LaneOrganizations.Select(mapping =>
            {
                var entity = model.LegalEntities.First(item => item.Id.Equals(mapping.LegalEntityId, StringComparison.OrdinalIgnoreCase));
                var unit = (entity.Units ?? []).FirstOrDefault(item => item.Id.Equals(mapping.UnitId, StringComparison.OrdinalIgnoreCase));
                return unit is null ? mapping : mapping with { Department = unit.Name };
            }).ToArray()
        }).ToArray()
    };

    private async Task EnsureParticipantUnitsPreservedAsync(OrganizationMapModel current, OrganizationMapModel updated, CancellationToken cancellationToken)
    {
        var removed = current.LegalEntities
            .SelectMany(entity => (entity.Units ?? []).Select(unit => (EntityId: entity.Id, UnitId: unit.Id)))
            .Where(key => !updated.LegalEntities.Any(entity => entity.Id.Equals(key.EntityId, StringComparison.OrdinalIgnoreCase) &&
                (entity.Units ?? []).Any(unit => unit.Id.Equals(key.UnitId, StringComparison.OrdinalIgnoreCase))))
            .ToHashSet();
        if (removed.Count == 0) return;

        foreach (var item in await catalog.ListAsync(cancellationToken))
        {
            var versions = item.HasDraft || item.Status == "Draft" ? new[] { true, false } : new[] { false };
            foreach (var draft in versions)
            {
                ProcessModel process;
                try { process = await catalog.LoadAsync(item.Id, draft, cancellationToken); }
                catch (FileNotFoundException) { continue; }
                foreach (var node in process.Nodes)
                foreach (var reference in node.ParticipantUnitRefs ?? [])
                {
                    if (removed.Any(key => key.EntityId.Equals(reference.LegalEntityId, StringComparison.OrdinalIgnoreCase) &&
                        key.UnitId.Equals(reference.UnitId, StringComparison.OrdinalIgnoreCase)))
                        throw new InvalidDataException($"Подразделение «{reference.UnitId}» участвует в задаче «{node.Name}» процесса «{process.Name}». Сначала переназначьте участника.");
                }
            }
        }
    }

    private async Task<string> WriteAsync(OrganizationMapModel model, CancellationToken cancellationToken)
    {
        string? temporaryPath = null;
        try
        {
            temporaryPath = Path.Combine(Path.GetDirectoryName(path)!, $".organization-{Guid.NewGuid():N}.tmp");
            var bytes = JsonSerializer.SerializeToUtf8Bytes(model with { Revision = null }, new JsonSerializerOptions(JsonOptions) { WriteIndented = true });
            await File.WriteAllBytesAsync(temporaryPath, bytes, cancellationToken);
            File.Move(temporaryPath, path, overwrite: true);
            temporaryPath = null;
            return Convert.ToHexString(SHA256.HashData(bytes));
        }
        finally { if (temporaryPath is not null) File.Delete(temporaryPath); }
    }

    private static void Validate(OrganizationMapModel model)
    {
        if (string.IsNullOrWhiteSpace(model.Id) || string.IsNullOrWhiteSpace(model.Name))
            throw new InvalidDataException("Organization group ID and name are required.");
        if (model.LegalEntities.Count == 0) throw new InvalidDataException("At least one legal entity is required.");
        if (model.LegalEntities.Count > 50) throw new InvalidDataException("An organization group cannot contain more than 50 legal entities.");
        if (model.LegalEntities.Select(item => item.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != model.LegalEntities.Count)
            throw new InvalidDataException("Legal entity IDs must be unique.");
        var entityIds = model.LegalEntities.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var entity in model.LegalEntities)
        {
            if (string.IsNullOrWhiteSpace(entity.Id) || string.IsNullOrWhiteSpace(entity.Name)) throw new InvalidDataException("Legal entity ID and name are required.");
            if (entity.Directions.Count > 50) throw new InvalidDataException($"Legal entity '{entity.Name}' has too many directions.");
            if (entity.Directions.Select(item => item.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != entity.Directions.Count)
                throw new InvalidDataException($"Direction IDs must be unique within '{entity.Name}'.");
            if (entity.Directions.Any(item => string.IsNullOrWhiteSpace(item.Id) || string.IsNullOrWhiteSpace(item.Name)))
                throw new InvalidDataException($"Every direction in '{entity.Name}' must have an ID and name.");
            ValidateUnits(entity);
        }
        foreach (var process in model.CrossCompanyProcesses)
        {
            if (process.LegalEntityIds.Count == 0 || process.LegalEntityIds.Any(id => !entityIds.Contains(id)))
                throw new InvalidDataException($"Process '{process.ProcessId}' has invalid organization participants.");
            var mappedEntityIds = process.LaneOrganizations.Select(item => item.LegalEntityId).Distinct(StringComparer.OrdinalIgnoreCase).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (!mappedEntityIds.SetEquals(process.LegalEntityIds))
                throw new InvalidDataException($"Process '{process.ProcessId}' participants must be derived from its lane mappings.");
            if (process.LaneOrganizations.Any(item => !process.LegalEntityIds.Contains(item.LegalEntityId, StringComparer.OrdinalIgnoreCase)))
                throw new InvalidDataException($"Process '{process.ProcessId}' maps a lane to a non-participating legal entity.");
            if (process.LaneOrganizations.Any(item => item.DisplayNameMode is not null and not "full" and not "short"))
                throw new InvalidDataException($"Process '{process.ProcessId}' has an invalid lane display name mode.");
            foreach (var mapping in process.LaneOrganizations.Where(item => item.UnitId is not null))
            {
                var entity = model.LegalEntities.First(item => item.Id.Equals(mapping.LegalEntityId, StringComparison.OrdinalIgnoreCase));
                if (!(entity.Units ?? []).Any(unit => unit.Id.Equals(mapping.UnitId, StringComparison.OrdinalIgnoreCase)))
                    throw new InvalidDataException($"Lane '{mapping.LaneId}' references an unknown organization unit.");
            }
            if (process.LaneOrganizations.Select(item => item.LaneId).Distinct(StringComparer.Ordinal).Count() != process.LaneOrganizations.Count)
                throw new InvalidDataException($"Process '{process.ProcessId}' maps the same lane more than once.");
        }
    }

    private static void ValidateUnits(LegalEntityModel entity)
    {
        var units = entity.Units ?? [];
        if (units.Count > 500) throw new InvalidDataException($"Legal entity '{entity.Name}' has too many organization units.");
        if (units.Select(item => item.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != units.Count)
            throw new InvalidDataException($"Organization unit IDs must be unique within '{entity.Name}'.");
        var ids = units.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var unit in units)
        {
            if (string.IsNullOrWhiteSpace(unit.Id) || string.IsNullOrWhiteSpace(unit.Name))
                throw new InvalidDataException($"Every organization unit in '{entity.Name}' must have an ID and name.");
            if (unit.ParentId is not null && (!ids.Contains(unit.ParentId) || unit.ParentId.Equals(unit.Id, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException($"Organization unit '{unit.Name}' has an invalid parent.");
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { unit.Id };
            var parentId = unit.ParentId;
            while (parentId is not null)
            {
                if (!visited.Add(parentId)) throw new InvalidDataException($"Organization hierarchy in '{entity.Name}' contains a cycle.");
                parentId = units.First(item => item.Id.Equals(parentId, StringComparison.OrdinalIgnoreCase)).ParentId;
            }
        }
    }
}

public sealed class OrganizationConflictException(string message) : Exception(message);
