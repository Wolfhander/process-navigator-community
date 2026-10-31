using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;
public static class TableReferenceEndpoints
{
    public static void MapTableReferences(this WebApplication app,Func<HttpContext,AccessControlService,bool> canOpenDraft)
    {
        var routes=app.MapGroup("/api/processes/table-references").AddEndpointFilter(async(c,next)=>{c.HttpContext.Response.Headers["Cache-Control"]="no-store";return await next(c);});
        static IResult Forbidden()=>Results.Problem("Нужно право импорта процессов.",statusCode:403);
        static async Task<IResult> Run(Func<Task<IResult>> action)
        {
            try{return await action();}
            catch(Exception e)when(e is InvalidDataException or JsonException or ArgumentException or System.Xml.XmlException){return Results.Problem(e.Message,statusCode:422);}
            catch(IOException){return Results.Problem("Не удалось прочитать исходные данные.",statusCode:503);}
        }
        routes.MapPost("",(IFormFile tableFile,HttpContext c,ProcessTableService tables,InformationObjectRegistryService registry,AccessControlService access,CancellationToken ct)=>
            !access.Has(c,ProcessPermissions.Import)?Task.FromResult(Forbidden()):Run(async()=>Results.Ok(await tables.ReferencesAsync(tableFile,registry,canOpenDraft(c,access),ct)))).DisableAntiforgery();
        routes.MapPost("/resolve",(IFormFile tableFile,[FromForm]string resolution,HttpContext c,ProcessTableService tables,InformationObjectRegistryService registry,AccessControlService access,CancellationToken ct)=>
        {
            if(!access.Has(c,ProcessPermissions.Import))return Task.FromResult(Forbidden());
            return Run(async()=>{
                if(resolution.Length>1_000_000)throw new InvalidDataException("Слишком много решений.");
                var request=JsonSerializer.Deserialize<TableReferenceResolution>(resolution,new JsonSerializerOptions(JsonSerializerDefaults.Web))
                    ??throw new InvalidDataException("Не переданы решения.");
                return Results.File(await tables.ResolveReferencesAsync(tableFile,request,registry,canOpenDraft(c,access),ct),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","resolved.xlsx");
            });
        }).DisableAntiforgery();
    }
}
