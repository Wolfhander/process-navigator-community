namespace ProcessNavigator.Api.Models;

public sealed record DeploymentProfileModel(
    string RecommendedMode,
    string HostApplication,
    string Description,
    IReadOnlyList<DeploymentSystemModel> Systems,
    IReadOnlyList<string> Principles);

public sealed record DeploymentSystemModel(
    string Id,
    string Name,
    string Role,
    string Connection,
    string Ownership,
    string Status);
