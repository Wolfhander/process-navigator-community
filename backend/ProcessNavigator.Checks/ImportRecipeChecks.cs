using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
internal static class ImportRecipeChecks
{
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool value,string label){if(!value)throw new Exception("Import recipe: "+label);count++;}
        async Task Reject(Func<Task> action){var no=false;try{await action();}catch(InvalidDataException){no=true;}Check(no,"Unsafe operation rejected");}
        async Task Missing(Func<Task> action){var no=false;try{await action();}catch(FileNotFoundException){no=true;}Check(no,"Foreign or missing resource not disclosed");}
        var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);var root=Path.Combine(temp,"pn-import-recipes-"+Guid.NewGuid().ToString("N"));
        var repo=Directory.GetCurrentDirectory();var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);
        try
        {
            var source=Path.Combine(repo,"backend","ProcessNavigator.Api","Data");
            foreach(var path in Directory.EnumerateFiles(source,"demo-showcase*"))File.Copy(path,Path.Combine(data,Path.GetFileName(path)));
            File.Copy(Path.Combine(source,"organization.json"),Path.Combine(data,"organization.json"));
            foreach(var folder in new[]{"Templates","InformationObjects"})foreach(var path in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories))
            {var target=Path.Combine(data,folder,Path.GetRelativePath(Path.Combine(source,folder),path));Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.Copy(path,target);}
            var env=new Environment(root);var loader=new BpmnProcessLoader(env);var catalog=new ProcessCatalogService(loader);var locks=new ProcessEditLockService();
            var org=new OrganizationMapService(env,catalog,locks);var access=new AccessControlService(env);var registry=new InformationObjectRegistryService(catalog,env);
            var table=new ProcessTableService(catalog,org,new RepositoryBackupService(env),new ProcessAssignmentService(env),access,locks,loader,new ProcessTableImportHistoryService(env));
            var service=new ImportRecipeService(env,table,registry);
            var input=await File.ReadAllBytesAsync(Path.Combine(repo,"artifacts","reference-queue","references-input.xlsx"));
            IFormFile Form(string name="upstream.xlsx",byte[]? bytes=null)=>new FormFile(new MemoryStream(bytes??input),0,(bytes??input).Length,"files",name);
            ImportRecipeRule[] rules=[new("entity","ghost-org","","plant"),new("unit","ghost-unit","plant","1.2.5"),
                new("user","ghost-user","","demo-employee"),new("system","ghost-system","","1С:ERP"),
                new("object","ghost-object","","demo-receipt-inspection"),new("document","ghost-document","","demo-receipt-inspection")];
            string Domain()=>string.Join("|",Directory.EnumerateFiles(data,"*",SearchOption.AllDirectories).Where(p=>!p.Contains(Path.DirectorySeparatorChar+"ImportRecipes"+Path.DirectorySeparatorChar)).Order().Select(p=>Path.GetRelativePath(data,p)+":"+Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p)))));
            var originalDomain=Domain();
            await Reject(()=>service.CreateAsync("owner",new(" ",rules),[Form()],true));
            await Reject(()=>service.CreateAsync("owner",new("Invalid",[new("entity","ghost-org","",KeepNew:true)]),[Form()],true));
            await Reject(()=>service.CreateAsync("owner",new("Duplicate",[rules[0],rules[0]]),[Form()],true));
            await Reject(()=>service.CreateAsync("owner",new("No files",rules),[],true));
            await Reject(()=>service.CreateAsync("owner",new("Bad extension",rules),[Form("script.exe")],true));
            Check((await service.ListAsync("owner")).Recipes.Count==0,"Failed creations leave no recipe");
            var recipe=await service.CreateAsync("owner",new("Weekly upstream",rules),[Form(),Form()],true);
            Check(recipe.Revision==1&&recipe.Batches.Count==1&&recipe.Batches[0].Files.Count==2,"Whole multi-file source set stored");
            await Reject(()=>service.CreateAsync("owner",new("Weekly upstream",rules),[Form()],true));
            await Reject(()=>service.AppendAsync("owner",recipe.Id,1,Enumerable.Range(0,11).Select(_=>Form()).ToArray(),true));
            await Reject(()=>service.AppendAsync("owner",recipe.Id,1,[new FormFile(new MemoryStream(input),0,10L*1024*1024+1,"files","large.xlsx")],true));
            Check(recipe.Batches[0].Files.Select(f=>f.Id).Distinct().Count()==2,"Repeated filenames keep separate IDs");
            Check((await service.ListAsync("other")).Recipes.Count==0,"Profile list is isolated");
            await Missing(()=>service.GetAsync("other",recipe.Id));
            await Missing(()=>service.GetAsync("owner","../escape"));
            var batch=recipe.Batches[0];var file=batch.Files[0];
            Check((await service.OriginalAsync("owner",recipe.Id,batch.Id,file.Id)).Bytes.SequenceEqual(input),"Original bytes and SHA verified");
            var report=await service.PreviewAsync("owner",recipe.Id,batch.Id,1,true);
            Check(report.Files.All(f=>f.State=="ready"&&f.AppliedRules==6&&f.ErrorCount==0),"Six rules replay in dependency order for both files");
            var ready=await service.PreparedAsync("owner",recipe.Id,batch.Id,file.Id,1,report.Files[0].Fingerprint,true);
            Check((await table.PreviewAsync(Form(bytes:ready.Bytes))).ErrorCount==0,"Prepared output passes ordinary preview");
            Check(Domain()==originalDomain,"No models, users or dictionaries changed by storing and preparing");
            await Reject(()=>service.PreparedAsync("owner",recipe.Id,batch.Id,file.Id,1,"forged",true));
            var next=await service.AppendAsync("owner",recipe.Id,1,[Form("next.xlsx")],true);
            Check(next.Revision==2&&next.Batches.Count==2&&next.Rules.SequenceEqual(recipe.Rules),"Next batch retains immutable rules and older sources");
            await Reject(()=>service.AppendAsync("owner",recipe.Id,1,[Form()],true));
            await Reject(()=>service.PreparedAsync("owner",recipe.Id,batch.Id,file.Id,1,report.Files[0].Fingerprint,true));
            var again=await service.PreviewAsync("owner",recipe.Id,next.Batches.Last().Id,2,true);
            Check(again.Files.Single().State=="ready","Next source set checked independently");
            var missingRule=await service.CreateAsync("owner",new("Missing unit",rules.Where(r=>r.Kind!="unit").ToArray()),[Form()],true);
            var pending=await service.PreviewAsync("owner",missingRule.Id,null,1,true);
            Check(pending.Files.Single().State=="needsMapping"&&pending.Files[0].RemainingGroups==1,"Unmatched values are not silently imported");
            await Reject(()=>service.PreparedAsync("owner",missingRule.Id,missingRule.Batches[0].Id,missingRule.Batches[0].Files[0].Id,1,pending.Files[0].Fingerprint,true));
            var wrong=await service.CreateAsync("owner",new("Wrong target",rules.Select(r=>r.Kind=="user"?r with{TargetId="disabled-or-missing"}:r).ToArray()),[Form()],true);
            Check((await service.PreviewAsync("owner",wrong.Id,null,1,true)).Files[0].State=="blocked","Invalid saved target blocked");
            var orgPath=Path.Combine(data,"organization.json");var orgBytes=await File.ReadAllBytesAsync(orgPath);
            var changed=JsonNode.Parse(orgBytes)!;changed["legalEntities"]![0]!["name"]="Renamed dictionary";await File.WriteAllTextAsync(orgPath,changed.ToJsonString());
            await Reject(()=>service.PreparedAsync("owner",recipe.Id,next.Batches.Last().Id,next.Batches.Last().Files[0].Id,2,again.Files[0].Fingerprint,true));
            await File.WriteAllBytesAsync(orgPath,orgBytes);
            var content=Directory.EnumerateFiles(Path.Combine(data,"ImportRecipes"),file.Id+".bin",SearchOption.AllDirectories).Single();
            var bad=(byte[])input.Clone();bad[0]^=1;await File.WriteAllBytesAsync(content,bad);
            await Reject(()=>service.OriginalAsync("owner",recipe.Id,batch.Id,file.Id));
            Check((await service.PreviewAsync("owner",recipe.Id,batch.Id,2,true)).Files[0].State=="blocked","Bad source checksum never produces a prepared copy");
            await File.WriteAllBytesAsync(content,input);
            var metadata=Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(content))!,"metadata.json");var metadataBytes=await File.ReadAllBytesAsync(metadata);
            await File.WriteAllTextAsync(metadata,"{broken");
            Check((await service.ListAsync("owner")).Unreadable==1,"Corrupt recipe is explicit, not deleted");
            await Reject(()=>service.AppendAsync("owner",recipe.Id,2,[Form()],true));await File.WriteAllBytesAsync(metadata,metadataBytes);
            var current=next;
            for(var i=2;i<10;i++)current=await service.AppendAsync("owner",recipe.Id,current.Revision,[Form()],true);
            await Reject(()=>service.AppendAsync("owner",recipe.Id,current.Revision,[Form()],true));
            Check((await service.GetAsync("owner",recipe.Id)).Batches.Count==10,"Batch limit retains all sources");
            var backup=await new RepositoryBackupService(env).CreateAsync("fixture");
            using(var zip=ZipFile.OpenRead(Path.Combine(data,"Backups",backup.FileName)))Check(zip.Entries.Any(e=>e.FullName.EndsWith(file.Id+".bin"))&&zip.Entries.Any(e=>e.FullName.Contains("ImportRecipes")&&e.FullName.EndsWith("metadata.json")),"Backup contains recipe and originals");
            Check(!Directory.EnumerateDirectories(Path.Combine(data,"ImportRecipes"),".pending-*",SearchOption.AllDirectories).Any(),"Failed writes clean only owned staging");
            return count;
        }
        finally{if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-import-recipes-"))throw new Exception("Unsafe fixture cleanup");Directory.Delete(root,true);}
    }
    private sealed class Environment(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="ImportRecipeChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
