namespace ProcessNavigator.Api.Models;

public sealed record OrganizationMapModel(
    string Id,
    string Name,
    string Description,
    IReadOnlyList<LegalEntityModel> LegalEntities,
    IReadOnlyList<CrossCompanyProcessModel> CrossCompanyProcesses,
    string? Revision = null);

public sealed record LegalEntityModel(
    string Id,
    string Name,
    string Description,
    IReadOnlyList<BusinessDirectionModel> Directions,
    IReadOnlyList<OrganizationUnitModel>? Units = null);

public sealed record OrganizationUnitModel(
    string Id,
    string? ParentId,
    string Name,
    string ShortName,
    string ManagerPosition);

public sealed record BusinessDirectionModel(
    string Id,
    string Name,
    string Description,
    string Icon,
    IReadOnlyList<string> ProcessIds);

public sealed record ProcessDirectionRefModel(string LegalEntityId, string DirectionId);
public sealed record ProcessDirectionSelectionModel(string ProcessId, IReadOnlyList<ProcessDirectionRefModel> Directions);
public sealed record ProcessDirectionBulkUpdateModel(IReadOnlyList<ProcessDirectionSelectionModel> Processes);

public sealed record CrossCompanyProcessModel(
    string ProcessId,
    IReadOnlyList<string> LegalEntityIds,
    IReadOnlyList<LaneOrganizationModel> LaneOrganizations,
    string Description);

public sealed record LaneOrganizationModel(
    string LaneId,
    string LegalEntityId,
    string Department,
    string? UnitId = null,
    string? DisplayNameMode = null);

public sealed record DraftLaneSyncItemModel(string ProcessId, string ProcessName, string Status, int RenamedLanes = 0, string? Reason = null);
public sealed record DraftLaneSyncReportModel(int UpdatedProcesses, int RenamedLanes, IReadOnlyList<DraftLaneSyncItemModel> Items);
