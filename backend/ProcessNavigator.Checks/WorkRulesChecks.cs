using System.Text.Json;
using System.Reflection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class WorkRulesChecks
{
    public static async Task<int> RunAsync()
    {
        var count=0;
        void Check(bool value,string label){if(!value)throw new Exception(label);count++;}
        void Reject(IReadOnlyList<StepWorkRuleModel> rules)
        {
            var rejected=false;
            try{StepWorkRuleValidation.Normalize(rules);}catch(InvalidDataException){rejected=true;}
            Check(rejected,"Invalid work rules must be rejected");
        }
        Check(StepWorkRuleValidation.Normalize(null) is null,"Omitted field remains omitted");
        Check(StepWorkRuleValidation.Normalize([])!.Count==0,"Explicit empty list clears rules");
        Reject([new("unknown")]);Reject([null!]);Reject([new("document",ObjectId:"d")]);
        Reject([new("exception",Condition:"Если")]);Reject([new("document","d","Подписан",Response:"Не то поле")]);
        Reject([new("exception",ObjectId:"d",Condition:"Нет файла",Response:"Уточнить")]);
        Reject(Enumerable.Repeat(new StepWorkRuleModel("exception",Condition:"x",Response:"y"),41).ToArray());
        Reject([new("document","d",new string('x',201))]);
        var rules=StepWorkRuleValidation.Normalize([new("document"," d "," Подписан ",Condition:"При поставке"),new("exception",Condition:"Нет подписи",Response:"Вернуть автору",Responsible:"Владелец")])!;
        Check(rules[0].ObjectId=="d"&&rules[0].RequiredState=="Подписан","Normalization trims without interpreting state");
        var parse=typeof(ProcessTableService).GetMethod("ParseWorkRules",BindingFlags.NonPublic|BindingFlags.Static)!;
        var json=JsonSerializer.Serialize(rules,new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var parsed=(IReadOnlyList<StepWorkRuleModel>)parse.Invoke(null,[json])!;
        Check(parsed.SequenceEqual(rules),"Workbook JSON round trips all rule fields");
        Check(((IReadOnlyList<StepWorkRuleModel>)parse.Invoke(null,[""])!).Count==0,"Blank cell clears rules");
        foreach(var bad in new[]{"null","{}", "[null]","[{\"kind\":\"bad\"}]","[{\"kind\":\"document\",\"objectId\":\"d\",\"requiredState\":\"Подписан\",\"typo\":\"unknown\"}]"})
        {
            var rejected=false;try{parse.Invoke(null,[bad]);}catch(TargetInvocationException error)when(error.InnerException is JsonException or InvalidDataException){rejected=true;}
            Check(rejected,"Invalid workbook rule cell must fail validation");
        }
        var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root=Path.Combine(temp,"pn-work-rules-"+Guid.NewGuid().ToString("N"));
        var directory=Path.Combine(root,"Data","Drafts");Directory.CreateDirectory(directory);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(directory,"rules.bpmn"),"""
              <b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"><b:process id="rules"><b:laneSet id="ls"><b:lane id="lane"><b:flowNodeRef>step</b:flowNodeRef></b:lane></b:laneSet><b:task id="step" name="Шаг"/></b:process><bi:BPMNDiagram id="diagram"><bi:BPMNPlane id="plane" bpmnElement="rules"><bi:BPMNShape id="lane_shape" bpmnElement="lane"><dc:Bounds x="0" y="0" width="500" height="200"/></bi:BPMNShape><bi:BPMNShape id="shape" bpmnElement="step"><dc:Bounds x="10" y="10" width="120" height="80"/></bi:BPMNShape></bi:BPMNPlane></bi:BPMNDiagram></b:definitions>
              """);
            var contextPath=Path.Combine(directory,"rules.context.json");
            await File.WriteAllTextAsync(contextPath,"""{"name":"Тест","version":"0.1","owner":"Демо","status":"Draft","elements":{"step":{"informationObjects":[{"objectId":"d","name":"Документ","role":"Input"}]}}}""");
            var loader=new BpmnProcessLoader(new Environment(root));
            var catalog=new ProcessCatalogService(loader);
            var update=new ElementContextUpdateModel(null,null,null,[],[],InformationObjects:[new("d","Документ","Input")],WorkRules:rules);
            var saved=await catalog.SaveDraftElementContextAsync("rules","step",update);
            Check(saved.WorkRules!.SequenceEqual(rules),"Saving rules returns all fields");
            var loaded=await loader.LoadFilesAsync(Path.Combine(directory,"rules.bpmn"),contextPath,"rules");
            Check(loaded.Nodes.Single().WorkRules!.SequenceEqual(rules),"Rules survive reload of BPMN/context");
            var rowType=typeof(ProcessTableService).GetNestedType("SheetRow",BindingFlags.NonPublic)!;
            object Row(Dictionary<string,string> values)=>Activator.CreateInstance(rowType,["Шаги",5,values])!;
            var processValues=new Dictionary<string,string>{{"ID процесса","rules"},{"Название","Правила"},{"Уровень","0"},{"Организация-владелец ID","e"},{"Подразделение-владелец ID","u"}};
            var stepValues=new Dictionary<string,string>{{"ID процесса","rules"},{"ID шага","step"},{"Тип","task"},{"Название","Шаг"},{"Дорожка ID","lane"},{"Организация ID","e"},{"Подразделение ID","u"}};
            var organization=new OrganizationMapModel("org","Демо","", [new("e","Организация","",[],[new("u",null,"Подразделение","П","")])],[]);
            var generate=typeof(ProcessTableService).GetMethod("Generate",BindingFlags.NonPublic|BindingFlags.Static)!;
            string GenerateContext(Dictionary<string,string> values)
            {
                var array=Array.CreateInstance(rowType,1);array.SetValue(Row(values),0);
                var generated=generate.Invoke(null,[Row(processValues),array,Array.CreateInstance(rowType,0),organization,loaded])!;
                return (string)generated.GetType().GetProperty("Context")!.GetValue(generated)!;
            }
            var legacyContext=JsonDocument.Parse(GenerateContext(stepValues));
            Check(legacyContext.RootElement.GetProperty("elements").GetProperty("step").GetProperty("workRules").GetArrayLength()==2,"Old workbook without new column preserves existing rules");
            var modern=new Dictionary<string,string>(stepValues){{"Правила работы JSON",json}};
            Check(JsonDocument.Parse(GenerateContext(modern)).RootElement.GetProperty("elements").GetProperty("step").GetProperty("workRules")[0].GetProperty("requiredState").GetString()=="Подписан","Workbook generation retains structured state");
            modern["Правила работы JSON"]="";
            Check(JsonDocument.Parse(GenerateContext(modern)).RootElement.GetProperty("elements").GetProperty("step").GetProperty("workRules").GetArrayLength()==0,"Blank modern workbook cell explicitly clears rules");
            var template=Path.Combine(Directory.GetCurrentDirectory(),"backend","ProcessNavigator.Api","Data","Templates","process-table-template.xlsx");
            var export=typeof(ProcessTableService).GetMethod("BuildExportWorkbookAsync",BindingFlags.NonPublic|BindingFlags.Static)!;
            IReadOnlyList<IReadOnlyList<object?>> empty=[];
            var cells=new object?[32];cells[1]="rules";cells[3]="step";cells[4]="task";cells[31]=json;
            IReadOnlyList<IReadOnlyList<object?>> rows=[cells];
            var bytes=await (Task<byte[]>)export.Invoke(null,[template,empty,rows,empty,organization,CancellationToken.None,null,null])!;
            using(var stream=new MemoryStream(bytes))
            using(var zip=new System.IO.Compression.ZipArchive(stream))
            using(var sheet=zip.GetEntry("xl/worksheets/sheet3.xml")!.Open())
            {
                var xml=System.Xml.Linq.XDocument.Load(sheet);
                System.Xml.Linq.XNamespace ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
                Check(xml.Descendants(ns+"v").Any(text=>text.Value=="Правила работы JSON"),"XLSX exposes the new optional column");
                var stored=xml.Descendants(ns+"c").Where(cell=>((string?)cell.Attribute("r"))?.StartsWith("AF")==true).Select(cell=>(string?)cell.Element(ns+"v")??"").Single(text=>text==json);
                Check(((IReadOnlyList<StepWorkRuleModel>)parse.Invoke(null,[stored])!).SequenceEqual(rules),"XLSX cell round trips all rules without loss");
            }
            var oldClient=await catalog.SaveDraftElementContextAsync("rules","step",update with{WorkRules=null,Description="Старый клиент"});
            Check(oldClient.WorkRules!.SequenceEqual(rules),"Omission by old client preserves rules");
            var before=await File.ReadAllTextAsync(contextPath);
            var rejected=false;try{await catalog.SaveDraftElementContextAsync("rules","step",update with{InformationObjects=[]});}catch(InvalidDataException){rejected=true;}
            Check(rejected&&before==await File.ReadAllTextAsync(contextPath),"Invalid document reference leaves original file unchanged");
            var cleared=await catalog.SaveDraftElementContextAsync("rules","step",update with{WorkRules=[]});
            Check(cleared.WorkRules!.Count==0,"Explicit clear is persisted");
        }
        finally
        {
            if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-work-rules-"))throw new Exception("Unsafe fixture cleanup");
            Directory.Delete(root,true);
        }
        return count;
    }
    private sealed class Environment(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="WorkRulesChecks";
        public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;
        public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
