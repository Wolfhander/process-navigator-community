using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class OneCIntegrationService
{
    private readonly string storagePath;
    private readonly IDataProtector protector;
    private readonly IHttpClientFactory clients;
    private readonly SemaphoreSlim writeLock = new(1, 1);

    public OneCIntegrationService(IWebHostEnvironment environment, IDataProtectionProvider protection, IHttpClientFactory clients)
    {
        storagePath = Path.Combine(environment.ContentRootPath, "Data", "Integrations", "one-c.json");
        protector = protection.CreateProtector("ProcessNavigator.OneC.Password.v1");
        this.clients = clients;
    }

    public OneCIntegrationSettingsModel GetSettings()
    {
        var stored = Read(); return Public(stored);
    }

    public async Task<OneCIntegrationSettingsModel> UpdateAsync(OneCIntegrationUpdateModel update, CancellationToken cancellationToken)
    {
        Validate(update);
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var current = Read();
            var protectedPassword = string.IsNullOrEmpty(update.Password) ? current.ProtectedPassword : protector.Protect(update.Password);
            var stored = new StoredSettings(update.Enabled, update.BaseUrl.Trim().TrimEnd('/'), NormalizePath(update.HealthPath),
                NormalizePath(update.CommandPath), update.Username.Trim(), protectedPassword, update.TimeoutSeconds);
            Directory.CreateDirectory(Path.GetDirectoryName(storagePath)!); var temporary = storagePath + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(stored, new JsonSerializerOptions { WriteIndented = true }), cancellationToken);
            File.Move(temporary, storagePath, true); return Public(stored);
        }
        finally { writeLock.Release(); }
    }

    public async Task<OneCConnectionStatusModel> TestAsync(CancellationToken cancellationToken)
    {
        var stored = Read();
        if (!stored.Enabled) return new(false, "Demo", "Интеграция выключена: ERP-команды выполняются демонстрационным адаптером.", DateTimeOffset.UtcNow);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(stored.BaseUrl + "/"), stored.HealthPath.TrimStart('/')));
            ApplyAuthentication(request, stored);
            using var response = await SendAsync(request, stored.TimeoutSeconds, cancellationToken);
            return response.IsSuccessStatusCode
                ? new(true, "OneC", "Соединение с HTTP-сервисом 1С установлено.", DateTimeOffset.UtcNow)
                : new(false, "OneC", $"1С вернула HTTP {(int)response.StatusCode} {response.ReasonPhrase}.", DateTimeOffset.UtcNow);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or UriFormatException)
        { return new(false, "OneC", $"Соединение не установлено: {exception.Message}", DateTimeOffset.UtcNow); }
    }

    public async Task<OneCCommandResponseModel> ExecuteAsync(OneCCommandRequestModel command, CancellationToken cancellationToken)
    {
        var stored = Read();
        if (!stored.Enabled) return new(true, "Команда принята демонстрационным адаптером 1С:ERP.", $"1C-DEMO-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}");
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(stored.BaseUrl + "/"), stored.CommandPath.TrimStart('/')))
            { Content = JsonContent.Create(command) };
            ApplyAuthentication(request, stored);
            using var response = await SendAsync(request, stored.TimeoutSeconds, cancellationToken);
            if (!response.IsSuccessStatusCode) return new(false, $"1С отклонила команду: HTTP {(int)response.StatusCode} {response.ReasonPhrase}.", null);
            var result = await response.Content.ReadFromJsonAsync<OneCAdapterResponse>(cancellationToken: cancellationToken);
            return new(result?.Success ?? true, result?.Message ?? "Команда выполнена в 1С:ERP.", result?.ExternalReference);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException or UriFormatException)
        { return new(false, $"Ошибка обмена с 1С: {exception.Message}", null); }
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, int timeoutSeconds, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        return await clients.CreateClient("one-c").SendAsync(request, timeout.Token);
    }

    private void ApplyAuthentication(HttpRequestMessage request, StoredSettings stored)
    {
        if (string.IsNullOrWhiteSpace(stored.Username)) return;
        var password = string.IsNullOrEmpty(stored.ProtectedPassword) ? string.Empty : protector.Unprotect(stored.ProtectedPassword);
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{stored.Username}:{password}")));
    }

    private StoredSettings Read()
    {
        if (!File.Exists(storagePath)) return new(false, string.Empty, "/hs/process-navigator/health", "/hs/process-navigator/command", string.Empty, null, 15);
        return JsonSerializer.Deserialize<StoredSettings>(File.ReadAllText(storagePath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? new(false, string.Empty, "/hs/process-navigator/health", "/hs/process-navigator/command", string.Empty, null, 15);
    }

    private static OneCIntegrationSettingsModel Public(StoredSettings stored) => new(stored.Enabled, stored.BaseUrl, stored.HealthPath,
        stored.CommandPath, stored.Username, !string.IsNullOrEmpty(stored.ProtectedPassword), stored.TimeoutSeconds);
    private static string NormalizePath(string value) => "/" + value.Trim().TrimStart('/');
    private static void Validate(OneCIntegrationUpdateModel update)
    {
        if (update.TimeoutSeconds is < 1 or > 120) throw new InvalidDataException("Тайм-аут должен составлять от 1 до 120 секунд.");
        if (!update.Enabled && string.IsNullOrWhiteSpace(update.BaseUrl)) return;
        if (!Uri.TryCreate(update.BaseUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) throw new InvalidDataException("Укажите полный HTTP- или HTTPS-адрес сервера 1С.");
        if (string.IsNullOrWhiteSpace(update.HealthPath) || string.IsNullOrWhiteSpace(update.CommandPath)) throw new InvalidDataException("Укажите пути проверки и выполнения команд.");
    }

    private sealed record StoredSettings(bool Enabled, string BaseUrl, string HealthPath, string CommandPath,
        string Username, string? ProtectedPassword, int TimeoutSeconds);
    private sealed record OneCAdapterResponse(bool Success, string? Message, string? ExternalReference);
}
