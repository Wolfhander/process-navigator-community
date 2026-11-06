using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class ResponsibilityReceiptChecks
{
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool ok,string text){if(!ok)throw new Exception("Responsibility: "+text);count++;}
        async Task Reject(Func<Task> action){try{await action();throw new Exception("Invalid receipt accepted");}catch(InvalidDataException){count++;}}
        var root=Directory.CreateTempSubdirectory("pn-receipts-").FullName;
        try
        {
            var service=new ProcessExecutionService(new Host(root));
            NodeModel Node(string id,string lane,string type="task")=>new(id,type,id,lane,0,0,100,80,"not-in-snapshot",null,"1 час",[],[],
                InformationObjects:type=="task"?[new("drawing","Учебный чертёж",id=="a"?"Output":"Input",Version:"1")]:[]);
            var model=new ProcessModel("source","Учебный источник","1","Учебный","Published",[new("l1","Разработка",0,200),new("l2","Проверка",200,200)],
                [Node("s","l1","startEvent"),Node("a","l1"),Node("b","l2"),Node("z","l2","endEvent")],
                [new("s-a","s","a",null,[]),new("a-b","a","b",null,[]),new("b-z","b","z",null,[])]);
            var units=new[]{new OrganizationUnitModel("u1",null,"Старый отдел разработки","Р",""),new("u2","u1","Старый отдел проверки","П","")};
            var org=new OrganizationMapModel("g","Учебная группа","",[new("org","Старая организация","",[],units)],
                [new("source",["org"],[new("l1","org","Старый отдел разработки","u1"),new("l2","org","Старый отдел проверки","u2")],"")]);
            var users=new[]{new UserProfileModel("person","Старое имя","employee","Исполнитель",["permission-must-not-freeze"])};
            var lanes=new[]{new LaneAssignmentModel("l1","Разработка",["person"]),new("l2","Проверка",["person"])};
            var assignments=new ProcessAssignmentsModel("source",lanes,users);
            var snapshot=ResponsibilitySnapshot.Create(model,org,assignments);
            Check(!ResponsibilitySnapshot.Create(model,org,assignments with{Users=users.Select(u=>u with{IsActive=false}).ToArray()}).People.Single().ActiveAtCapture,"Inactive assigned person's name and activity are historical evidence, not permissions");
            var instance=await service.StartAsync(model,"actor","Передача внутри процесса",default,snapshot);
            Check(instance.Responsibility!.CapturedAt==instance.StartedAt,"Snapshot tied to start");
            Check(!JsonSerializer.Serialize(snapshot).Contains("permission-must-not-freeze"),"Historical directory never contains permissions");
            Check(!JsonSerializer.Serialize(snapshot).Contains("not-in-snapshot"),"Unneeded step context not copied");
            units[0]=units[0] with{Name="Новое имя"};users[0]=users[0] with{DisplayName="Новое имя человека"};
            Check(snapshot.Organization.LegalEntities[0].Units![0].Name=="Старый отдел разработки"&&snapshot.People.Single().Name=="Старое имя","Snapshot has no live aliases");
            Check((await new ProcessExecutionService(new Host(root)).ListAsync("source",default)).Single().Responsibility!.People.Single().Name=="Старое имя","Historical names survive reload");
            var request=new ProcessReceiptUpdateModel("source",instance.Id,"a",1,"b",1,"drawing","1","Чертёж получен и проверен");
            var reassigned=await service.AssignStepAsync(model,instance.Id,"a","person","Персональное назначение","actor",assignments,default);
            Check(reassigned.AssignmentEvents!.Single().ToUserName=="Новое имя человека","Personal assignment history preserves name at assignment separately from startup name");
            lanes[0]=lanes[0] with{UserIds=[]};
            Check(snapshot.Lanes[0].UserIds.Single()=="person","Changing current lane assignment cannot rewrite startup snapshot");
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request,"actor","Профиль"));
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request with{SourceProcessId=null!},"actor","Профиль"));
            await service.UpdateStepAsync(model,instance.Id,"a","InProgress","actor",default);
            await service.SaveStepResultAsync(model,instance.Id,"a","Чертёж выпущен",["drawing"],"actor",default);
            await service.UpdateStepAsync(model,instance.Id,"a","Completed","actor",default);
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request with{SourceIteration=2},"actor","Профиль"));
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request with{TargetIteration=2},"actor","Профиль"));
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request with{ObjectId="unknown"},"actor","Профиль"));
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request with{Version="2"},"actor","Профиль"));
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request with{Reason="x"},"actor","Профиль"));
            var before=(await service.ListAsync("source",default)).Single();
            var accepted=await service.AcceptReceiptAsync("source",instance.Id,request,"actor","Профиль приёмки");
            Check(accepted.Receipts!.Count==1,"Actual receipt recorded");
            Check(JsonSerializer.Serialize(accepted.Steps)==JsonSerializer.Serialize(before.Steps),"Receipt never starts/completes/skips a step");
            var receipt=accepted.Receipts.Single();
            Check(receipt.SourceResponsible.Contains("Старая организация")&&receipt.SourceResponsible.Contains("Старое имя"),"Receipt freezes historical org and lane people");
            Check(receipt.SourceResponsible.Contains("Новое имя человека"),"Receipt includes later personal assignment history without overwriting startup people");
            Check(receipt.AcceptedBy=="actor"&&receipt.AcceptedByName=="Профиль приёмки","Receipt actor is explicitly supplied by endpoint");
            Check((await service.AcceptReceiptAsync("source",instance.Id,request,"actor","Профиль приёмки")).Receipts!.Count==1,"Identical retry is idempotent");
            await Reject(()=>service.AcceptReceiptAsync("source",instance.Id,request with{Reason="Подмена истории"},"actor","Профиль"));
            Check((await service.TimelineAsync(model,instance.Id,[],default)).Events.Any(e=>e.Type=="ReceiptAccepted"),"Receipt appears in timeline");
            var reloaded=(await new ProcessExecutionService(new Host(root)).ListAsync("source",default)).Single();
            Check(reloaded.Receipts!.Single().Reason==request.Reason,"Receipt survives restart");
            var targetModel=model with{Id="target",Name="Учебный получатель"};
            var targetOrg=org with{CrossCompanyProcesses=[org.CrossCompanyProcesses[0] with{ProcessId="target"}]};
            var targetAssignments=assignments with{ProcessId="target"};
            var targetSnapshot=ResponsibilitySnapshot.Create(targetModel,targetOrg,targetAssignments);
            var target=await service.StartAsync(targetModel,"actor","Межпроцессная приёмка",default,targetSnapshot);
            var cross=request with{TargetElementId="b"};
            var crossResult=await service.AcceptReceiptAsync("target",target.Id,cross,"actor","Профиль");
            Check(crossResult.Receipts!.Single().SourceProcessId=="source","Cross-process receipt binds exact source instance");
            Check(crossResult.Receipts.Single().SourceVersion=="1","Source version retained independently of current model");
            var concurrentTarget=await service.StartAsync(targetModel,"actor","Конкурентная приёмка",default,targetSnapshot);
            await Task.WhenAll(Enumerable.Range(0,4).Select(_=>service.AcceptReceiptAsync("target",concurrentTarget.Id,cross,"actor","Профиль")));
            Check((await service.ListAsync("target",default)).Single(i=>i.Id==concurrentTarget.Id).Receipts!.Count==1,"Concurrent identical submissions create one receipt");
            await service.ChangeLifecycleAsync("target",target.Id,"cancel","Учебная отмена","actor",default);
            await Reject(()=>service.AcceptReceiptAsync("target",target.Id,cross with{TargetElementId="a"},"actor","Профиль"));
            var legacy=await service.StartAsync(targetModel,"actor","Старая запись",default);
            await Reject(()=>service.AcceptReceiptAsync("target",legacy.Id,cross,"actor","Профиль"));
            await service.ChangeLifecycleAsync("source",instance.Id,"fail","Учебная ошибка","actor",default);
            await Reject(()=>service.AcceptReceiptAsync("target",concurrentTarget.Id,cross,"actor","Профиль"));
            Check((await service.ListAsync("target",default)).Single(i=>i.Id==concurrentTarget.Id).Receipts!.Count==1,"Failure of producer does not erase already recorded history");
            await Reject(()=>{ResponsibilitySnapshot.Validate(accepted with{Responsibility=accepted.Responsibility! with{Process=model with{Id="wrong"}}});return Task.CompletedTask;});
        }
        finally
        {
            var full=Path.GetFullPath(root);var allowed=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(!full.StartsWith(allowed,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(full).StartsWith("pn-receipts-"))throw new Exception("Unsafe receipt cleanup");
            Directory.Delete(full,true);
        }
        return count;
    }
    private sealed class Host(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="ReceiptChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public string WebRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
