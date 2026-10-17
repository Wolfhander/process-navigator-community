namespace ProcessNavigator.Api.Models;

public sealed record BackupInfoModel(string FileName, DateTimeOffset CreatedAt, long Size, int FileCount, string Sha256);
public sealed record BackupRestorePreviewModel(string FormatVersion, DateTimeOffset CreatedAt, string CreatedBy, int FileCount, int ExistingFileCount, long TotalSize, bool Compatible, IReadOnlyList<string> Warnings);
public sealed record BackupRestoreResultModel(int RestoredFileCount, string SafetyBackupFileName, bool RestartRequired);
