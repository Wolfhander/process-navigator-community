using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessTableService
{
    private static string ReferenceHash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public async Task<TableReferenceReport> ReferencesAsync(IFormFile file,InformationObjectRegistryService registry,bool includeDrafts,CancellationToken ct=default)
    {
        var workbook=await LoadWorkbookAsync(file,ct);
        if(RequiredSheets.Any(s=>!workbook.ContainsKey(s)))throw new InvalidDataException("Нужны листы Процессы, Шаги и Каналы штатного шаблона.");
        var choices=new List<TableReferenceChoice>();var organization=await organizations.LoadAsync(ct);
        foreach(var entity in organization.LegalEntities)
        {
            choices.Add(new("entity",entity.Id,entity.Name));
            choices.AddRange((entity.Units??[]).Select(u=>new TableReferenceChoice("unit",u.Id,u.Name,entity.Id)));
        }
        choices.AddRange(access.Users().Where(u=>u.IsActive).Select(u=>new TableReferenceChoice("user",u.Id,u.DisplayName)));
        var summaries=await catalog.ListAsync(ct);
        if(summaries.Count>200)throw new InvalidDataException("Разбор ограничен каталогом до 200 моделей; данные не усекались.");
        var systems=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var summary in summaries)
        {
            if(!includeDrafts&&summary.Status=="Draft")continue;
            var model=await catalog.LoadAsync(summary.Id,includeDrafts&&(summary.HasDraft||summary.Status=="Draft"),ct);
            foreach(var node in model.Nodes)
                foreach(var value in new[]{node.SystemName}.Concat((node.Channels??[]).Select(c=>c.SystemName)))
                    if(!string.IsNullOrWhiteSpace(value))systems.Add(value.Trim());
        }
        choices.AddRange(systems.Select(s=>new TableReferenceChoice("system",s,s)));
        var objects=(await registry.BuildAsync(includeDrafts,ct)).Objects;
        choices.AddRange(objects.Select(o=>new TableReferenceChoice("object",o.Id,o.Name)));
        choices.AddRange(objects.Select(o=>new TableReferenceChoice("document",o.Id,o.Name)));
        if(choices.Count>5000)throw new InvalidDataException("Справочники превышают 5000 значений; разбор не выполнен без усечения.");
        choices=choices.OrderBy(c=>c.Kind,StringComparer.Ordinal).ThenBy(c=>c.Scope,StringComparer.Ordinal).ThenBy(c=>c.Id,StringComparer.Ordinal).ToList();
        var groups=new Dictionary<string,(string Kind,string Value,string Scope,List<TableReferenceCell> Cells)>();var occurrences=0;
        foreach(var sheet in RequiredSheets)
        foreach(var row in ReadRows(workbook[sheet]))
        {
            var entityColumn=sheet=="Процессы"?"Организация-владелец ID":"Организация ID";
            var unitColumn=sheet=="Процессы"?"Подразделение-владелец ID":"Подразделение ID";
            if(sheet!="Каналы"){Scan("entity",entityColumn);Scan("unit",unitColumn,row.Get(entityColumn));}
            if(sheet=="Шаги"){Scan("user","Сотрудники ID",multiple:true);Scan("object","Объекты реестра ID",multiple:true);Scan("system","Система выполнения");}
            if(sheet=="Каналы"){Scan("system","Система");Scan("document","Документ");}
            void Scan(string kind,string header,string scope="",bool multiple=false)
            {
                if(!row.Has(header)||string.IsNullOrWhiteSpace(row.Get(header)))return;
                var values=multiple?Split(row.Get(header),preserveEmpty:true):new[]{row.Get(header)};
                var column=workbook[sheet].Elements("row").First(e=>(int?)e.Attribute("number")==3).Elements("cell").Single(e=>e.Value.Trim()==header).Attribute("column")!.Value;
                for(var token=0;token<values.Count;token++)
                {
                    var value=values[token];if(string.IsNullOrWhiteSpace(value))continue;
                    var known=kind=="document"?objects.Any(o=>o.Name.Equals(value,StringComparison.OrdinalIgnoreCase)||(o.Aliases??[]).Contains(value,StringComparer.OrdinalIgnoreCase)):
                        choices.Any(c=>c.Kind==kind&&c.Id.Equals(value,StringComparison.OrdinalIgnoreCase)&&(kind!="unit"||c.Scope.Equals(scope,StringComparison.OrdinalIgnoreCase)));
                    if(known)continue;
                    if(++occurrences>10000)throw new InvalidDataException("Более 10000 несопоставленных ячеек; разбор не усечён и не применён.");
                    var key=ReferenceHash(JsonSerializer.SerializeToUtf8Bytes(new{kind,scope,value}));
                    if(!groups.TryGetValue(key,out var item)){if(groups.Count>=2000)throw new InvalidDataException("Более 2000 групп; разбор не применён.");item=(kind,value,scope,[]);groups.Add(key,item);}
                    var related=kind=="object"?workbook[sheet].Elements("row").First(e=>(int?)e.Attribute("number")==3).Elements("cell").FirstOrDefault(e=>e.Value.Trim()=="Объекты реестра — названия")?.Attribute("column")?.Value:null;
                    item.Cells.Add(new(sheet,row.Number,header,column+row.Number,token,row.Get("ID процесса"),row.Get("ID шага"),related is null?null:related+row.Number));
                }
            }
        }
        await using var stream=file.OpenReadStream();using var memory=new MemoryStream();await stream.CopyToAsync(memory,ct);
        var fingerprint=ReferenceHash(JsonSerializer.SerializeToUtf8Bytes(new{file=ReferenceHash(memory.ToArray()),includeDrafts,choices}));
        return new(fingerprint,choices,groups.Select(g=>new TableReferenceGroup(g.Key,g.Value.Kind,g.Value.Value,g.Value.Scope,g.Value.Kind is "system" or "object" or "document",g.Value.Cells)).ToArray());
    }
    public async Task<byte[]> ResolveReferencesAsync(IFormFile file,TableReferenceResolution resolution,InformationObjectRegistryService registry,bool includeDrafts,CancellationToken ct=default)
    {
        var report=await ReferencesAsync(file,registry,includeDrafts,ct);
        if(report.Fingerprint!=resolution.Fingerprint)throw new InvalidDataException("Книга или справочники изменились. Повторите разбор.");
        if(resolution.Rules is null||resolution.Rules.Count is <1 or >2000||resolution.Rules.Any(r=>r is null)||resolution.Rules.Select(r=>r.GroupId).Distinct().Count()!=resolution.Rules.Count)
            throw new InvalidDataException("Выберите неповторяющиеся решения.");
        var edits=new List<(TableReferenceCell Cell,string Value,string? ObjectName)>();
        foreach(var rule in resolution.Rules)
        {
            var group=report.Groups.SingleOrDefault(g=>g.Id==rule.GroupId)??throw new InvalidDataException("Группа больше не найдена.");
            if(rule.KeepNew){if(!group.CanKeep||!string.IsNullOrEmpty(rule.TargetId))throw new InvalidDataException("Это значение нельзя оставить новым.");continue;}
            var choice=report.Choices.SingleOrDefault(c=>c.Kind==group.Kind&&c.Id==rule.TargetId&&(group.Kind!="unit"||c.Scope.Equals(group.Scope,StringComparison.OrdinalIgnoreCase)))
                ??throw new InvalidDataException("Цель не найдена или подразделение относится к другой организации.");
            if(group.Kind=="object"&&choice.Name.Contains('|'))throw new InvalidDataException("Название выбранного объекта содержит разделитель списка |. Исправьте его отдельно.");
            edits.AddRange(group.Cells.Select(c=>(c,group.Kind=="document"?choice.Name:choice.Id,group.Kind=="object"?choice.Name:null)));
        }
        using var memory=new MemoryStream();await using(var input=file.OpenReadStream())await input.CopyToAsync(memory,ct);memory.Position=0;
        using(var archive=new ZipArchive(memory,ZipArchiveMode.Update,true))
        {
            if(archive.Entries.GroupBy(e=>e.FullName,StringComparer.OrdinalIgnoreCase).Any(g=>g.Count()>1)||archive.Entries.Any(e=>e.FullName.StartsWith("_xmlsignatures/",StringComparison.OrdinalIgnoreCase))||
                ReadXml(archive,"[Content_Types].xml").Descendants().Attributes("ContentType").Any(a=>a.Value.Contains("digital-signature",StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Книга имеет повторные части или цифровую подпись. Исправьте её отдельно.");
            XNamespace main="http://schemas.openxmlformats.org/spreadsheetml/2006/main",rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            var workbook=ReadXml(archive,"xl/workbook.xml");var links=ReadXml(archive,"xl/_rels/workbook.xml.rels").Root!.Elements().ToDictionary(e=>(string)e.Attribute("Id")!,e=>(string)e.Attribute("Target")!);
            var paths=workbook.Descendants(main+"sheet").ToDictionary(e=>(string)e.Attribute("name")!,e=>links[(string)e.Attribute(rel+"id")!].Replace('\\','/').TrimStart('/'));
            foreach(var group in edits.GroupBy(e=>e.Cell.Sheet))
            {
                var path=paths[group.Key];if(!path.StartsWith("xl/",StringComparison.OrdinalIgnoreCase))path="xl/"+path;
                var xml=ReadXml(archive,path);var expanded=ReadWorkbook(archive)[group.Key];
                var cellIndex=xml.Descendants(main+"c").GroupBy(c=>(string?)c.Attribute("r")??"",StringComparer.OrdinalIgnoreCase).ToDictionary(g=>g.Key,g=>g.ToArray(),StringComparer.OrdinalIgnoreCase);
                var objectNameColumn=expanded.Elements("row").First(r=>(int?)r.Attribute("number")==3).Elements("cell").FirstOrDefault(c=>c.Value.Trim()=="Объекты реестра — названия")?.Attribute("column")?.Value;
                foreach(var edit in group)
                {
                    Set(edit.Cell.Cell,edit.Value,edit.Cell.Column is "Сотрудники ID" or "Объекты реестра ID"?edit.Cell.Token:null);
                    if(edit.ObjectName is not null)
                    {
                        if(objectNameColumn is null)throw new InvalidDataException("Нет колонки названий объектов.");
                        Set(objectNameColumn+edit.Cell.Row,edit.ObjectName,edit.Cell.Token);
                    }
                }
                ReplaceXml(archive,path,xml);
                void Set(string reference,string value,int? token)
                {
                    var cells=cellIndex.GetValueOrDefault(reference,[]);
                    if(cells.Length!=1||cells[0].Element(main+"f") is not null)throw new InvalidDataException("Ячейка отсутствует, повторяется или содержит формулу: "+reference);
                    var cell=cells[0];
                    if(token is not null)
                    {
                        var raw=ExpandCells(new XDocument(new XElement(main+"worksheet",new XElement(main+"sheetData",new XElement(main+"row",new XAttribute("r",1),new XElement(cell))))),ReadSharedStrings(archive)).Descendants("cell").Single().Value;
                        var values=Split(raw,preserveEmpty:true).ToArray();
                        if(token>=values.Length)throw new InvalidDataException("Не совпадает позиция значения в списке.");
                        values[token.Value]=value;value=string.Join(" | ",values);
                    }
                    cell.RemoveNodes();cell.SetAttributeValue("t","inlineStr");cell.Add(new XElement(main+"is",new XElement(main+"t",new XAttribute(XNamespace.Xml+"space","preserve"),value)));
                }
            }
            var calc=workbook.Root!.Element(main+"calcPr");
            if(calc is null)
            {
                calc=new XElement(main+"calcPr");
                var following=workbook.Root.Elements().FirstOrDefault(e=>new[]{"oleSize","customWorkbookViews","pivotCaches","smartTagPr","smartTagTypes","webPublishing","fileRecoveryPr","webPublishObjects","extLst"}.Contains(e.Name.LocalName));
                if(following is null)workbook.Root.Add(calc);else following.AddBeforeSelf(calc);
            }
            calc.SetAttributeValue("fullCalcOnLoad",1);
            ReplaceXml(archive,"xl/workbook.xml",workbook);
        }
        if(memory.Length>MaximumFileSize)throw new InvalidDataException("Исправленная копия превышает 10 МБ. Сократите книгу.");
        // Recheck the dictionary snapshot before returning; nothing has been written into application data.
        if((await ReferencesAsync(file,registry,includeDrafts,ct)).Fingerprint!=report.Fingerprint)throw new InvalidDataException("Справочники изменились во время исправления. Повторите разбор.");
        return memory.ToArray();
    }
}
