using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;
public sealed partial class ProcessCatalogService
{
    // Change only the explicitly approved fields, preserving unknown context properties.
    public async Task<string> ApplyDraftRepairsAsync(string id,IReadOnlyList<DraftRepairChoice> choices,OrganizationMapModel org,
        CancellationToken ct,Func<Task<bool>> stillCurrent)
    {
        await contextWriteLock.WaitAsync(ct);string? temporary=null;
        try
        {
            await EnsureDraftEditableAsync(id,ct);var paths=DraftPaths(id);
            var root=JsonNode.Parse(await File.ReadAllTextAsync(paths.Context,ct))!.AsObject();
            foreach(var c in choices)
            {
                if(c.Kind=="owner")
                {
                    var entity=org.LegalEntities.Single(e=>e.Id==c.LegalEntityId);var unit=entity.Units!.Single(u=>u.Id==c.UnitId);
                    root["owner"]=unit.Name;root["ownerLegalEntityId"]=entity.Id;root["ownerUnitId"]=unit.Id;
                }
                else
                {
                    await ValidateLinkedProcessAsync(id,c.Clear?null:c.TargetId,ct);
                    var element=root["elements"]?[c.ElementId!] as JsonObject??throw new InvalidDataException("Контекст этапа отсутствует.");
                    element["linkedProcessId"]=c.Clear?null:c.TargetId;
                }
            }
            var bytes=JsonSerializer.SerializeToUtf8Bytes(root,new JsonSerializerOptions{WriteIndented=true});
            temporary=Path.Combine(Path.GetDirectoryName(paths.Context)!,"."+Guid.NewGuid().ToString("N")+".repair.tmp");
            await File.WriteAllBytesAsync(temporary,bytes,ct);await loader.LoadFilesAsync(paths.Bpmn,temporary,id,ct);
            if(!await stillCurrent())throw new InvalidDataException("Данные или блокировка изменились перед записью.");
            File.Move(temporary,paths.Context,true);temporary=null;
            return Convert.ToHexString(SHA256.HashData(bytes));
        }
        finally{if(temporary is not null)File.Delete(temporary);contextWriteLock.Release();}
    }
}
