using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;
public static class ImportRecipeEndpoints
{
    public static void MapImportRecipes(this WebApplication app,Func<HttpContext,AccessControlService,bool> drafts)
    {
        var routes=app.MapGroup("/api/import-recipes").AddEndpointFilter(async(c,next)=>{
            c.HttpContext.Response.Headers["Cache-Control"]="no-store";c.HttpContext.Response.Headers["X-Content-Type-Options"]="nosniff";return await next(c);
        });
        static IResult Denied()=>Results.Problem("Нужно право импорта процессов.",statusCode:403);
        static async Task<IResult> Run(Func<Task<IResult>> action){
            try{return await action();}catch(FileNotFoundException){return Results.NotFound(new{message="Регламент или файл не найдены в текущем профиле."});}
            catch(Exception e)when(e is InvalidDataException or JsonException or System.Xml.XmlException){return Results.Problem(e.Message,statusCode:422);}
            catch(Exception e)when(e is IOException or UnauthorizedAccessException){return Results.Problem("Хранилище регламентов недоступно. Существующие исходники сохранены.",statusCode:503);}
        }
        routes.MapGet("",(HttpContext c,ImportRecipeService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.Import)?Task.FromResult(Denied()):Run(async()=>Results.Ok(await s.ListAsync(a.CurrentUser(c).Id,ct))));
        routes.MapPost("",(HttpContext c,ImportRecipeService s,AccessControlService a,CancellationToken ct)=>{
            if(!a.Has(c,ProcessPermissions.Import))return Task.FromResult(Denied());
            return Run(async()=>{
                var form=await c.Request.ReadFormAsync(ct);var json=form["config"].ToString();if(json.Length>1_000_000)throw new InvalidDataException("Конфигурация слишком велика.");
                var config=JsonSerializer.Deserialize<ImportRecipeCreate>(json,new JsonSerializerOptions(JsonSerializerDefaults.Web))??throw new InvalidDataException("Нет конфигурации.");
                return Results.Ok(await s.CreateAsync(a.CurrentUser(c).Id,config,form.Files.GetFiles("files"),drafts(c,a),ct));
            });
        }).WithMetadata(new RequestSizeLimitAttribute(60*1024*1024)).DisableAntiforgery();
        routes.MapPost("/{id}/batches",(string id,HttpContext c,ImportRecipeService s,AccessControlService a,CancellationToken ct)=>{
            if(!a.Has(c,ProcessPermissions.Import))return Task.FromResult(Denied());
            return Run(async()=>{
                var form=await c.Request.ReadFormAsync(ct);
                if(!int.TryParse(form["expectedRevision"],out var revision))throw new InvalidDataException("Нужна версия регламента.");
                return Results.Ok(await s.AppendAsync(a.CurrentUser(c).Id,id,revision,form.Files.GetFiles("files"),drafts(c,a),ct));
            });
        }).WithMetadata(new RequestSizeLimitAttribute(60*1024*1024)).DisableAntiforgery();
        routes.MapPost("/{id}/batches/{batchId}/preview",(string id,string batchId,ImportRecipeRequest request,HttpContext c,ImportRecipeService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.Import)?Task.FromResult(Denied()):Run(async()=>Results.Ok(await s.PreviewAsync(a.CurrentUser(c).Id,id,batchId,request.ExpectedRevision,drafts(c,a),ct))));
        routes.MapGet("/{id}/batches/{batchId}/files/{fileId}",(string id,string batchId,string fileId,HttpContext c,ImportRecipeService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.Import)?Task.FromResult(Denied()):Run(async()=>{var original=await s.OriginalAsync(a.CurrentUser(c).Id,id,batchId,fileId,ct);return Results.File(original.Bytes,"application/octet-stream",original.File.FileName);}));
        routes.MapPost("/{id}/batches/{batchId}/files/{fileId}/prepared",(string id,string batchId,string fileId,ImportRecipeRequest request,HttpContext c,ImportRecipeService s,AccessControlService a,CancellationToken ct)=>
            !a.Has(c,ProcessPermissions.Import)?Task.FromResult(Denied()):Run(async()=>{
                var prepared=await s.PreparedAsync(a.CurrentUser(c).Id,id,batchId,fileId,request.ExpectedRevision,request.Fingerprint,drafts(c,a),ct);
                return Results.File(prepared.Bytes,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",prepared.Name);
            }));
    }
}
