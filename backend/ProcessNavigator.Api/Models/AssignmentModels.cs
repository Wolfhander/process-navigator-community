namespace ProcessNavigator.Api.Models;

public sealed record LaneAssignmentModel(string LaneId, string LaneName, IReadOnlyList<string> UserIds);
public sealed record ProcessAssignmentsModel(string ProcessId, IReadOnlyList<LaneAssignmentModel> Lanes, IReadOnlyList<UserProfileModel> Users);
public sealed record LaneAssignmentUpdateModel(string LaneId, IReadOnlyList<string> UserIds);
public sealed record ProcessAssignmentsUpdateModel(IReadOnlyList<LaneAssignmentUpdateModel> Lanes);
