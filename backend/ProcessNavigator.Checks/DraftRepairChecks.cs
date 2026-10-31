using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.IO.Compression;
using ProcessNavigator.Api.Services;
using ProcessNavigator.Api.Models;
public static class DraftRepairChecks
{
    public static async Task<int> RunAsync()
    {
        var source=Path.Combine(Directory.GetCurrentDirectory(),"backend/ProcessNavigator.Api/Data");var temp=Path.TrimEndingDirectorySeparator(Path.GetTempPath());
        var root=Path.Combine(temp,"pn-draft-repair-"+Guid.NewGuid().ToString("N"));var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);var n=0;
        void Check(bool ok,string label){if(!ok)throw new Exception(label);n++;}
        async Task Reject(Func<Task> action){try{await action();throw new Exception("Expected rejection");}catch(InvalidDataException){n++;}}
        try
        {
            foreach(var f in Directory.GetFiles(source).Where(f=>f.EndsWith(".bpmn")||f.EndsWith(".context.json")||Path.GetFileName(f)=="organization.json"))File.Copy(f,Path.Combine(data,Path.GetFileName(f)));
            var env=new Env(root);var loader=new BpmnProcessLoader(env);var catalog=new ProcessCatalogService(loader);var locks=new ProcessEditLockService();
            var orgs=new OrganizationMapService(env,catalog,locks);var org=await orgs.LoadAsync();var backups=new RepositoryBackupService(env);var service=new DraftRepairService(catalog,orgs,locks,backups,loader);
            var ids=org.CrossCompanyProcesses.Take(2).Select(b=>b.ProcessId).ToArray();var nodes=new List<string>();
            foreach(var id in ids)
            {
                await catalog.CreateDraftAsync(id);var model=await catalog.LoadAsync(id,true);var node=model.Nodes.First(n=>n.Type=="task").Id;nodes.Add(node);
                var path=Path.ChangeExtension(catalog.GetBpmnSourcePath(id,true),".context.json");var json=JsonNode.Parse(await File.ReadAllTextAsync(path))!.AsObject();
                json["owner"]="Не назначен";json["ownerLegalEntityId"]=null;json["ownerUnitId"]=null;json["fixtureUnknown"]="preserve";
                json["elements"]![node]!["linkedProcessId"]="lost-"+id;json["elements"]![node]!["fixtureUnknown"]="keep";
                await File.WriteAllTextAsync(path,json.ToJsonString());
            }
            var summaries=await catalog.ListAsync();string? leaf=null;
            foreach(var summary in summaries.Where(s=>!ids.Contains(s.Id))){var model=await catalog.LoadAsync(summary.Id,false);if(model.Nodes.All(n=>string.IsNullOrWhiteSpace(n.LinkedProcessId))){leaf=model.Id;break;}}
            Check(leaf is not null,"Leaf replacement exists");
            var originals=ids.Select(id=>File.ReadAllBytes(Path.ChangeExtension(catalog.GetBpmnSourcePath(id,true),".context.json"))).ToArray();
            var bpmn=ids.Select(id=>File.ReadAllBytes(catalog.GetBpmnSourcePath(id,true))).ToArray();
            var published=ids.Select(id=>File.ReadAllBytes(catalog.GetBpmnSourcePath(id,false))).ToArray();
            var scan=await service.ScanAsync();Check(scan.Items.Count==2&&scan.Items.All(i=>i.MissingOwner&&i.Links.Count>=1),"Empty owners and exact broken references");
            var unit=scan.Units.First();DraftRepairChoice Owner(string id)=>new(id,"owner",LegalEntityId:unit.EntityId,UnitId:unit.UnitId);
            var owner=Owner(ids[0]);var link=new DraftRepairChoice(ids[0],"link",nodes[0],TargetId:leaf);
            DraftRepairRequest Request(params DraftRepairChoice[] choices)=>new(scan.Fingerprint,choices);
            await Reject(()=>service.PreviewAsync(Request()));
            await Reject(()=>service.PreviewAsync(Request(owner,owner)));
            await Reject(()=>service.PreviewAsync(Request(owner with{Kind="unknown"})));
            await Reject(()=>service.PreviewAsync(Request(owner with{UnitId="unknown"})));
            await Reject(()=>service.PreviewAsync(Request(owner with{LegalEntityId="unknown"})));
            await Reject(()=>service.PreviewAsync(Request(owner with{Clear=true})));
            await Reject(()=>service.PreviewAsync(Request(link with{ElementId="unknown"})));
            await Reject(()=>service.PreviewAsync(Request(link with{TargetId="unknown"})));
            await Reject(()=>service.PreviewAsync(Request(link with{TargetId=ids[0]})));
            await Reject(()=>service.PreviewAsync(Request(link with{TargetId=null})));
            await Reject(()=>service.PreviewAsync(Request(link with{Clear=true})));
            await Reject(()=>service.PreviewAsync(Request(link with{TargetId=ids[1]},new(ids[1],"link",nodes[1],TargetId:ids[0]))));
            var user=new UserProfileModel("fixture","Fixture","admin","Admin",[]);var held=locks.Acquire(ids[0],user);
            Check((await service.ScanAsync()).Items.Single(i=>i.ProcessId==ids[0]).Reason is not null,"Lock shown explicitly");
            await Reject(()=>service.PreviewAsync(Request(owner)));locks.Release(ids[0],held.Token,user);
            var request=Request(owner,link,Owner(ids[1]),new(ids[1],"link",nodes[1],Clear:true));
            var plan=await service.PreviewAsync(request);
            await Reject(()=>catalog.ApplyDraftRepairsAsync(ids[0],[owner,link],org,default,()=>Task.FromResult(false)));
            Check(File.ReadAllBytes(Path.ChangeExtension(catalog.GetBpmnSourcePath(ids[0],true),".context.json")).SequenceEqual(originals[0]),"Final metadata guard preserves exact original");
            Check(plan.Changes.Count==4&&!Directory.Exists(Path.Combine(data,"Backups")),"Preview no backup or writes");
            for(var i=0;i<ids.Length;i++)Check(File.ReadAllBytes(Path.ChangeExtension(catalog.GetBpmnSourcePath(ids[i],true),".context.json")).SequenceEqual(originals[i]),"Preview preserves context");
            await Reject(()=>service.ApplyAsync(new(request,"forged"),"fixture"));
            var targetPath=catalog.GetBpmnSourcePath(leaf!,false);var targetBytes=await File.ReadAllBytesAsync(targetPath);await File.AppendAllTextAsync(targetPath," ");
            await Reject(()=>service.ApplyAsync(new(request,plan.Proof),"fixture"));await File.WriteAllBytesAsync(targetPath,targetBytes);
            var result=await service.ApplyAsync(new(request,plan.Proof),"fixture");
            Check(result.Items.Count==2&&result.Items.All(i=>i.Status=="Updated"),"Both selected drafts updated");
            for(var i=0;i<ids.Length;i++)
            {
                var model=await catalog.LoadAsync(ids[i],true);Check(model.OwnerUnitId==unit.UnitId&&model.OwnerLegalEntityId==unit.EntityId,"Exact owner pair");
                Check(File.ReadAllBytes(catalog.GetBpmnSourcePath(ids[i],true)).SequenceEqual(bpmn[i]),"BPMN byte-preserved");
                Check(File.ReadAllBytes(catalog.GetBpmnSourcePath(ids[i],false)).SequenceEqual(published[i]),"Published byte-preserved");
                var json=JsonNode.Parse(await File.ReadAllTextAsync(Path.ChangeExtension(catalog.GetBpmnSourcePath(ids[i],true),".context.json")))!;
                Check(json["fixtureUnknown"]!.GetValue<string>()=="preserve"&&json["elements"]![nodes[i]]!["fixtureUnknown"]!.GetValue<string>()=="keep","Unknown context fields preserved");
                Check(model.Nodes.Single(n=>n.Id==nodes[i]).LinkedProcessId==(i==0?leaf:null),"Replacement or explicit clear only");
            }
            using(var zip=ZipFile.OpenRead(Path.Combine(data,"Backups",result.BackupFileName)))
                for(var i=0;i<ids.Length;i++){using var stream=zip.GetEntry("Data/Drafts/"+ids[i]+".context.json")!.Open();using var ms=new MemoryStream();await stream.CopyToAsync(ms);Check(ms.ToArray().SequenceEqual(originals[i]),"Recoverable exact source");}
            await Reject(()=>service.ApplyAsync(new(request,plan.Proof),"fixture"));
            var resolved=await service.ScanAsync();
            await Reject(()=>service.PreviewAsync(new(resolved.Fingerprint,[owner])));
            Check((await service.ScanAsync()).Items.All(i=>!ids.Contains(i.ProcessId)),"Resolved candidates disappear");
            var corrupt=Path.Combine(data,"fixture-corrupt.bpmn");await File.WriteAllTextAsync(corrupt,"<broken");
            await Reject(()=>service.ScanAsync());File.Delete(corrupt);
            Check(!Directory.EnumerateFiles(data,"*.tmp",SearchOption.AllDirectories).Any(),"No abandoned owned temporary files");
            return n;
        }
        finally{if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-draft-repair-"))throw new Exception("Unsafe cleanup");Directory.Delete(root,true);}
    }
    private sealed class Env(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="DraftRepairChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
