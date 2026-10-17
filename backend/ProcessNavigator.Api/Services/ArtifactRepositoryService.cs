using System.Text.Json;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ArtifactRepositoryService(IWebHostEnvironment environment)
{
    private const long MaximumFileSize = 20 * 1024 * 1024;
    private readonly SemaphoreSlim writeLock = new(1, 1);
    private string Root => Path.Combine(environment.ContentRootPath, "Data", "Artifacts");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public async Task<IReadOnlyList<RepositoryArtifactModel>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(Root)) return [];
        var artifacts = new List<RepositoryArtifactModel>();
        foreach (var path in Directory.EnumerateFiles(Root, "artifact.json", SearchOption.AllDirectories))
        {
            try
            {
                var artifact = JsonSerializer.Deserialize<RepositoryArtifactModel>(await File.ReadAllTextAsync(path, cancellationToken), JsonOptions);
                if (artifact is not null) artifacts.Add(artifact);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
            {
                // Damaged repository records are skipped and can be handled by administration diagnostics later.
            }
        }
        return artifacts.OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
    }

    public async Task<RepositoryArtifactUploadModel> UploadAsync(
        IFormFile file, string name, string kind, string version, string? artifactId,
        CancellationToken cancellationToken = default)
    {
        if (file.Length == 0) throw new InvalidDataException("The artifact file is empty.");
        if (file.Length > MaximumFileSize) throw new InvalidDataException("The artifact file exceeds the 20 MB limit.");
        name = Required(name, 200, "Artifact name");
        kind = Required(kind, 80, "Artifact kind");
        version = Required(version, 40, "Artifact version");
        var id = string.IsNullOrWhiteSpace(artifactId) ? $"artifact-{Guid.NewGuid():N}" : RequiredId(artifactId);
        var safeVersion = SafePart(version);

        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var directory = Path.Combine(Root, id);
            var metadataPath = Path.Combine(directory, "artifact.json");
            RepositoryArtifactModel? existing = null;
            if (File.Exists(metadataPath))
                existing = JsonSerializer.Deserialize<RepositoryArtifactModel>(await File.ReadAllTextAsync(metadataPath, cancellationToken), JsonOptions)
                    ?? throw new InvalidDataException("Artifact metadata is empty.");
            var versionDirectory = Path.Combine(directory, "versions", safeVersion);
            if (Directory.Exists(versionDirectory)) throw new ArtifactConflictException($"Version '{version}' already exists for artifact '{id}'.");

            Directory.CreateDirectory(versionDirectory);
            var contentPath = Path.Combine(versionDirectory, "content.bin");
            try
            {
                await using (var stream = new FileStream(contentPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    await file.CopyToAsync(stream, cancellationToken);
                var now = DateTimeOffset.UtcNow;
                var versions = (existing?.Versions ?? []).Select(item => item with { Approved = false }).ToList();
                versions.Add(new RepositoryArtifactVersionModel(version, Path.GetFileName(file.FileName),
                    string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
                    file.Length, now, true));
                var updated = new RepositoryArtifactModel(id, name, kind, version, versions.OrderByDescending(item => item.UploadedAt).ToArray());
                var temporaryMetadata = Path.Combine(directory, $".{Guid.NewGuid():N}.tmp");
                await File.WriteAllTextAsync(temporaryMetadata, JsonSerializer.Serialize(updated, JsonOptions), cancellationToken);
                File.Move(temporaryMetadata, metadataPath, overwrite: true);
                return new RepositoryArtifactUploadModel(id, name, kind, version, $"artifact:{id}");
            }
            catch
            {
                if (Directory.Exists(versionDirectory)) Directory.Delete(versionDirectory, recursive: true);
                throw;
            }
        }
        finally { writeLock.Release(); }
    }

    public async Task<(string Path, string ContentType, string FileName)> ResolveAsync(
        string artifactId, string? version, CancellationToken cancellationToken = default)
    {
        var id = RequiredId(artifactId);
        var metadataPath = Path.Combine(Root, id, "artifact.json");
        if (!File.Exists(metadataPath)) throw new FileNotFoundException();
        var artifact = JsonSerializer.Deserialize<RepositoryArtifactModel>(await File.ReadAllTextAsync(metadataPath, cancellationToken), JsonOptions)
            ?? throw new FileNotFoundException();
        var selectedVersion = string.IsNullOrWhiteSpace(version) ? artifact.CurrentVersion : version;
        var metadata = artifact.Versions.SingleOrDefault(item => string.Equals(item.Version, selectedVersion, StringComparison.OrdinalIgnoreCase))
            ?? throw new FileNotFoundException();
        var path = Path.Combine(Root, id, "versions", SafePart(metadata.Version), "content.bin");
        if (!File.Exists(path)) throw new FileNotFoundException();
        return (path, metadata.ContentType, metadata.FileName);
    }

    private static string Required(string value, int maximum, string label)
    {
        var result = value?.Trim();
        if (string.IsNullOrWhiteSpace(result)) throw new InvalidDataException($"{label} is required.");
        if (result.Length > maximum) throw new InvalidDataException($"{label} exceeds {maximum} characters.");
        return result;
    }

    private static string RequiredId(string value)
    {
        var result = Required(value, 100, "Artifact ID");
        return SafeId().IsMatch(result) ? result : throw new InvalidDataException("Artifact ID is invalid.");
    }

    private static string SafePart(string value) => Regex.Replace(value, "[^A-Za-z0-9._-]", "_");
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeId();
}

public sealed class ArtifactConflictException(string message) : Exception(message);
