using System.Text.Json;
using System.Text;
using System.Xml;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.DataProtection;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
builder.Services.AddSingleton<BpmnProcessLoader>();
builder.Services.AddSingleton<ProcessCatalogService>();
builder.Services.AddSingleton<AccessControlService>();
builder.Services.AddSingleton<ArtifactRepositoryService>();
builder.Services.AddSingleton<InformationObjectRegistryService>();
builder.Services.AddSingleton<ProcessScheduleService>();
builder.Services.AddSingleton<ScheduleArchiveService>();
builder.Services.AddSingleton<InstanceSchedulePlanService>();
builder.Services.AddSingleton<ProcessAssignmentService>();
builder.Services.AddSingleton<ProcessExecutionService>();
builder.Services.AddSingleton<PortfolioAnalyticsService>();
builder.Services.AddSingleton<ProcessValidationService>();
builder.Services.AddSingleton<CatalogAuditService>();
builder.Services.AddSingleton<AuditLogService>();
builder.Services.AddSingleton<RepositoryBackupService>();
builder.Services.AddSingleton<ProcessEditLockService>();
builder.Services.AddSingleton<ProcessCommandService>();
builder.Services.AddSingleton<ProcessSearchService>();
builder.Services.AddSingleton<ProcessTableImportHistoryService>();
builder.Services.AddSingleton<ProcessTableSelectionSetService>();
builder.Services.AddSingleton<ProcessTableService>();
builder.Services.AddSingleton<ElementCommentService>();
builder.Services.AddSingleton<NotificationService>();
builder.Services.AddSingleton<OrganizationMapService>();
builder.Services.AddSingleton<DeploymentProfileService>();
var dataRoot = Path.Combine(builder.Environment.ContentRootPath, "Data");
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataRoot, "Keys")))
    .SetApplicationName("ProcessNavigator");
builder.Services.AddHttpClient("one-c", client => client.DefaultRequestHeaders.UserAgent.ParseAdd("ProcessNavigator/0.1"));
builder.Services.AddSingleton<OneCIntegrationService>();

var app = builder.Build();

var servesWebApplication = Directory.Exists(app.Environment.WebRootPath)
    && File.Exists(Path.Combine(app.Environment.WebRootPath, "index.html"));
if (servesWebApplication)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

app.Use(async (context, next) =>
{
    await next(context);
    if (context.Response.StatusCode >= 400) return;
    try
    {
        var audit = context.RequestServices.GetRequiredService<AuditLogService>();
        var access = context.RequestServices.GetRequiredService<AccessControlService>();
        await audit.RecordAsync(access.CurrentUser(context), context.Request.Method, context.Request.Path.Value ?? string.Empty, context.RequestAborted);
    }
    catch (Exception exception)
    {
        context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("AuditLog").LogError(exception, "Audit entry could not be persisted.");
    }
});

app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", service = "ProcessNavigator.Api" }));

app.MapGet("/api/deployment-profile", (HttpContext context, DeploymentProfileService deployment,
    AccessControlService access) =>
    access.Has(context, ProcessPermissions.View) ? Results.Ok(deployment.Get()) : Forbidden(ProcessPermissions.View));

app.MapGet("/api/analytics/portfolio", async (HttpContext context, PortfolioAnalyticsService analytics,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ViewAnalytics)) return Forbidden(ProcessPermissions.ViewAnalytics);
    return Results.Ok(await analytics.BuildAsync(cancellationToken));
});

app.MapGet("/api/admin/audit", async (int? limit, HttpContext context, AuditLogService audit,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    return Results.Ok(await audit.ListAsync(limit ?? 300, cancellationToken));
});

app.MapGet("/api/admin/audit/export", async (HttpContext context, AuditLogService audit, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    var entries = await audit.ListAsync(1000, cancellationToken);
    var csv = new StringBuilder("Дата;Пользователь;Действие;Тип объекта;Объект;Описание\r\n");
    static string Cell(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    foreach (var item in entries) csv.AppendLine(string.Join(';', Cell(item.OccurredAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")), Cell(item.UserName), Cell(item.Action), Cell(item.ObjectType), Cell(item.ObjectId), Cell(item.Description)));
    return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray(), "text/csv; charset=utf-8", $"process-navigator-audit-{DateTime.Now:yyyyMMdd-HHmm}.csv");
});

app.MapGet("/api/admin/backups", async (HttpContext context, RepositoryBackupService backups, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    return Results.Ok(await backups.ListAsync(cancellationToken));
});

app.MapPost("/api/admin/backups", async (HttpContext context, RepositoryBackupService backups, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    return Results.Ok(await backups.CreateAsync(access.CurrentUser(context).DisplayName, cancellationToken));
});

app.MapGet("/api/admin/backups/{fileName}/content", (string fileName, HttpContext context, RepositoryBackupService backups, AccessControlService access) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { var path = backups.GetPath(fileName); return Results.File(path, "application/zip", fileName, enableRangeProcessing: true); }
    catch (FileNotFoundException) { return Results.NotFound(); }
    catch (InvalidDataException exception) { return Results.BadRequest(new { message = exception.Message }); }
});

app.MapPost("/api/admin/backups/restore/preview", async (IFormFile package, HttpContext context, RepositoryBackupService backups, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    if (package.Length == 0 || package.Length > 2L * 1024 * 1024 * 1024) return Results.BadRequest(new { message = "Выберите ZIP-файл резервной копии размером до 2 ГБ." });
    try { await using var stream = package.OpenReadStream(); return Results.Ok(await backups.PreviewRestoreAsync(stream, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Backup validation failed"); }
}).DisableAntiforgery();

app.MapPost("/api/admin/backups/restore", async (IFormFile package, HttpContext context, RepositoryBackupService backups, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    if (package.Length == 0 || package.Length > 2L * 1024 * 1024 * 1024) return Results.BadRequest(new { message = "Выберите ZIP-файл резервной копии размером до 2 ГБ." });
    try { await using var stream = package.OpenReadStream(); return Results.Ok(await backups.RestoreAsync(stream, access.CurrentUser(context).DisplayName, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Backup validation failed"); }
}).DisableAntiforgery();

app.MapGet("/api/organization", async (HttpContext context, OrganizationMapService organization,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await organization.LoadAsync(cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Organization map validation failed"); }
});

app.MapPut("/api/admin/organization", async (OrganizationMapModel update, HttpContext context,
    OrganizationMapService organization, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await organization.SaveAsync(update, cancellationToken)); }
    catch (OrganizationConflictException exception) { return Results.Conflict(new { message = exception.Message }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Organization map validation failed"); }
});

app.MapPut("/api/admin/organization/process-directions", async (ProcessDirectionBulkUpdateModel update, HttpContext context,
    OrganizationMapService organization, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await organization.SaveProcessDirectionsAsync(update, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Process direction validation failed"); }
});

app.MapPut("/api/admin/processes/{processId}/lane-organizations", async (string processId, ProcessLaneOrganizationUpdateModel update,
    HttpContext context, OrganizationMapService organization, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await organization.SaveProcessLanesAsync(processId, update, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Процесс не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Lane organization validation failed"); }
});

app.MapPost("/api/admin/organization/sync-draft-lanes", async (HttpContext context,
    OrganizationMapService organization, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await organization.SyncDraftLaneNamesAsync(cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Draft lane synchronization failed"); }
});

app.MapGet("/api/session", (HttpContext context, AccessControlService access) => Results.Ok(access.Session(context)));

app.MapGet("/api/notifications", async (HttpContext context, NotificationService notifications,
    AccessControlService access, CancellationToken cancellationToken) =>
    Results.Ok(await notifications.ListAsync(access.CurrentUser(context).Id, cancellationToken)));

app.MapPut("/api/notifications/{notificationId}/read", async (string notificationId, HttpContext context,
    NotificationService notifications, AccessControlService access, CancellationToken cancellationToken) =>
{
    try { return Results.Ok(await notifications.MarkReadAsync(notificationId, access.CurrentUser(context).Id, cancellationToken)); }
    catch (KeyNotFoundException) { return Results.NotFound(); }
});

app.MapGet("/api/admin/integrations/one-c", (HttpContext context, OneCIntegrationService oneC, AccessControlService access) =>
    access.Has(context, ProcessPermissions.ManageSystem) ? Results.Ok(oneC.GetSettings()) : Forbidden(ProcessPermissions.ManageSystem));

app.MapPut("/api/admin/integrations/one-c", async (OneCIntegrationUpdateModel update, HttpContext context,
    OneCIntegrationService oneC, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await oneC.UpdateAsync(update, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "1C integration validation failed"); }
});

app.MapPost("/api/admin/integrations/one-c/test", async (HttpContext context, OneCIntegrationService oneC,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    return Results.Ok(await oneC.TestAsync(cancellationToken));
});

app.MapPut("/api/notifications/read-all", async (HttpContext context, NotificationService notifications,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    await notifications.MarkAllReadAsync(access.CurrentUser(context).Id, cancellationToken); return Results.NoContent();
});

app.MapGet("/api/search", async (string? q, HttpContext context, ProcessSearchService search,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await search.SearchAsync(q ?? string.Empty, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Search validation failed"); }
});

app.MapGet("/api/processes/{processId}/elements/{elementId}/comments", async (string processId, string elementId,
    HttpContext context, ElementCommentService comments, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    return Results.Ok(await comments.ListAsync(processId, elementId, cancellationToken));
});

app.MapPost("/api/processes/{processId}/elements/{elementId}/comments", async (string processId, string elementId,
    CreateElementCommentModel request, HttpContext context, ProcessCatalogService catalog, ElementCommentService comments,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await comments.AddAsync(await catalog.LoadAsync(processId, false, cancellationToken), elementId,
        access.CurrentUser(context), request.Text, access.Users(), cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Элемент процесса не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Comment validation failed"); }
});

app.MapGet("/api/admin/users", (HttpContext context, AccessControlService access) =>
    access.Has(context, ProcessPermissions.ManageUsers) ? Results.Ok(access.Directory()) : Forbidden(ProcessPermissions.ManageUsers));

app.MapPut("/api/admin/users/{userId}", async (string userId, UserUpdateModel update, HttpContext context,
    AccessControlService access, OrganizationMapService organization, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageUsers)) return Forbidden(ProcessPermissions.ManageUsers);
    try
    {
        if (update.LegalEntityId is not null || update.UnitId is not null)
        {
            var map = await organization.LoadAsync(cancellationToken);
            var entity = map.LegalEntities.FirstOrDefault(item => item.Id.Equals(update.LegalEntityId, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidDataException("Выбранное юридическое лицо не найдено.");
            if (update.UnitId is not null && !(entity.Units ?? []).Any(item => item.Id.Equals(update.UnitId, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Выбранное подразделение не принадлежит юридическому лицу.");
        }
        return Results.Ok(await access.UpdateAsync(userId, update, access.CurrentUser(context).Id, cancellationToken));
    }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = $"Пользователь '{userId}' не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "User validation failed"); }
});

app.MapGet("/api/artifacts", async (HttpContext context, ArtifactRepositoryService artifacts, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    return Results.Ok(await artifacts.ListAsync(cancellationToken));
});

app.MapGet("/api/information-objects", async (HttpContext context, InformationObjectRegistryService registry,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    var includeDrafts = access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram);
    return Results.Ok(await registry.BuildAsync(includeDrafts, cancellationToken));
});

app.MapPut("/api/information-objects/{objectId}", async (string objectId, InformationObjectUpdateModel update,
    HttpContext context, InformationObjectRegistryService registry, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.EditContext)) return Forbidden(ProcessPermissions.EditContext);
    try
    {
        var includeDrafts = access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram);
        return Results.Ok(await registry.SaveAsync(objectId, update, includeDrafts, cancellationToken));
    }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Information object validation failed"); }
});

app.MapGet("/api/processes/schedule", async (string rootProcessId, string direction, DateTimeOffset anchorDate, bool? includeWaitTime,
    string? workdayStart, string? workdayEnd, string? workingDays, double? durationScalePercent, double? transferDelayHours,
    string? nonWorkingDates, string? processDurationScalePercent, string? checkpoints, HttpContext context,
    ProcessScheduleService schedule, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try
    {
        var includeDrafts = access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram);
        var days = string.IsNullOrWhiteSpace(workingDays) ? null : workingDays.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(value => int.TryParse(value, out var day) ? day : -1).ToArray();
        var dates = string.IsNullOrWhiteSpace(nonWorkingDates) ? null : nonWorkingDates.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var scales = ParseQueryMap(processDurationScalePercent, value => double.Parse(value, System.Globalization.CultureInfo.InvariantCulture));
        var controlDates = ParseQueryMap(checkpoints, value => DateTimeOffset.Parse(value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind));
        return Results.Ok(await schedule.CalculateAsync(new(rootProcessId, direction, anchorDate, includeWaitTime ?? true,
            workdayStart ?? "09:00", workdayEnd ?? "17:00", days, durationScalePercent ?? 100, transferDelayHours ?? 0,
            dates, scales, controlDates), includeDrafts, cancellationToken));
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Процесс не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Schedule validation failed"); }
});

app.MapGet("/api/processes/schedule/archive", async (HttpContext context, ScheduleArchiveService archive,
    AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await archive.ListAsync(access.CurrentUser(context).Id,
        access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram), ct)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});
app.MapGet("/api/processes/schedule/archive/{id}", async (string id, HttpContext context, ScheduleArchiveService archive,
    AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await archive.LoadAsync(access.CurrentUser(context).Id, id,
        access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram), ct)); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Архивный расчёт не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});
app.MapGet("/api/processes/schedule/archive/{id}/check", async (string id, HttpContext context, ScheduleArchiveService archive,
    AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await archive.CheckAsync(access.CurrentUser(context).Id, id,
        access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram), ct)); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Архивный расчёт не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});

app.MapPost("/api/processes/schedule/archive", async (ScheduleArchiveSaveModel request, HttpContext context,
    ScheduleArchiveService archive, AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await archive.SaveAsync(access.CurrentUser(context).Id, request,
        access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram), ct)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Исходный процесс не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});
app.MapDelete("/api/processes/schedule/archive/{id}", async (string id, HttpContext context, ScheduleArchiveService archive,
    AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return await archive.DeleteAsync(access.CurrentUser(context).Id, id,
        access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram), ct)
        ? Results.NoContent() : Results.NotFound(new { message = "Архивный расчёт не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});

app.MapPost("/api/processes/schedule", async (ProcessScheduleRequestModel request, HttpContext context,
    ProcessScheduleService schedule, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try
    {
        var includeDrafts = access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram);
        return Results.Ok(await schedule.CalculateAsync(request, includeDrafts, cancellationToken));
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Процесс не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Schedule validation failed"); }
});

app.MapGet("/api/processes/{processId}/assignments", async (string processId, HttpContext context, ProcessCatalogService catalog,
    ProcessAssignmentService assignments, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await assignments.LoadAsync(await catalog.LoadAsync(processId, false, cancellationToken), access.Users(), cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
});

app.MapGet("/api/processes/{processId}/instances", async (string processId, HttpContext context, ProcessExecutionService executions,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    return Results.Ok(await executions.ListAsync(processId, cancellationToken));
});

app.MapGet("/api/processes/{processId}/instances/{instanceId}/schedule-plans", async (string processId, string instanceId,
    HttpContext context, InstanceSchedulePlanService plans, AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await plans.ListAsync(processId, instanceId, ct)); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Выполнение не найдено." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});

app.MapGet("/api/processes/{processId}/instances/{instanceId}/schedule-plans/check", async (string processId, string instanceId,
    HttpContext context, InstanceSchedulePlanService plans, AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.Ok(await plans.CheckAsync(processId, instanceId, ct)); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Выполнение не найдено." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});

app.MapPost("/api/processes/{processId}/instances/{instanceId}/schedule-plans", async (string processId, string instanceId,
    InstanceSchedulePlanUpdateModel request, HttpContext context, InstanceSchedulePlanService plans,
    AccessControlService access, CancellationToken ct) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try { return Results.Ok(await plans.AssignAsync(processId, instanceId, request, access.CurrentUser(context).Id, ct)); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Выполнение не найдено." }); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Процесс расчёта не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422); }
});

app.MapGet("/api/processes/{processId}/instances/{instanceId}/timeline", async (string processId, string instanceId,
    HttpContext context, ProcessCatalogService catalog, ProcessExecutionService executions, ProcessCommandService commands,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try
    {
        var process = await catalog.LoadAsync(processId, false, cancellationToken);
        var actions = await commands.ListInstanceAsync(processId, instanceId, cancellationToken);
        return Results.Ok(await executions.TimelineAsync(process, instanceId, actions, cancellationToken));
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Экземпляр процесса не найден." }); }
});

app.MapGet("/api/processes/{processId}/analytics", async (string processId, HttpContext context, ProcessCatalogService catalog,
    ProcessExecutionService executions, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ViewAnalytics)) return Forbidden(ProcessPermissions.ViewAnalytics);
    try { return Results.Ok(await executions.AnalyticsAsync(await catalog.LoadAsync(processId, false, cancellationToken), cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
});

app.MapGet("/api/processes/{processId}/elements/{elementId}/commands", async (string processId, string elementId,
    HttpContext context, ProcessCommandService commands, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    return Results.Ok(await commands.ListAsync(processId, elementId, cancellationToken));
});

app.MapPost("/api/processes/{processId}/elements/{elementId}/actions/{actionId}/execute", async (string processId,
    string elementId, string actionId, ExecuteCommandRequestModel request, HttpContext context, ProcessCatalogService catalog,
    ProcessCommandService commands, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try { return Results.Ok(await commands.ExecuteAsync(await catalog.LoadAsync(processId, false, cancellationToken), elementId,
        actionId, request.InstanceId, request.Result, access.CurrentUser(context).Id, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Элемент или команда процесса не найдены." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Command validation failed"); }
});

app.MapPost("/api/processes/{processId}/instances", async (string processId, StartProcessInstanceModel request, HttpContext context,
    ProcessCatalogService catalog, ProcessExecutionService executions, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try { return Results.Ok(await executions.StartAsync(await catalog.LoadAsync(processId, false, cancellationToken), access.CurrentUser(context).Id, request.Name, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
});

app.MapPut("/api/processes/{processId}/instances/{instanceId}/steps/{elementId}", async (string processId, string instanceId,
    string elementId, StepStatusUpdateModel request, HttpContext context, ProcessCatalogService catalog,
    ProcessExecutionService executions, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try { return Results.Ok(await executions.UpdateStepAsync(await catalog.LoadAsync(processId, false, cancellationToken), instanceId, elementId, request.Status, access.CurrentUser(context).Id, cancellationToken)); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Экземпляр или шаг процесса не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Execution validation failed"); }
});

app.MapPut("/api/processes/{processId}/instances/{instanceId}/steps/{elementId}/assignment", async (string processId,
    string instanceId, string elementId, StepAssignmentUpdateModel request, HttpContext context, ProcessCatalogService catalog,
    ProcessExecutionService executions, ProcessAssignmentService assignmentService, AccessControlService access,
    CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try
    {
        var process = await catalog.LoadAsync(processId, false, cancellationToken);
        var assignments = await assignmentService.LoadAsync(process, access.Users(), cancellationToken);
        return Results.Ok(await executions.AssignStepAsync(process, instanceId, elementId, request.UserId, request.Reason,
            access.CurrentUser(context).Id, assignments, cancellationToken));
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Экземпляр или шаг процесса не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Step assignment validation failed"); }
});

app.MapPost("/api/processes/{processId}/instances/{instanceId}/steps/{elementId}/return", async (string processId, string instanceId,
    string elementId, ReturnStepModel request, HttpContext context, ProcessCatalogService catalog,
    ProcessExecutionService executions, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try { return Results.Ok(await executions.ReturnStepAsync(await catalog.LoadAsync(processId, false, cancellationToken), instanceId,
        elementId, request.TargetElementId, request.Reason, access.CurrentUser(context).Id, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Экземпляр или шаг процесса не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Execution return validation failed"); }
});

app.MapPost("/api/processes/{processId}/instances/{instanceId}/lifecycle", async (string processId, string instanceId,
    ProcessLifecycleUpdateModel request, HttpContext context, ProcessExecutionService executions, AccessControlService access,
    CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try { return Results.Ok(await executions.ChangeLifecycleAsync(processId, instanceId, request.Action, request.Reason,
        access.CurrentUser(context).Id, cancellationToken)); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Экземпляр процесса не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Execution lifecycle validation failed"); }
});

app.MapPut("/api/processes/{processId}/instances/{instanceId}/steps/{elementId}/result", async (string processId,
    string instanceId, string elementId, StepResultUpdateModel request, HttpContext context, ProcessCatalogService catalog,
    ProcessExecutionService executions, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try { return Results.Ok(await executions.SaveStepResultAsync(await catalog.LoadAsync(processId, false, cancellationToken),
        instanceId, elementId, request.ResultText, request.ObjectIds, access.CurrentUser(context).Id, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Экземпляр или шаг процесса не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Step result validation failed"); }
});

app.MapPost("/api/processes/{processId}/instances/{instanceId}/steps/{elementId}/attachments", async (string processId,
    string instanceId, string elementId, IFormFile file, [FromForm] string? name, HttpContext context,
    ProcessCatalogService catalog, ProcessExecutionService executions, ArtifactRepositoryService artifacts,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Execute)) return Forbidden(ProcessPermissions.Execute);
    try
    {
        var process = await catalog.LoadAsync(processId, false, cancellationToken);
        await executions.ValidateStepAttachmentAsync(process, instanceId, elementId, cancellationToken);
        var node = process.Nodes.First(item => item.Id == elementId);
        var artifactName = string.IsNullOrWhiteSpace(name) ? Path.GetFileName(file.FileName) : name.Trim();
        var repositoryName = $"{process.Name} · {node.Name} · {artifactName}";
        if (repositoryName.Length > 200) repositoryName = repositoryName[..200];
        var version = $"{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}"[..24];
        var uploaded = await artifacts.UploadAsync(file, repositoryName,
            "Результат выполнения", version, null, cancellationToken);
        return Results.Ok(await executions.AddStepAttachmentAsync(process, instanceId, elementId, uploaded, file.FileName,
            file.Length, access.CurrentUser(context).Id, cancellationToken));
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = "Экземпляр или шаг процесса не найден." }); }
    catch (ArtifactConflictException exception) { return Results.Conflict(new { message = exception.Message }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Step attachment validation failed"); }
}).DisableAntiforgery();

app.MapPut("/api/processes/{processId}/assignments", async (string processId, ProcessAssignmentsUpdateModel update, HttpContext context,
    ProcessCatalogService catalog, ProcessAssignmentService assignments, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageAssignments)) return Forbidden(ProcessPermissions.ManageAssignments);
    try { return Results.Ok(await assignments.SaveAsync(await catalog.LoadAsync(processId, false, cancellationToken), update, access.Users(), cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Assignment validation failed"); }
});

app.MapPost("/api/artifacts", async (IFormFile file, [FromForm] string name, [FromForm] string kind,
    [FromForm] string version, [FromForm] string? artifactId,
    HttpContext context, ArtifactRepositoryService artifacts, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.EditContext)) return Forbidden(ProcessPermissions.EditContext);
    try { return Results.Ok(await artifacts.UploadAsync(file, name, kind, version, artifactId, cancellationToken)); }
    catch (ArtifactConflictException exception) { return Results.Conflict(new { message = exception.Message }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Artifact validation failed"); }
}).DisableAntiforgery();

app.MapMethods("/api/artifacts/{artifactId}/content", ["GET", "HEAD"], async (string artifactId, string? version, HttpContext context,
    ArtifactRepositoryService artifacts, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try
    {
        var file = await artifacts.ResolveAsync(artifactId, version, cancellationToken);
        return Results.File(file.Path, file.ContentType, file.FileName, enableRangeProcessing: true);
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Artifact '{artifactId}' was not found." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Artifact validation failed"); }
});

app.MapGet("/api/processes", async (ProcessCatalogService catalog, CancellationToken cancellationToken) =>
    Results.Ok(await catalog.ListAsync(cancellationToken)));

app.MapGet("/api/processes/audit", async (HttpContext context, CatalogAuditService audit, AccessControlService access,
    CancellationToken cancellationToken) =>
{
    if (!CanOpenDraft(context, access)) return Forbidden("process.draft.view");
    try { return Results.Ok(await audit.RunAsync(cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Catalog audit failed"); }
});

app.MapGet("/api/processes/audit/export", async (HttpContext context, CatalogAuditService audit, AccessControlService access,
    CancellationToken cancellationToken) =>
{
    if (!CanOpenDraft(context, access)) return Forbidden("process.draft.view");
    try
    {
        var report = await audit.RunAsync(cancellationToken);
        static string Cell(string? value) => $"\"{(value ?? string.Empty).Replace("\"", "\"\"")}\"";
        var csv = new StringBuilder("Процесс ID;Процесс;Редакция;Версия;Статус качества;Категория;Уровень;Код;Элемент ID;Элемент;Замечание\r\n");
        foreach (var item in report.Items)
        {
            if (item.Issues.Count == 0)
                csv.AppendLine(string.Join(';', Cell(item.ProcessId), Cell(item.ProcessName), Cell(item.Edition), Cell(item.Version),
                    Cell(item.QualityStatus), Cell(null), Cell(null), Cell(null), Cell(null), Cell(null), Cell(null)));
            foreach (var issue in item.Issues)
            {
                var category = report.Categories.FirstOrDefault(entry => entry.Id.Equals(issue.Category, StringComparison.OrdinalIgnoreCase))?.Name ?? issue.Category;
                csv.AppendLine(string.Join(';', Cell(item.ProcessId), Cell(item.ProcessName), Cell(item.Edition), Cell(item.Version),
                    Cell(item.QualityStatus), Cell(category), Cell(issue.Severity), Cell(issue.Code), Cell(issue.ElementId),
                    Cell(issue.ElementName), Cell(issue.Message)));
            }
        }
        return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray(),
            "text/csv; charset=utf-8", $"process-catalog-check-{DateTime.Now:yyyyMMdd-HHmm}.csv");
    }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Catalog audit export failed"); }
});

app.MapDelete("/api/processes/{processId}", async (string processId, HttpContext context,
    ProcessCatalogService catalog, OrganizationMapService organization, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try
    {
        await catalog.DeleteAsync(processId, cancellationToken);
        await organization.RemoveProcessAsync(processId, cancellationToken);
        return Results.NoContent();
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
});

app.MapGet("/api/processes/hierarchy", async (HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    return Results.Ok(await catalog.HierarchyAsync(cancellationToken));
});

app.MapGet("/api/processes/decomposition", async (HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    var includeDrafts = access.Has(context, ProcessPermissions.EditContext) || access.Has(context, ProcessPermissions.EditDiagram);
    return Results.Ok(await catalog.DecompositionAsync(includeDrafts, cancellationToken));
});

app.MapPut("/api/processes/{processId}/draft/hierarchy", async (string processId, ProcessHierarchyUpdateModel update, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await catalog.SaveDraftHierarchyAsync(processId, update, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Процесс не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Hierarchy validation failed"); }
});

app.MapPut("/api/processes/hierarchy/bulk", async (ProcessHierarchyBulkUpdateModel update, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await catalog.SaveDraftHierarchyBulkAsync(update, cancellationToken)); }
    catch (FileNotFoundException exception) { return Results.NotFound(new { message = exception.Message }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Bulk hierarchy validation failed"); }
});

app.MapGet("/api/processes/{processId}", async (string processId, bool? draft, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (draft == true && !CanOpenDraft(context, access)) return Forbidden("process.draft.view");
    try
    {
        return Results.Ok(await catalog.LoadAsync(processId, draft == true, cancellationToken));
    }
    catch (FileNotFoundException)
    {
        return Results.NotFound(new { message = $"Process '{processId}' was not found." });
    }
    catch (InvalidDataException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status422UnprocessableEntity,
            title: "BPMN validation failed");
    }
});

app.MapGet("/api/processes/{processId}/versions", async (string processId, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    try
    {
        var versions = await catalog.VersionsAsync(processId, cancellationToken);
        return Results.Ok(CanOpenDraft(context, access) ? versions : versions.Where(version => version.Status != "Draft"));
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
});

app.MapGet("/api/processes/{processId}/versions/{version}", async (string processId, string version, ProcessCatalogService catalog, CancellationToken cancellationToken) =>
{
    try { return Results.Ok(await catalog.LoadArchivedAsync(processId, version, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Archived version '{version}' was not found." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Archived BPMN validation failed"); }
});

app.MapPost("/api/processes/{processId}/draft", async (string processId, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.CreateDraft)) return Forbidden(ProcessNavigator.Api.Models.ProcessPermissions.CreateDraft);
    try { return Results.Ok(await catalog.CreateDraftAsync(processId, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Process '{processId}' was not found." }); }
    catch (ProcessConflictException exception) { return Results.Conflict(new { message = exception.Message }); }
});

app.MapPut("/api/processes/{processId}/draft", async (
    string processId, IFormFile bpmnFile, IFormFile? contextFile, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.EditDiagram)) return Forbidden(ProcessNavigator.Api.Models.ProcessPermissions.EditDiagram);
    try { return Results.Ok(await catalog.ReplaceDraftAsync(processId, bpmnFile, contextFile, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Draft for process '{processId}' was not found." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Draft validation failed"); }
    catch (IOException exception) { return Results.Conflict(new { message = exception.Message }); }
}).DisableAntiforgery();

app.MapGet("/api/processes/{processId}/draft/validation", async (string processId, HttpContext context, ProcessValidationService validation, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!CanOpenDraft(context, access)) return Forbidden("process.draft.view");
    try { return Results.Ok(await validation.ValidateDraftAsync(processId, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Draft for process '{processId}' was not found." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Draft validation failed"); }
});

app.MapGet("/api/processes/{processId}/draft/workflow", async (string processId, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!CanOpenDraft(context, access)) return Forbidden("process.draft.view");
    try { return Results.Ok(await catalog.WorkflowAsync(processId, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Черновик не найден." }); }
});

app.MapPost("/api/processes/{processId}/draft/workflow/{action}", async (string processId, string action, ProcessWorkflowActionModel request, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    var approvalAction = action.Equals("approve", StringComparison.OrdinalIgnoreCase) || action.Equals("reject", StringComparison.OrdinalIgnoreCase);
    if (approvalAction ? !access.Has(context, ProcessPermissions.Publish) : !CanOpenDraft(context, access)) return Forbidden(approvalAction ? ProcessPermissions.Publish : "process.draft.view");
    try { return Results.Ok(await catalog.TransitionWorkflowAsync(processId, action, request, access.CurrentUser(context), cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Черновик не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Workflow transition failed"); }
});

app.MapPut("/api/processes/{processId}/draft/workflow/route", async (string processId, ProcessWorkflowRouteUpdateModel request, HttpContext context, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.EditDiagram) && !access.Has(context, ProcessPermissions.EditContext)) return Forbidden(ProcessPermissions.EditContext);
    try { return Results.Ok(await catalog.ConfigureWorkflowAsync(processId, request, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Черновик не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Workflow configuration failed"); }
});

app.MapPost("/api/processes/{processId}/publish", async (string processId, HttpContext context, ProcessCatalogService catalog, ProcessValidationService validation, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.Publish)) return Forbidden(ProcessNavigator.Api.Models.ProcessPermissions.Publish);
    try
    {
        var report = await validation.ValidateDraftAsync(processId, cancellationToken);
        if (!report.CanPublish) return Results.Json(report, statusCode: StatusCodes.Status422UnprocessableEntity);
        return Results.Ok(await catalog.PublishDraftAsync(processId, cancellationToken));
    }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Draft for process '{processId}' was not found." }); }
    catch (IOException exception) { return Results.Conflict(new { message = exception.Message }); }
});

app.MapGet("/api/processes/{processId}/bpmn", (string processId, BpmnProcessLoader loader) =>
{
    var path = loader.GetBpmnPath(processId);
    if (!File.Exists(path))
        return Results.NotFound(new { message = $"Process '{processId}' was not found." });
    return Results.File(path, "application/xml; charset=utf-8", enableRangeProcessing: true);
});

app.MapGet("/api/processes/{processId}/draft/bpmn", (string processId, HttpContext context, ProcessCatalogService catalog, AccessControlService access) =>
{
    if (!CanOpenDraft(context, access)) return Forbidden("process.draft.view");
    var path = catalog.GetBpmnSourcePath(processId, draft: true);
    return File.Exists(path)
        ? Results.File(path, "application/xml; charset=utf-8", enableRangeProcessing: true)
        : Results.NotFound(new { message = $"Draft for process '{processId}' was not found." });
});

app.MapPost("/api/processes/{processId}/draft/lock", async (string processId, HttpContext context, ProcessEditLockService locks, ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.EditDiagram)) return Forbidden(ProcessPermissions.EditDiagram);
    try { await catalog.EnsureDraftEditableAsync(processId, cancellationToken); return Results.Ok(locks.Acquire(processId, access.CurrentUser(context))); }
    catch (ProcessEditLockedException exception) { return Results.Conflict(new { message = exception.Message, lockedBy = exception.Current.UserName, expiresAt = exception.Current.ExpiresAt }); }
    catch (IOException exception) { return Results.Conflict(new { message = exception.Message }); }
});

app.MapPut("/api/processes/{processId}/draft/lock", (string processId, EditLockRequestModel request, HttpContext context, ProcessEditLockService locks, AccessControlService access) =>
{
    if (!access.Has(context, ProcessPermissions.EditDiagram)) return Forbidden(ProcessPermissions.EditDiagram);
    try { return Results.Ok(locks.Renew(processId, request.Token ?? string.Empty, access.CurrentUser(context))); }
    catch (ProcessEditLockLostException exception) { return Results.Conflict(new { message = exception.Message }); }
});

app.MapDelete("/api/processes/{processId}/draft/lock", (string processId, string? token, HttpContext context, ProcessEditLockService locks, AccessControlService access) =>
{
    locks.Release(processId, token, access.CurrentUser(context)); return Results.NoContent();
});

app.MapPut("/api/processes/{processId}/draft/bpmn", async (string processId, HttpContext context, ProcessCatalogService catalog, ProcessEditLockService locks, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.EditDiagram)) return Forbidden(ProcessNavigator.Api.Models.ProcessPermissions.EditDiagram);
    var editToken = context.Request.Headers["X-Process-Navigator-Edit-Lock"].FirstOrDefault();
    if (editToken is not null && !locks.IsValid(processId, editToken, access.CurrentUser(context))) return Results.Conflict(new { message = "Блокировка редактирования истекла. Откройте редактор повторно." });
    using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
    var xml = await reader.ReadToEndAsync(cancellationToken);
    try { return Results.Ok(await catalog.SaveDraftXmlAsync(processId, xml, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Draft for process '{processId}' was not found." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "BPMN validation failed"); }
    catch (IOException exception) { return Results.Conflict(new { message = exception.Message }); }
});

app.MapPut("/api/processes/{processId}/draft/elements/{elementId}/context", async (
    string processId, string elementId, ElementContextUpdateModel update, HttpContext context,
    ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.EditContext)) return Forbidden(ProcessPermissions.EditContext);
    try { return Results.Ok(await catalog.SaveDraftElementContextAsync(processId, elementId, update, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Draft for process '{processId}' was not found." }); }
    catch (KeyNotFoundException) { return Results.NotFound(new { message = $"BPMN element '{elementId}' was not found in the draft." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Context validation failed"); }
    catch (IOException exception) { return Results.Conflict(new { message = exception.Message }); }
});

app.MapPut("/api/processes/{processId}/draft/properties", async (
    string processId, ProcessPropertiesUpdateModel update, HttpContext context,
    ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.EditContext)) return Forbidden(ProcessPermissions.EditContext);
    try { return Results.Ok(await catalog.SaveDraftPropertiesAsync(processId, update, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = $"Draft for process '{processId}' was not found." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Process properties validation failed"); }
    catch (IOException exception) { return Results.Conflict(new { message = exception.Message }); }
});

app.MapPost("/api/processes/import", async (
    IFormFile bpmnFile,
    IFormFile? contextFile,
    HttpContext context,
    ProcessCatalogService catalog,
    AccessControlService access,
    CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.Import)) return Forbidden(ProcessNavigator.Api.Models.ProcessPermissions.Import);
    try
    {
        var result = await catalog.ImportAsync(bpmnFile, contextFile, cancellationToken);
        return Results.Created($"/api/processes/{result.Process.Id}", result);
    }
    catch (ProcessConflictException exception)
    {
        return Results.Conflict(new { message = exception.Message });
    }
    catch (InvalidDataException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status422UnprocessableEntity,
            title: "BPMN import validation failed");
    }
}).DisableAntiforgery();

app.MapGet("/api/processes/table-template", async (HttpContext context, ProcessTableService tables, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try { return Results.File(await tables.TemplateAsync(cancellationToken), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Process-Navigator-process-table.xlsx"); }
    catch (FileNotFoundException exception) { return Results.NotFound(new { message = exception.Message }); }
});

app.MapGet("/api/processes/{processId}/table-export", async (string processId, bool? includeDescendants,
    HttpContext context, ProcessTableService tables, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.View)) return Forbidden(ProcessPermissions.View);
    try
    {
        var export = await tables.ExportAsync(processId, includeDescendants != false,
            CanOpenDraft(context, access), cancellationToken);
        return Results.File(export.Content,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", export.FileName);
    }
    catch (FileNotFoundException exception) { return Results.NotFound(new { message = exception.Message }); }
    catch (InvalidDataException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status422UnprocessableEntity,
            title: "Process table export failed");
    }
});

app.MapPost("/api/processes/table-preview", async (IFormFile tableFile, HttpContext context,
    ProcessTableService tables, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return Results.Ok(await tables.PreviewAsync(tableFile, cancellationToken)); }
    catch (InvalidDataException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status422UnprocessableEntity,
            title: "Process table validation failed");
    }
    catch (XmlException exception)
    {
        return Results.Problem($"Книга содержит повреждённый XML: {exception.Message}",
            statusCode: StatusCodes.Status422UnprocessableEntity, title: "Process table validation failed");
    }
}).DisableAntiforgery();

app.MapPost("/api/processes/table-import", async (IFormFile tableFile, HttpContext context,
    ProcessTableService tables, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import) || !access.Has(context, ProcessPermissions.CreateDraft))
        return Forbidden(ProcessPermissions.Import);
    try
    {
        var form = await context.Request.ReadFormAsync(cancellationToken);
        var selectionSupplied = form.ContainsKey("selectedProcessIds");
        var selectedProcessIds = form["selectedProcessIds"].FirstOrDefault();
        var selected = !selectionSupplied
            ? null
            : (selectedProcessIds ?? string.Empty).Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var confirmedRemovalIds = form["confirmedRemovalProcessIds"].FirstOrDefault();
        var confirmedRemovals = (confirmedRemovalIds ?? string.Empty).Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        ProcessTableStepIdMappingModel[] mappings;
        try
        {
            mappings = JsonSerializer.Deserialize<ProcessTableStepIdMappingModel[]>(form["stepIdMappings"].FirstOrDefault() ?? "[]",
                new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
        }
        catch (JsonException)
        {
            throw new InvalidDataException("Не удалось прочитать сопоставления идентификаторов шагов.");
        }
        return Results.Ok(await tables.ApplyAsync(tableFile, access.CurrentUser(context).DisplayName, selected, confirmedRemovals, mappings, cancellationToken));
    }
    catch (InvalidDataException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status422UnprocessableEntity,
            title: "Process table import failed");
    }
    catch (XmlException exception)
    {
        return Results.Problem($"Книга содержит повреждённый XML: {exception.Message}",
            statusCode: StatusCodes.Status422UnprocessableEntity, title: "Process table import failed");
    }
    catch (IOException exception) { return Results.Conflict(new { message = exception.Message }); }
}).DisableAntiforgery();

app.MapGet("/api/processes/table-import-reports/{fileName}", (string fileName, HttpContext context,
    ProcessTableService tables, AccessControlService access) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return Results.File(tables.ResolveImportReportPath(fileName), "text/csv; charset=utf-8", fileName); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Протокол импорта не найден." }); }
    catch (InvalidDataException exception) { return Results.BadRequest(new { message = exception.Message }); }
});

app.MapGet("/api/processes/table-import-history", async (int? limit, HttpContext context,
    ProcessTableImportHistoryService history, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return Results.Ok(await history.ListAsync(limit ?? 200, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Import history validation failed"); }
});

app.MapGet("/api/processes/table-import-history/{id}/report", async (string id, HttpContext context,
    ProcessTableImportHistoryService history, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return Results.Ok(await history.LoadReportAsync(id, cancellationToken)); }
    catch (FileNotFoundException) { return Results.NotFound(new { message = "Протокол импорта не найден." }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Import report validation failed"); }
});

app.MapDelete("/api/processes/table-import-history/{id}", async (string id, HttpContext context,
    ProcessTableImportHistoryService history, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return await history.DeleteAsync(id, cancellationToken) ? Results.NoContent() : Results.NotFound(); }
    catch (InvalidDataException exception) { return Results.BadRequest(new { message = exception.Message }); }
});

app.MapGet("/api/admin/table-import-retention", async (HttpContext context, ProcessTableImportHistoryService history,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await history.GetRetentionPolicyAsync(cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Retention policy validation failed"); }
});

app.MapPut("/api/admin/table-import-retention", async (ProcessTableImportRetentionPolicyModel policy, HttpContext context,
    ProcessTableImportHistoryService history, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await history.SaveRetentionPolicyAsync(policy, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Retention policy validation failed"); }
});

app.MapPost("/api/admin/table-import-retention/cleanup", async (HttpContext context, ProcessTableImportHistoryService history,
    AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.ManageSystem)) return Forbidden(ProcessPermissions.ManageSystem);
    try { return Results.Ok(await history.CleanupAsync(cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Retention cleanup validation failed"); }
});

app.MapGet("/api/processes/table-selection-sets", async (HttpContext context,
    ProcessTableSelectionSetService selectionSets, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    return Results.Ok(await selectionSets.ListAsync(access.CurrentUser(context).Id, cancellationToken));
});

app.MapPost("/api/processes/table-selection-sets", async (ProcessTableSelectionSetUpdateModel update, HttpContext context,
    ProcessTableSelectionSetService selectionSets, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return Results.Ok(await selectionSets.SaveAsync(access.CurrentUser(context).Id, update, cancellationToken)); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Selection set validation failed"); }
});

app.MapDelete("/api/processes/table-selection-sets/{id}", async (string id, HttpContext context,
    ProcessTableSelectionSetService selectionSets, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return await selectionSets.DeleteAsync(access.CurrentUser(context).Id, id, cancellationToken) ? Results.NoContent() : Results.NotFound(); }
    catch (InvalidDataException exception) { return Results.BadRequest(new { message = exception.Message }); }
});

app.MapPost("/api/processes/import-package", async (
    IFormFile packageFile,
    HttpContext context,
    ProcessCatalogService catalog,
    AccessControlService access,
    CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return Results.Ok(await catalog.ImportPackageAsync(packageFile, cancellationToken)); }
    catch (InvalidDataException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status422UnprocessableEntity,
            title: "Process package import failed");
    }
}).DisableAntiforgery();

app.MapPost("/api/processes", async (CreateProcessModel request, HttpContext context,
    ProcessCatalogService catalog, AccessControlService access, CancellationToken cancellationToken) =>
{
    if (!access.Has(context, ProcessPermissions.Import)) return Forbidden(ProcessPermissions.Import);
    try { return Results.Created($"/api/processes/{request.Id}", await catalog.CreateAsync(request, cancellationToken)); }
    catch (ProcessConflictException exception) { return Results.Conflict(new { message = exception.Message }); }
    catch (InvalidDataException exception) { return Results.Problem(exception.Message, statusCode: 422, title: "Process creation failed"); }
});

if (servesWebApplication)
    app.MapFallbackToFile("index.html");
app.Run();

static IReadOnlyDictionary<string, T>? ParseQueryMap<T>(string? value, Func<string, T> parseValue)
{
    if (string.IsNullOrWhiteSpace(value)) return null;
    var result = new Dictionary<string, T>(StringComparer.OrdinalIgnoreCase);
    var entries = value.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    if (entries.Length > 200) throw new InvalidDataException("В одном сценарии допускается не более 200 индивидуальных параметров.");
    foreach (var entry in entries)
    {
        var separator = entry.IndexOf('=');
        if (separator <= 0 || separator == entry.Length - 1) throw new InvalidDataException("Проверьте индивидуальные параметры сценария.");
        var key = entry[..separator].Trim();
        try { result[key] = parseValue(entry[(separator + 1)..].Trim()); }
        catch (Exception exception) when (exception is FormatException or OverflowException)
        {
            throw new InvalidDataException($"Проверьте значение индивидуального параметра для процесса «{key}».", exception);
        }
    }
    return result;
}

static IResult Forbidden(string permission) => Results.Json(new
{
    message = "У текущего пользователя нет прав для выполнения этой операции.",
    requiredPermission = permission
}, statusCode: StatusCodes.Status403Forbidden);

static bool CanOpenDraft(HttpContext context, AccessControlService access) =>
    access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.EditDiagram) ||
    access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.EditContext) ||
    access.Has(context, ProcessNavigator.Api.Models.ProcessPermissions.Publish);
