using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class RepositoryBackupService(IWebHostEnvironment environment)
{
    private readonly string dataRoot = Path.Combine(environment.ContentRootPath, "Data");
    private readonly string backupRoot = Path.Combine(environment.ContentRootPath, "Data", "Backups");
    private readonly SemaphoreSlim operationLock = new(1, 1);

    public async Task<BackupInfoModel> CreateAsync(string createdBy, CancellationToken cancellationToken = default)
    {
        await operationLock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(backupRoot);
            var createdAt = DateTimeOffset.UtcNow;
            var fileName = $"process-navigator-{createdAt:yyyyMMdd-HHmmss}.zip";
            var destination = Path.Combine(backupRoot, fileName);
            var files = Directory.EnumerateFiles(dataRoot, "*", SearchOption.AllDirectories)
                .Where(path => !path.StartsWith(backupRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray();
            var manifestFiles = new List<BackupManifestFile>();
            await using (var stream = File.Create(destination))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create))
            {
                foreach (var source in files)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var relative = Path.GetRelativePath(dataRoot, source).Replace('\\', '/');
                    var entry = archive.CreateEntry($"Data/{relative}", CompressionLevel.Optimal);
                    await using var input = File.OpenRead(source);
                    await using var output = entry.Open();
                    await input.CopyToAsync(output, cancellationToken);
                    manifestFiles.Add(new(relative, new FileInfo(source).Length, await HashFileAsync(source, cancellationToken)));
                }
                var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
                await using var manifestStream = manifestEntry.Open();
                await JsonSerializer.SerializeAsync(manifestStream, new BackupManifest("1.0", createdAt, createdBy, manifestFiles), new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
            }
            return await DescribeAsync(destination, files.Length, createdAt, cancellationToken);
        }
        finally { operationLock.Release(); }
    }

    public async Task<IReadOnlyList<BackupInfoModel>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(backupRoot)) return [];
        var result = new List<BackupInfoModel>();
        foreach (var path in Directory.EnumerateFiles(backupRoot, "process-navigator-*.zip").OrderByDescending(path => path))
        {
            using var archive = ZipFile.OpenRead(path);
            result.Add(await DescribeAsync(path, Math.Max(0, archive.Entries.Count - 1), File.GetCreationTimeUtc(path), cancellationToken));
        }
        return result;
    }

    public string GetPath(string fileName)
    {
        var clean = Path.GetFileName(fileName);
        if (!clean.Equals(fileName, StringComparison.Ordinal) || !clean.StartsWith("process-navigator-") || !clean.EndsWith(".zip")) throw new InvalidDataException("Некорректное имя резервной копии.");
        var path = Path.Combine(backupRoot, clean);
        if (!File.Exists(path)) throw new FileNotFoundException("Резервная копия не найдена.", path);
        return path;
    }

    public async Task<BackupRestorePreviewModel> PreviewRestoreAsync(Stream package, CancellationToken cancellationToken = default)
    {
        var inspected = await InspectAsync(package, cancellationToken);
        var existing = inspected.Manifest.Files.Count(file => File.Exists(SafeDataPath(file.Path)));
        return new(inspected.Manifest.FormatVersion, inspected.Manifest.CreatedAt, inspected.Manifest.CreatedBy,
            inspected.Manifest.Files.Count, existing, inspected.Manifest.Files.Sum(file => file.Size), true,
            existing > 0 ? [$"Будут заменены существующие файлы: {existing}.", "Перед восстановлением система автоматически создаст страховочную копию."] : []);
    }

    public async Task<BackupRestoreResultModel> RestoreAsync(Stream package, string restoredBy, CancellationToken cancellationToken = default)
    {
        await operationLock.WaitAsync(cancellationToken);
        string? temporary = null;
        try
        {
            temporary = Path.Combine(Path.GetTempPath(), $"process-navigator-restore-{Guid.NewGuid():N}.zip");
            await using (var output = File.Create(temporary)) await package.CopyToAsync(output, cancellationToken);
            await using var inspectionStream = File.OpenRead(temporary);
            var inspected = await InspectAsync(inspectionStream, cancellationToken);
            var safety = await CreateUnlockedAsync($"Автоматически перед восстановлением: {restoredBy}", cancellationToken);
            using var archive = ZipFile.OpenRead(temporary);
            foreach (var file in inspected.Manifest.Files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var entry = archive.GetEntry($"Data/{file.Path.Replace('\\', '/')}") ?? throw new InvalidDataException($"В архиве отсутствует файл '{file.Path}'.");
                var destination = SafeDataPath(file.Path);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                var staged = destination + $".restore-{Guid.NewGuid():N}.tmp";
                await using (var input = entry.Open()) await using (var output = File.Create(staged)) await input.CopyToAsync(output, cancellationToken);
                File.Move(staged, destination, true);
            }
            return new(inspected.Manifest.Files.Count, safety.FileName, true);
        }
        finally
        {
            if (temporary is not null && File.Exists(temporary)) File.Delete(temporary);
            operationLock.Release();
        }
    }

    private async Task<InspectedBackup> InspectAsync(Stream package, CancellationToken cancellationToken)
    {
        using var archive = new ZipArchive(package, ZipArchiveMode.Read, leaveOpen: true);
        var manifestEntry = archive.GetEntry("manifest.json") ?? throw new InvalidDataException("Архив не содержит manifest.json.");
        BackupManifest manifest;
        await using (var stream = manifestEntry.Open()) manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(stream, cancellationToken: cancellationToken) ?? throw new InvalidDataException("Манифест резервной копии пуст.");
        if (manifest.FormatVersion != "1.0") throw new InvalidDataException($"Версия формата '{manifest.FormatVersion}' не поддерживается.");
        if (manifest.Files.Count == 0) throw new InvalidDataException("Резервная копия не содержит файлов данных.");
        foreach (var file in manifest.Files)
        {
            SafeDataPath(file.Path);
            var entry = archive.GetEntry($"Data/{file.Path.Replace('\\', '/')}") ?? throw new InvalidDataException($"В архиве отсутствует файл '{file.Path}'.");
            await using var stream = entry.Open();
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
            if (!hash.Equals(file.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException($"Контрольная сумма файла '{file.Path}' не совпадает.");
        }
        return new(manifest);
    }

    private string SafeDataPath(string relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative)) throw new InvalidDataException("Резервная копия содержит небезопасный путь.");
        var root = Path.GetFullPath(dataRoot) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(dataRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || full.StartsWith(Path.GetFullPath(backupRoot) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Резервная копия содержит небезопасный путь.");
        return full;
    }

    private async Task<BackupInfoModel> CreateUnlockedAsync(string createdBy, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(backupRoot);
        var createdAt = DateTimeOffset.UtcNow;
        var fileName = $"process-navigator-{createdAt:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.zip";
        var destination = Path.Combine(backupRoot, fileName);
        var files = Directory.EnumerateFiles(dataRoot, "*", SearchOption.AllDirectories).Where(path => !path.StartsWith(backupRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)).OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray();
        var manifestFiles = new List<BackupManifestFile>();
        await using (var stream = File.Create(destination))
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create))
        {
            foreach (var source in files)
            {
                var relative = Path.GetRelativePath(dataRoot, source).Replace('\\', '/'); var entry = archive.CreateEntry($"Data/{relative}", CompressionLevel.Optimal);
                await using var input = File.OpenRead(source); await using var output = entry.Open(); await input.CopyToAsync(output, cancellationToken);
                manifestFiles.Add(new(relative, new FileInfo(source).Length, await HashFileAsync(source, cancellationToken)));
            }
            var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal); await using var manifestStream = manifestEntry.Open();
            await JsonSerializer.SerializeAsync(manifestStream, new BackupManifest("1.0", createdAt, createdBy, manifestFiles), new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
        }
        return await DescribeAsync(destination, files.Length, createdAt, cancellationToken);
    }

    private static async Task<BackupInfoModel> DescribeAsync(string path, int count, DateTimeOffset createdAt, CancellationToken token) =>
        new(Path.GetFileName(path), createdAt, new FileInfo(path).Length, count, await HashFileAsync(path, token));
    private static async Task<string> HashFileAsync(string path, CancellationToken token)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, token)).ToLowerInvariant();
    }
    private sealed record BackupManifest(string FormatVersion, DateTimeOffset CreatedAt, string CreatedBy, IReadOnlyList<BackupManifestFile> Files);
    private sealed record BackupManifestFile(string Path, long Size, string Sha256);
    private sealed record InspectedBackup(BackupManifest Manifest);
}
