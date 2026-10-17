namespace ProcessNavigator.Api.Models;

public sealed record RepositoryArtifactModel(
    string Id,
    string Name,
    string Kind,
    string CurrentVersion,
    IReadOnlyList<RepositoryArtifactVersionModel> Versions);

public sealed record RepositoryArtifactVersionModel(
    string Version,
    string FileName,
    string ContentType,
    long Size,
    DateTimeOffset UploadedAt,
    bool Approved);

public sealed record RepositoryArtifactUploadModel(
    string Id,
    string Name,
    string Kind,
    string Version,
    string Reference);
