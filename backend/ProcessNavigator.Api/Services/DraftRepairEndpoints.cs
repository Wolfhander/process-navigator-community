using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;
public static class DraftRepairEndpoints
{
    public static void MapDraftRepairs(this WebApplication app)
    {
        var group=app.MapGroup("/api/admin/draft-repairs").AddEndpointFilter(async(c,next)=>{
            c.HttpContext.Response.Headers["Cache-Control"]="no-store";
            var access=c.HttpContext.RequestServices.GetRequiredService<AccessControlService>();
            if(!access.Has(c.HttpContext,ProcessPermissions.ManageSystem))return Results.Problem("Нужно управление системой.",statusCode:403);
            try{return await next(c);}
            catch(Exception e)when(e is InvalidDataException or System.Text.Json.JsonException or System.Xml.XmlException){return Results.Problem(e.Message,statusCode:422);}
            catch(IOException){return Results.Problem("Хранилище недоступно. Проверьте результаты и резервные копии.",statusCode:503);}
        });
        group.MapGet("",(DraftRepairService s,CancellationToken ct)=>s.ScanAsync(ct));
        group.MapPost("/preview",(DraftRepairRequest r,DraftRepairService s,CancellationToken ct)=>s.PreviewAsync(r,ct));
        group.MapPost("/apply",(DraftRepairApply r,HttpContext c,DraftRepairService s,AccessControlService a,CancellationToken ct)=>s.ApplyAsync(r,a.CurrentUser(c).DisplayName,ct));
    }
}
