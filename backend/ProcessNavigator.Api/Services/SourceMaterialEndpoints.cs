using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

public static class SourceMaterialEndpoints
{
    public static void MapSourceMaterials(this WebApplication app,Func<HttpContext,AccessControlService,bool> canOpenDraft)
    {
        var routes=app.MapGroup("/api/source-materials").AddEndpointFilter(async(context,next)=>
        {
            context.HttpContext.Response.Headers["Cache-Control"]="no-store";
            context.HttpContext.Response.Headers["Vary"]="X-Process-Navigator-User";
            return await next(context);
        });
        static IResult Denied()=>Results.Problem("У текущего пользователя нет прав для этой операции.",statusCode:403);
        static async Task<IResult> Run(Func<Task<IResult>> action)
        {
            try{return await action();}
            catch(FileNotFoundException){return Results.NotFound(new{message="Материал или модель не найдены."});}
            catch(Exception e)when(e is InvalidDataException or JsonException){return Results.Problem(e.Message,statusCode:422);}
            catch(Exception e)when(e is IOException or UnauthorizedAccessException){return Results.Problem("Хранилище исходников недоступно. Существующие материалы не изменены.",statusCode:503);}
        }
        routes.MapGet("",(HttpContext c,SourceMaterialService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.View)?Task.FromResult(Denied()):Run(async()=>Results.Ok(await s.ListAsync(canOpenDraft(c,a),ct))));
        routes.MapPost("/preview",(SourceMaterialTarget target,HttpContext c,SourceMaterialService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.View)||!a.Has(c,ProcessPermissions.EditContext)||(target.Draft&&!canOpenDraft(c,a))
                ?Task.FromResult(Denied()):Run(async()=>Results.Ok(await s.PreviewAsync(target,ct))));
        routes.MapPost("",(IFormFile file,[FromForm]string target,HttpContext c,SourceMaterialService s,AccessControlService a,CancellationToken ct)=>
        {
            if(!a.Has(c,ProcessPermissions.View)||!a.Has(c,ProcessPermissions.EditContext))return Task.FromResult(Denied());
            return Run(async()=>
            {
                if(target.Length>4096)throw new InvalidDataException("Слишком длинная привязка.");
                var request=JsonSerializer.Deserialize<SourceMaterialTarget>(target,new JsonSerializerOptions(JsonSerializerDefaults.Web){PropertyNameCaseInsensitive=false})
                    ??throw new InvalidDataException("Отсутствует привязка.");
                if(request.Draft&&!canOpenDraft(c,a))return Denied();
                var user=a.CurrentUser(c);return Results.Ok(await s.UploadAsync(file,request,user.Id,user.DisplayName,ct));
            });
        }).DisableAntiforgery();
        routes.MapGet("/{id}/check",(string id,HttpContext c,SourceMaterialService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.View)?Task.FromResult(Denied()):Run(async()=>
            {
                var record=await s.GetAsync(id,ct);if(record.Target.Draft&&!canOpenDraft(c,a))return Denied();
                return Results.Ok(await s.CheckAsync(record,ct));
            }));
        routes.MapGet("/{id}/content",(string id,HttpContext c,SourceMaterialService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.View)?Task.FromResult(Denied()):Run(async()=>
            {
                var record=await s.GetAsync(id,ct);if(record.Target.Draft&&!canOpenDraft(c,a))return Denied();
                c.Response.Headers["X-Content-Type-Options"]="nosniff";
                return Results.File(await s.ContentAsync(id,ct),"application/octet-stream",record.FileName);
            }));
    }
}
