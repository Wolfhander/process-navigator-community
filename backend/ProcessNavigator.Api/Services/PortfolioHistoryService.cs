using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

// Personal, immutable observations of the full portfolio; not historical reconstruction.
public sealed class PortfolioHistoryService(IWebHostEnvironment environment, PortfolioAnalyticsService analytics, TimeProvider? clock = null)
{
    public const string Algorithm = "portfolio-v2-channels";
    private readonly string root = Path.Combine(environment.ContentRootPath,"Data","PortfolioHistory");
    private readonly SemaphoreSlim gate = new(1,1);
    private static readonly JsonSerializerOptions json = new(JsonSerializerDefaults.Web);
    private const int MaxBytes = 20 * 1024 * 1024;
    private sealed record Archive(int SchemaVersion,string OwnerId,IReadOnlyList<PortfolioHistorySnapshotModel> Snapshots);
    public static string Fingerprint(PortfolioAnalyticsModel data) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(data,json))).ToLowerInvariant();
    private string PathFor(string userId)
    {
        if(string.IsNullOrWhiteSpace(userId)||userId.Length>100)throw new InvalidDataException("Не определён профиль пользователя.");
        return Path.Combine(root,Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userId)))+".json");
    }
    private async Task<Archive> ReadAsync(string userId,CancellationToken ct)
    {
        var path=PathFor(userId);
        if(!File.Exists(path))return new(1,userId,[]);
        if(new FileInfo(path).Length>MaxBytes)throw new InvalidDataException("Хранилище срезов превышает 20 МБ. Данные не изменены.");
        try
        {
            var archive=JsonSerializer.Deserialize<Archive>(await File.ReadAllTextAsync(path,ct),json);
            if(archive is null||archive.SchemaVersion!=1||archive.OwnerId!=userId||archive.Snapshots is null||archive.Snapshots.Count>30)
                throw new InvalidDataException("Неверный формат или владелец истории аналитики.");
            var ids=new HashSet<string>();
            foreach(var item in archive.Snapshots)
            {
                if(item is null||!Guid.TryParseExact(item.Id,"N",out _)||!ids.Add(item.Id)||string.IsNullOrWhiteSpace(item.Name)||item.Name.Length>100
                    ||string.IsNullOrWhiteSpace(item.Algorithm)||item.CapturedAt==default||item.Data?.Processes is null||item.Data.Processes.Count!=item.Data.TotalProcesses
                    ||item.Data.Processes.Any(p=>p is null||string.IsNullOrWhiteSpace(p.Id))||item.Data.Processes.Select(p=>p.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=item.Data.Processes.Count||Fingerprint(item.Data)!=item.Fingerprint)
                    throw new InvalidDataException("Срез аналитики повреждён. История не перезаписана.");
            }
            return archive;
        }
        catch(JsonException){throw new InvalidDataException("История аналитики повреждена. Исходный файл не изменён.");}
    }
    public async Task<IReadOnlyList<PortfolioHistorySummaryModel>> ListAsync(string userId,CancellationToken ct=default)
    {
        await gate.WaitAsync(ct);
        try { return (await ReadAsync(userId,ct)).Snapshots.OrderByDescending(item=>item.CapturedAt).ThenBy(item=>item.Id)
            .Select(item=>new PortfolioHistorySummaryModel(item.Id,item.Name,item.CapturedAt,item.Algorithm,item.Fingerprint,item.Data.TotalProcesses,item.Data.AverageReadinessPercent,item.Data.InformationIssueCount)).ToArray(); }
        finally { gate.Release(); }
    }
    public async Task<PortfolioHistorySnapshotModel> LoadAsync(string userId,string id,CancellationToken ct=default)
    {
        if(!Guid.TryParseExact(id,"N",out var parsed))throw new InvalidDataException("Неверный идентификатор среза.");
        id=parsed.ToString("N");
        await gate.WaitAsync(ct);
        try { return (await ReadAsync(userId,ct)).Snapshots.SingleOrDefault(item=>item.Id==id)??throw new KeyNotFoundException("Срез этого профиля не найден."); }
        finally { gate.Release(); }
    }
    public async Task<PortfolioHistorySnapshotModel> SaveAsync(string userId,PortfolioHistorySaveModel request,CancellationToken ct=default)
    {
        var path=PathFor(userId);var name=request.Name?.Trim();
        if(string.IsNullOrEmpty(name)||name.Length>100||request.ExpectedData is null)throw new InvalidDataException("Укажите название до 100 символов и обновите аналитику.");
        var current=await analytics.BuildAsync(ct);var capturedAt=(clock??TimeProvider.System).GetUtcNow();var fingerprint=Fingerprint(current);
        if(Fingerprint(request.ExpectedData)!=fingerprint)throw new InvalidDataException("Показатели изменились. Обновите аналитику перед сохранением среза.");
        await gate.WaitAsync(ct);
        try
        {
            var archive=await ReadAsync(userId,ct);
            var latest=archive.Snapshots.OrderByDescending(item=>item.CapturedAt).FirstOrDefault();
            if(latest is not null&&latest.Name==name&&latest.Fingerprint==fingerprint&&latest.Algorithm==Algorithm
                &&Math.Abs((capturedAt-latest.CapturedAt).TotalSeconds)<=60)return latest;
            if(archive.Snapshots.Count>=30)throw new InvalidDataException("В истории уже 30 срезов. Автоматического удаления нет; новый срез не сохранён.");
            var snapshot=new PortfolioHistorySnapshotModel(Guid.NewGuid().ToString("N"),name,capturedAt,Algorithm,fingerprint,current);
            var bytes=JsonSerializer.SerializeToUtf8Bytes(archive with { Snapshots=archive.Snapshots.Append(snapshot).ToArray() },json);
            if(bytes.Length>MaxBytes)throw new InvalidDataException("История превысит 20 МБ. Запись отменена без удаления срезов.");
            Directory.CreateDirectory(root);var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
            try { await File.WriteAllBytesAsync(temporary,bytes,ct);ct.ThrowIfCancellationRequested();File.Move(temporary,path,true); }
            finally { if(File.Exists(temporary))File.Delete(temporary); }
            return snapshot;
        }
        finally { gate.Release(); }
    }
}
