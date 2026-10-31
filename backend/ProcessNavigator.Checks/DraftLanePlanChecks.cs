using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using System.IO.Compression;
using System.Xml.Linq;
using ProcessNavigator.Api.Services;
using ProcessNavigator.Api.Models;
public static class DraftLanePlanChecks
{
    public static async Task<int> RunAsync()
    {
        var repo=Directory.GetCurrentDirectory();var temp=Path.GetTempPath();var root=Path.Combine(temp,"pn-lane-plan-"+Guid.NewGuid().ToString("N"));
        var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);var n=0;
        void Check(bool ok,string label){if(!ok)throw new Exception(label);n++;}
        async Task Reject(Func<Task> action){try{await action();throw new Exception("Expected rejection");}catch(InvalidDataException){n++;}}
        try
        {
            foreach(var file in Directory.GetFiles(Path.Combine(repo,"backend/ProcessNavigator.Api/Data")))
                if(file.EndsWith(".bpmn")||file.EndsWith(".context.json")||Path.GetFileName(file)=="organization.json")File.Copy(file,Path.Combine(data,Path.GetFileName(file)));
            var env=new Env(root);var loader=new BpmnProcessLoader(env);var catalog=new ProcessCatalogService(loader);var locks=new ProcessEditLockService();
            var orgs=new OrganizationMapService(env,catalog,locks);var backups=new RepositoryBackupService(env);var plans=new DraftLanePlanService(catalog,orgs,locks,backups);
            var org=await orgs.LoadAsync();var ids=org.CrossCompanyProcesses.Take(2).Select(b=>b.ProcessId).ToArray();
            Check(ids.Length==2,"Two source models");
            var published=ids.Select(id=>File.ReadAllBytes(catalog.GetBpmnSourcePath(id,false))).ToArray();
            foreach(var id in ids)
            {
                await catalog.CreateDraftAsync(id);var path=catalog.GetBpmnSourcePath(id,true);var xml=XDocument.Load(path);
                foreach(var lane in xml.Descendants().Where(e=>e.Name.LocalName=="lane"))lane.SetAttributeValue("name","Старое имя");
                xml.Save(path);
            }
            var firstBytes=File.ReadAllBytes(catalog.GetBpmnSourcePath(ids[0],true));
            var p=await plans.PreviewAsync();Check(p.Items.Count==2&&p.Items.All(i=>i.Changes.Count>0&&i.Fingerprint is not null),"Exact proposed changes");
            Check(File.ReadAllBytes(catalog.GetBpmnSourcePath(ids[0],true)).SequenceEqual(firstBytes)&&!Directory.Exists(Path.Combine(data,"Backups")),"Preview is read only");
            var selected=p.Items.Select(i=>new LanePlanSelection(i.ProcessId,i.Fingerprint!)).ToArray();
            var user=new UserProfileModel("fixture","Fixture","admin","Admin",[]);
            var held=locks.Acquire(ids[0],user);
            Check((await plans.PreviewAsync()).Items.Single(i=>i.ProcessId==ids[0]).Reason is not null,"Locked draft is explicit");
            await Reject(()=>plans.ApplyAsync(new(p.OrganizationRevision,selected),"fixture"));
            locks.Release(ids[0],held.Token,user);
            await Reject(()=>plans.ApplyAsync(new(p.OrganizationRevision,[]),"fixture"));
            await Reject(()=>plans.ApplyAsync(new(p.OrganizationRevision,[selected[0],selected[0]]),"fixture"));
            await Reject(()=>plans.ApplyAsync(new("stale",selected),"fixture"));
            await Reject(()=>plans.ApplyAsync(new(p.OrganizationRevision,[selected[0] with{Fingerprint="forged"}]),"fixture"));
            await Reject(()=>plans.ApplyAsync(new(p.OrganizationRevision,[new("unknown","proof")]),"fixture"));
            var second=catalog.GetBpmnSourcePath(ids[1],true);await File.AppendAllTextAsync(second," ");
            await Reject(()=>plans.ApplyAsync(new(p.OrganizationRevision,selected),"fixture"));
            Check(File.ReadAllBytes(catalog.GetBpmnSourcePath(ids[0],true)).SequenceEqual(firstBytes),"Whole selection checked before writing first model");
            p=await plans.PreviewAsync();selected=p.Items.Select(i=>new LanePlanSelection(i.ProcessId,i.Fingerprint!)).ToArray();
            var result=await plans.ApplyAsync(new(p.OrganizationRevision,[selected[0]]),"fixture");
            Check(result.Report.UpdatedProcesses==1&&result.Report.RenamedLanes>0,"Only selected draft changed");
            using(var zip=ZipFile.OpenRead(Path.Combine(data,"Backups",result.BackupFileName)))
            {
                var entry=zip.GetEntry("Data/Drafts/"+ids[0]+".bpmn")!;using var ms=new MemoryStream();await entry.Open().CopyToAsync(ms);
                Check(ms.ToArray().SequenceEqual(firstBytes),"Backup preserves exact original draft");
            }
            Check((await plans.PreviewAsync()).Items.Single(i=>i.ProcessId==selected[0].ProcessId).Changes.Count==0,"Idempotent names");
            Check((await plans.PreviewAsync()).Items.Single(i=>i.ProcessId==selected[1].ProcessId).Changes.Count>0,"Unselected draft unchanged");
            for(var i=0;i<ids.Length;i++)Check(File.ReadAllBytes(catalog.GetBpmnSourcePath(ids[i],false)).SequenceEqual(published[i]),"Published bytes unchanged");
            var fresh=await plans.PreviewAsync();var pending=fresh.Items.Single(i=>i.Changes.Count>0);
            var context=Path.ChangeExtension(catalog.GetBpmnSourcePath(pending.ProcessId,true),".context.json");await File.AppendAllTextAsync(context," ");
            await Reject(()=>plans.ApplyAsync(new(fresh.OrganizationRevision,[new(pending.ProcessId,pending.Fingerprint!)]),"fixture"));
            var path2=catalog.GetBpmnSourcePath(pending.ProcessId,true);var old=await File.ReadAllBytesAsync(path2);
            await Reject(()=>catalog.SyncDraftLaneNamesAsync(pending.ProcessId,org.CrossCompanyProcesses.Single(b=>b.ProcessId==pending.ProcessId).LaneOrganizations,org,default,()=>Task.FromResult(false)));
            Check((await File.ReadAllBytesAsync(path2)).SequenceEqual(old),"Last-moment guard preserves source");
            Check(!Directory.EnumerateFiles(data,"*.tmp",SearchOption.AllDirectories).Any(),"Owned temporary files cleaned");
            var beforeXml=XDocument.Load(new MemoryStream(firstBytes));
            var afterXml=XDocument.Load(catalog.GetBpmnSourcePath(ids[0],true));
            foreach(var doc in new[]{beforeXml,afterXml})
                foreach(var lane in doc.Descendants().Where(e=>e.Name.LocalName=="lane"))lane.SetAttributeValue("name","");
            Check(XNode.DeepEquals(beforeXml,afterXml),"Only lane names changed: geometry, IDs, edges preserved");
            return n;
        }
        finally{if(Path.GetDirectoryName(root)!=Path.TrimEndingDirectorySeparator(temp)||!Path.GetFileName(root).StartsWith("pn-lane-plan-"))throw new Exception("Unsafe cleanup");Directory.Delete(root,true);}
    }
    private sealed class Env(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="LanePlanChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
