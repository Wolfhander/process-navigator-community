using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class OrganizationCalendarChecks
{
    public static async Task<int> RunAsync()
    {
        var count=0; void Check(bool ok,string label){if(!ok)throw new Exception("Org calendar: "+label);count++;}
        async Task Reject(Func<Task> action){try{await action();throw new Exception("Invalid calendar accepted");}catch(InvalidDataException){count++;}}
        ScheduleCalendarModel Cal(string start="09:00",string end="17:00",string? zone=null)=>new(start,end,[0,1,2,3,4,5,6],[],0,zone);
        var night=new ScheduleWorkCalendar(Cal("22:00","06:00") with{WorkingDays=[5],NonWorkingDates=["2026-11-07"]});
        var friday=DateTimeOffset.Parse("2026-11-06T22:00Z");
        Check(night.Add(friday,8)==friday.AddHours(8),"Night shift crosses midnight; exception is shift start date");
        Check(night.Add(friday.AddHours(8),8,false)==friday,"Night backward calculation");
        Check(night.Add(friday.AddHours(7),2)==friday.AddDays(7).AddHours(1),"Night normalization skips to next working start");
        var spring=new ScheduleWorkCalendar(Cal("01:00","05:00","Europe/Berlin"));
        var springStart=DateTimeOffset.Parse("2026-03-29T00:00Z");
        Check(spring.Add(springStart,3)==springStart.AddHours(3),"Spring DST shift is three elapsed hours");
        Check(spring.Add(springStart.AddHours(3),3,false)==springStart,"Spring backward");
        var autumnStart=DateTimeOffset.Parse("2026-10-24T23:00Z");
        Check(spring.Add(autumnStart,5)==autumnStart.AddHours(5),"Autumn DST shift includes repeated hour");
        Check(spring.Between(autumnStart,autumnStart.AddHours(5))==5,"Business hour difference is elapsed time");
        var invalidLocal=new ScheduleWorkCalendar(Cal("02:30","03:30","Europe/Berlin"));
        Check(invalidLocal.Add(springStart,0.5)==DateTimeOffset.Parse("2026-03-29T01:30Z"),"Invalid spring start advances to first valid minute");
        await Reject(()=>{_=new ScheduleWorkCalendar(Cal() with{WorkingDays=[]});return Task.CompletedTask;});
        await Reject(()=>{_=new ScheduleWorkCalendar(Cal("09:00","09:00"));return Task.CompletedTask;});
        await Reject(()=>{_=new ScheduleWorkCalendar(Cal(zone:"not-a-zone"));return Task.CompletedTask;});
        var root=Directory.CreateTempSubdirectory("pn-org-calendar-").FullName;
        try
        {
            var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);
            var repo=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../../"));
            var template=await File.ReadAllTextAsync(Path.Combine(repo,"backend","ProcessNavigator.Api","Data","demo-showcase-l4-drawing.bpmn"));
            var ids=new[]{"Task_Model","Task_RegisterPlm","Task_ReviewDrawing","Task_PaperControl"};
            await File.WriteAllTextAsync(Path.Combine(data,"source.bpmn"),template.Replace("demo-showcase-l4-drawing","source"));
            async Task Context(string id,bool binding=false)=>await File.WriteAllTextAsync(Path.Combine(data,id+".context.json"),JsonSerializer.Serialize(new{
                version="1",status="Published",owner="Учебный",ownerLegalEntityId="org",ownerUnitId=id=="target"?"review":"author",
                elements=ids.ToDictionary(key=>key,key=>new{workDuration="1 час",informationObjects=binding&&key==(id=="target"?ids[0]:ids[^1])
                    ? new[]{new{objectId="drawing",name="Учебный чертёж",role=id=="target"?"Input":"Output",required=true}} : []})
            }));
            await Context("source");
            var bindings=new[]{new LaneOrganizationModel("Lane_Author","org","Разработка","author"),new("Lane_Reviewer","org","Проверка","review"),new("Lane_Controller","org","Контроль","control")};
            var entity=new LegalEntityModel("org","Учебная организация","",[],[
                new("author",null,"Разработка","Р","",Cal("09:00","12:00")),
                new("review",null,"Проверка","П","",Cal("13:00","17:00")),
                new("control","parent","Контроль","К",""),
                new("parent",null,"Родитель","РД","",Cal())
            ],Cal());
            var org=new OrganizationMapModel("group","Учебная группа","",[entity],[new("source",["org"],bindings,"")]);
            async Task SaveOrg(OrganizationMapModel value)=>await AtomicTextFile.WriteAsync(Path.Combine(data,"organization.json"),JsonSerializer.Serialize(value,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            await SaveOrg(org);
            var host=new Host(root);var catalog=new ProcessCatalogService(new BpmnProcessLoader(host));
            var organizations=new OrganizationMapService(host,catalog,new ProcessEditLockService());
            var service=new ProcessScheduleService(catalog,new InformationObjectRegistryService(catalog,host),organizations);
            var request=new ProcessScheduleRequestModel("source","Forward",DateTimeOffset.Parse("2026-11-09T09:00Z"),UtcOffsetMinutes:0,UseOrganizationCalendars:true);
            var result=await service.CalculateAsync(request,false);
            var item=result.Processes.Single();var steps=item.Steps!;
            Check(item.StartAt==request.AnchorDate && item.EndAt==DateTimeOffset.Parse("2026-11-09T15:00Z"),"Different lane shifts determine actual process dates");
            Check(steps.Single(s=>s.ElementId==ids[2]).StartAt.Hour==13,"Reviewer waits for its own shift");
            Check(steps.Single(s=>s.ElementId==ids[3]).CalendarSource.Contains("Родитель"),"Parent unit calendar is inherited");
            Check(result.Sources!.Algorithm==ProcessScheduleService.CalendarAlgorithm && result.Sources.Organization is not null,"Organization and calendar algorithm frozen");
            var backward=await service.CalculateAsync(request with{Direction="Backward",AnchorDate=item.EndAt},false);
            Check(backward.Processes.Single().StartAt==request.AnchorDate.AddHours(1),"Backward finds latest start across heterogeneous shifts");
            var profiles=new Dictionary<string,ScheduleCalendarModel>{{"source",Cal()}};
            var manual=await service.CalculateAsync(request with{ProcessCalendars=profiles},false);
            Check(manual.EndAt==request.AnchorDate.AddHours(4),"Manual process calendar overrides organization");
            var stepProfiles=new Dictionary<string,IReadOnlyDictionary<string,ScheduleCalendarModel>>{{"source",new Dictionary<string,ScheduleCalendarModel>{{ids[0],Cal("10:00","12:00")}}}};
            var stepResult=await service.CalculateAsync(request with{ProcessCalendars=profiles,StepCalendars=stepProfiles},false);
            Check(stepResult.StartAt==request.AnchorDate.AddHours(1) && stepResult.EndAt==request.AnchorDate.AddHours(5),"Step calendar overrides process");
            var archives=new ScheduleArchiveService(host,service);
            var archived=await archives.SaveAsync("actor",new("Учебные графики",request,result),false);
            await SaveOrg(org with{LegalEntities=[entity with{Calendar=Cal("18:00","23:00"),Units=entity.Units!.Select(u=>u with{Calendar=null}).ToArray()}]});
            var replay=await service.ReplayAsync(request,result.Sources);
            Check(replay.EndAt==result.EndAt,"Replay uses frozen org calendar, not edited current graph");
            Check((await archives.CheckAsync("actor",archived.Id,false)).Status=="Changed","Archive freshness detects organization/calendar change");
            await SaveOrg(org);
            await Reject(()=>service.CalculateAsync(request with{StepCalendars=new Dictionary<string,IReadOnlyDictionary<string,ScheduleCalendarModel>>{{"source",new Dictionary<string,ScheduleCalendarModel>{{"missing",Cal()}}}}},false));
            await Reject(()=>service.CalculateAsync(request with{StepCalendars=new Dictionary<string,IReadOnlyDictionary<string,ScheduleCalendarModel>>{{"missing",new Dictionary<string,ScheduleCalendarModel>{{ids[0],Cal()}}}}},false));
            await Reject(()=>service.CalculateAsync(request with{ProcessRepetitions=new Dictionary<string,ScheduleRepetitionModel>{{"source",new("bad",1,2)}}},false));
            var legacy=await service.CalculateAsync(request with{UseOrganizationCalendars=false},false);
            Check(legacy.Sources!.Algorithm==ProcessScheduleService.Algorithm && legacy.Processes.Single().Steps is null,"Legacy scenario stays on legacy algorithm");
            await Reject(()=>service.ReplayAsync(request,legacy.Sources));
            await Reject(()=>service.ReplayAsync(request,result.Sources with{Organization=null}));
            var invalidOrg=org with{LegalEntities=[entity with{Calendar=Cal(zone:"invalid-time-zone")}]};
            await Reject(async()=>await organizations.SaveAsync(invalidOrg with{Revision=(await organizations.LoadAsync()).Revision}));
            await Context("source",true);await Context("target",true);
            await File.WriteAllTextAsync(Path.Combine(data,"target.bpmn"),template.Replace("demo-showcase-l4-drawing","target"));
            await SaveOrg(org with{CrossCompanyProcesses=[..org.CrossCompanyProcesses,new("target",["org"],bindings.Select(b=>b with{UnitId="review"}).ToArray(),"")]});
            var chain=await service.CalculateAsync(request with{TransferDelayHours=1},false);
            var target=chain.Processes.Single(p=>p.ProcessId=="target");
            Check(target.EndAt==DateTimeOffset.Parse("2026-11-10T16:00Z"),"Transfer delay and target tasks use receiver calendar");
            var reverse=await service.CalculateAsync(request with{RootProcessId="target",Direction="Backward",AnchorDate=target.EndAt,TransferDelayHours=1},false);
            Check(reverse.Processes.Single(p=>p.ProcessId=="source").EndAt==item.EndAt,"Reverse transfer uses receiver owner calendar");
        }
        finally
        {
            var path=Path.GetFullPath(root);var allowed=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(!path.StartsWith(allowed,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(path).StartsWith("pn-org-calendar-"))throw new Exception("Unsafe calendar cleanup");
            Directory.Delete(path,true);
        }
        return count;
    }
    private sealed class Host(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="OrgCalendarChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public string WebRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
