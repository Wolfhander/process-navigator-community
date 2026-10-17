using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessTableService(
    ProcessCatalogService catalog,
    OrganizationMapService organizations,
    RepositoryBackupService backups,
    ProcessAssignmentService assignments,
    AccessControlService access,
    ProcessEditLockService editLocks,
    BpmnProcessLoader loader,
    ProcessTableImportHistoryService importHistory)
{
    private const long MaximumFileSize = 10 * 1024 * 1024;
    private const long MaximumExpandedSize = 50 * 1024 * 1024;
    private const int MaximumEntries = 500;
    private static readonly string[] RequiredSheets = ["Процессы", "Шаги", "Каналы"];
    private static readonly string[] EvidenceHeaders = ["Статус заполнения", "ID процесса", "ID шага", "Статус сведений", "Содержание", "Источник", "Место в источнике", "Автор сведений"];
    private static readonly string[] RequirementHeaders = ["Статус заполнения", "ID процесса", "ID пункта", "Содержание", "Источник", "Место в источнике", "Элементы схемы ID", "Проверять маршрут"];
    private static readonly HashSet<string> ElementTypes = new(StringComparer.OrdinalIgnoreCase) { "startEvent", "endEvent", "task", "exclusiveGateway", "parallelGateway" };
    private static readonly HashSet<string> TaskTypes = new(StringComparer.Ordinal) { "task", "userTask", "manualTask", "serviceTask", "sendTask", "receiveTask", "businessRuleTask" };
    private static readonly HashSet<string> Classifications = new(StringComparer.OrdinalIgnoreCase) { "Основной", "Управляющий", "Обеспечивающий", "Обслуживающий" };
    private static readonly HashSet<string> ChannelKinds = new(StringComparer.OrdinalIgnoreCase) { "system", "email", "paper", "phone", "memo", "meeting", "other" };
    private static readonly HashSet<string> ChannelFlows = new(StringComparer.OrdinalIgnoreCase) { "primary", "alternative", "parallel" };
    private static readonly HashSet<string> ChannelDirections = new(StringComparer.OrdinalIgnoreCase) { "input", "work", "output" };
    private static readonly string[] StepHeaders = ["Статус заполнения", "ID процесса", "Порядок", "ID шага", "Тип", "Название",
        "Дорожка ID", "Организация ID", "Подразделение ID", "Сотрудники ID", "Ответственный", "Описание", "Входы",
        "Ожидаемый результат", "Критерий завершения", "Работа", "Ожидание", "Связанный процесс ID", "Следующие шаги",
        "Условия переходов", "Объекты реестра ID", "Объекты реестра — названия", "Роли объектов", "Обязательность объектов",
        "Версии объектов", "Условия объектов", "Тип BPMN", "Способ выполнения", "Система выполнения", "Инструкция", "Исполнитель действия"];

    public async Task<ProcessTablePreviewModel> PreviewAsync(IFormFile file, CancellationToken cancellationToken = default)
    {
        var workbook = await LoadWorkbookAsync(file, cancellationToken);
        var issues = new List<ProcessTableIssueModel>();
        foreach (var sheet in RequiredSheets.Where(sheet => !workbook.ContainsKey(sheet)))
            issues.Add(new("Error", sheet, 0, null, $"В книге отсутствует обязательный лист «{sheet}»."));
        if (issues.Count > 0) return Build(file.FileName, [], [], [], [], issues,
            new Dictionary<string, ProcessTableChangeSummary>(StringComparer.OrdinalIgnoreCase));

        var catalogItems = await catalog.ListAsync(cancellationToken);
        var catalogIds = catalogItems.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var organization = await organizations.LoadAsync(cancellationToken);
        var entities = organization.LegalEntities.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var units = organization.LegalEntities.SelectMany(entity => (entity.Units ?? []).Select(unit => (entity.Id, Unit: unit)))
            .ToLookup(item => item.Unit.Id, StringComparer.OrdinalIgnoreCase);

        var processRows = ReadRows(workbook["Процессы"]);
        processRows = AttachRequirements(workbook, processRows, ReadRows(workbook["Шаги"]), issues);
        var stepRows = ReadRows(workbook["Шаги"]);
        stepRows = AttachEvidence(workbook, stepRows, issues);
        var channelRows = ReadRows(workbook["Каналы"]);
        var knownUserIds = access.Users().Where(user => user.IsActive).Select(user => user.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var processes = new List<TableProcess>();
        var processIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in processRows)
        {
            var id = row.Get("ID процесса"); var name = row.Get("Название"); var levelText = row.Get("Уровень");
            var item = new TableProcess(id, name, ParseInteger(levelText)); processes.Add(item);
            if (string.IsNullOrWhiteSpace(id)) Add("Error", row, "ID процесса", "Укажите ID процесса.");
            else if (!TechnicalId().IsMatch(id)) Add("Error", row, "ID процесса", "ID может содержать латинские буквы, цифры, точку, дефис и подчёркивание.", id);
            else if (!processIds.Add(id)) Add("Error", row, "ID процесса", "ID процесса повторяется в книге.", id);
            if (string.IsNullOrWhiteSpace(name)) Add("Error", row, "Название", "Укажите название процесса.", id);
            if (item.Level is null or < 0 or > 20) Add("Error", row, "Уровень", "Уровень должен быть целым числом от 0 до 20.", id);
            var parent = row.Get("Родительский процесс");
            if (item.Level > 0 && string.IsNullOrWhiteSpace(parent)) Add("Error", row, "Родительский процесс", "Для уровня выше 0 укажите родительский процесс.", id);
            if (id.Equals(parent, StringComparison.OrdinalIgnoreCase)) Add("Error", row, "Родительский процесс", "Процесс не может быть родителем самому себе.", id);
            var classification = row.Get("Классификация");
            if (!string.IsNullOrWhiteSpace(classification) && !Classifications.Contains(classification)) Add("Warning", row, "Классификация", "Классификация не совпадает с системным справочником.", id);
            if (string.IsNullOrWhiteSpace(row.Get("Организация-владелец ID")) || string.IsNullOrWhiteSpace(row.Get("Подразделение-владелец ID")))
                Add("Error", row, "Подразделение-владелец ID", "Укажите организацию и подразделение-владельца процесса.", id);
            ValidateOrganization(row, "Организация-владелец ID", "Подразделение-владелец ID", id);
            if (string.IsNullOrWhiteSpace(row.Get("Триггер"))) Add("Warning", row, "Триггер", "Не заполнено инициирующее событие процесса.", id);
            if (string.IsNullOrWhiteSpace(row.Get("Результат"))) Add("Warning", row, "Результат", "Не заполнен результат процесса.", id);
        }

        var knownProcessIds = catalogIds.Concat(processIds).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var row in processRows)
        {
            var id = row.Get("ID процесса"); var parent = row.Get("Родительский процесс");
            if (!string.IsNullOrWhiteSpace(parent) && !knownProcessIds.Contains(parent)) Add("Error", row, "Родительский процесс", $"Родительский процесс «{parent}» не найден.", id);
        }

        var steps = new List<TableStep>();
        var stepKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in stepRows)
        {
            var processId = row.Get("ID процесса"); var stepId = row.Get("ID шага"); var type = row.Get("Тип");
            var step = new TableStep(processId, stepId); steps.Add(step);
            if (!processIds.Contains(processId)) Add("Error", row, "ID процесса", "Для шага нет строки процесса на листе «Процессы».", processId, stepId);
            if (string.IsNullOrWhiteSpace(stepId)) Add("Error", row, "ID шага", "Укажите ID шага.", processId);
            else if (!TechnicalId().IsMatch(stepId)) Add("Error", row, "ID шага", "ID шага имеет недопустимый формат.", processId, stepId);
            else if (!stepKeys.Add($"{processId}\u001f{stepId}")) Add("Error", row, "ID шага", "ID шага повторяется внутри процесса.", processId, stepId);
            if (!ElementTypes.Contains(type)) Add("Error", row, "Тип", "Допустимы startEvent, endEvent, task, exclusiveGateway и parallelGateway.", processId, stepId);
            var bpmnType = row.Get("Тип BPMN");
            if (!string.IsNullOrEmpty(bpmnType) && !(type == "task" ? TaskTypes.Contains(bpmnType) : bpmnType == type))
                Add("Error", row, "Тип BPMN", "Подтип BPMN не поддерживается или не соответствует общему типу элемента.", processId, stepId);
            if (row.Get("Способ выполнения") is not ("" or "manual" or "external" or "system"))
                Add("Error", row, "Способ выполнения", "Укажите manual, external или system либо оставьте поле пустым.", processId, stepId);
            if (row.Get("Исполнитель действия") is not ("" or "human" or "system"))
                Add("Error", row, "Исполнитель действия", "Укажите human или system либо оставьте поле пустым для определения по типу BPMN.", processId, stepId);
            if (row.Get("Исполнитель действия") == "system" && string.IsNullOrWhiteSpace(row.Get("Система выполнения")))
                Add("Warning", row, "Система выполнения", "Для системного исполнителя укажите название системы.", processId, stepId);
            if ((bpmnType == "serviceTask" && row.Get("Исполнитель действия") == "human") || (bpmnType is "manualTask" or "userTask" && row.Get("Исполнитель действия") == "system"))
                Add("Warning", row, "Исполнитель действия", "Исполнитель не соответствует типу BPMN. Проверьте тип блока или исполнителя.", processId, stepId);
            if (row.Get("Система выполнения").Length > 200) Add("Error", row, "Система выполнения", "Название системы не должно превышать 200 символов.", processId, stepId);
            if (row.Get("Инструкция").Length > 6000) Add("Error", row, "Инструкция", "Инструкция не должна превышать 6000 символов.", processId, stepId);
            if (string.IsNullOrWhiteSpace(row.Get("Название"))) Add("Error", row, "Название", "Укажите название шага.", processId, stepId);
            if (string.IsNullOrWhiteSpace(row.Get("Дорожка ID"))) Add("Error", row, "Дорожка ID", "Укажите ID дорожки.", processId, stepId);
            var order = ParseInteger(row.Get("Порядок"));
            if (order is null or < 1) Add("Error", row, "Порядок", "Порядок должен быть положительным целым числом.", processId, stepId);
            foreach (var userId in Split(row.Get("Сотрудники ID")).Where(userId => !knownUserIds.Contains(userId)))
                Add("Error", row, "Сотрудники ID", $"Пользователь «{userId}» не найден или отключён.", processId, stepId);
            if (type.Equals("task", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(row.Get("Ожидаемый результат")))
                Add("Warning", row, "Ожидаемый результат", "Для действия не заполнен ожидаемый результат.", processId, stepId);
            if (!type.Equals("startEvent", StringComparison.OrdinalIgnoreCase) && !type.Equals("endEvent", StringComparison.OrdinalIgnoreCase))
                ValidateOrganization(row, "Организация ID", "Подразделение ID", processId, stepId, warningWhenBlank: true);
            var linked = row.Get("Связанный процесс ID");
            if (!string.IsNullOrWhiteSpace(linked) && !knownProcessIds.Contains(linked)) Add("Error", row, "Связанный процесс ID", $"Связанный процесс «{linked}» не найден.", processId, stepId);
            var objectIds = Split(row.Get("Объекты реестра ID"), preserveEmpty: true);
            var objectNames = Split(row.Get("Объекты реестра — названия"), preserveEmpty: true);
            var objectRoles = Split(row.Get("Роли объектов"), preserveEmpty: true);
            var objectRequired = Split(row.Get("Обязательность объектов"), preserveEmpty: true);
            var objectVersions = string.IsNullOrWhiteSpace(row.Get("Версии объектов")) ? Enumerable.Repeat("", objectIds.Count).ToArray() : Split(row.Get("Версии объектов"), preserveEmpty: true);
            var objectConditions = string.IsNullOrWhiteSpace(row.Get("Условия объектов")) ? Enumerable.Repeat("", objectIds.Count).ToArray() : Split(row.Get("Условия объектов"), preserveEmpty: true);
            var objectColumnCounts = new[] { objectNames.Count, objectRoles.Count, objectRequired.Count, objectVersions.Count, objectConditions.Count };
            if (objectColumnCounts.Any(count => count != objectIds.Count))
                Add("Error", row, "Объекты реестра ID", "Количество значений в шести колонках объектов реестра должно совпадать.", processId, stepId);
            for (var objectIndex = 0; objectIndex < objectIds.Count; objectIndex++)
            {
                if (string.IsNullOrWhiteSpace(objectIds[objectIndex])) Add("Error", row, "Объекты реестра ID", $"Для объекта {objectIndex + 1} не указан ID.", processId, stepId);
                else if (!TechnicalId().IsMatch(objectIds[objectIndex])) Add("Error", row, "Объекты реестра ID", $"ID объекта «{objectIds[objectIndex]}» имеет недопустимый формат.", processId, stepId);
                if (objectIndex >= objectNames.Count || string.IsNullOrWhiteSpace(objectNames[objectIndex])) Add("Error", row, "Объекты реестра — названия", $"Для объекта {objectIndex + 1} не указано название.", processId, stepId);
                if (objectIndex >= objectRoles.Count || objectRoles[objectIndex] is not ("Input" or "Output" or "Reference")) Add("Error", row, "Роли объектов", $"Для объекта {objectIndex + 1} укажите Input, Output или Reference.", processId, stepId);
                if (objectIndex >= objectRequired.Count || ParseRequired(objectRequired[objectIndex]) is null) Add("Error", row, "Обязательность объектов", $"Для объекта {objectIndex + 1} укажите Да или Нет.", processId, stepId);
            }
        }

        foreach (var process in processes.Where(process => !string.IsNullOrWhiteSpace(process.Id)))
        {
            var ownRows = stepRows.Where(row => row.Get("ID процесса").Equals(process.Id, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (ownRows.Count(row => row.Get("Тип").Equals("startEvent", StringComparison.OrdinalIgnoreCase)) != 1)
                issues.Add(new("Error", "Шаги", 0, "Тип", "У процесса должно быть ровно одно начальное событие.", process.Id));
            if (ownRows.Count(row => row.Get("Тип").Equals("endEvent", StringComparison.OrdinalIgnoreCase)) < 1)
                issues.Add(new("Error", "Шаги", 0, "Тип", "У процесса должно быть хотя бы одно завершающее событие.", process.Id));
            foreach (var duplicate in ownRows.GroupBy(row => row.Get("Порядок")).Where(group => !string.IsNullOrWhiteSpace(group.Key) && group.Count() > 1))
                foreach (var row in duplicate) Add("Error", row, "Порядок", $"Порядок «{duplicate.Key}» повторяется внутри процесса.", process.Id, row.Get("ID шага"));
            foreach (var lane in ownRows.GroupBy(row => row.Get("Дорожка ID"), StringComparer.OrdinalIgnoreCase).Where(group => !string.IsNullOrWhiteSpace(group.Key)))
            {
                var mappings = lane.Select(row => $"{row.Get("Организация ID")}\u001f{row.Get("Подразделение ID")}")
                    .Where(value => value != "\u001f").Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                if (mappings.Length == 0)
                    foreach (var row in lane) Add("Error", row, "Подразделение ID", "Для дорожки не задано подразделение.", process.Id, row.Get("ID шага"));
                if (mappings.Length > 1)
                    foreach (var row in lane) Add("Error", row, "Дорожка ID", "Одна дорожка не может ссылаться на разные подразделения.", process.Id, row.Get("ID шага"));
            }
        }

        foreach (var row in stepRows)
        {
            var processId = row.Get("ID процесса"); var stepId = row.Get("ID шага");
            var targets = Split(row.Get("Следующие шаги")); var conditions = Split(row.Get("Условия переходов"), preserveEmpty: true);
            foreach (var target in targets.Where(target => !stepKeys.Contains($"{processId}\u001f{target}")))
                Add("Error", row, "Следующие шаги", $"Следующий шаг «{target}» не найден в этом процессе.", processId, stepId);
            if (conditions.Count > 0 && conditions.Count != targets.Count)
                Add("Warning", row, "Условия переходов", "Количество условий не совпадает с количеством следующих шагов.", processId, stepId);
        }

        foreach (var process in processes.Where(process => !string.IsNullOrWhiteSpace(process.Id)))
        {
            var ownRows = stepRows.Where(row => row.Get("ID процесса").Equals(process.Id, StringComparison.OrdinalIgnoreCase)).ToArray();
            var uniqueRows = ownRows.GroupBy(row => row.Get("ID шага"), StringComparer.OrdinalIgnoreCase)
                .Where(group => !string.IsNullOrWhiteSpace(group.Key) && group.Count() == 1)
                .ToDictionary(group => group.Key, group => group.Single(), StringComparer.OrdinalIgnoreCase);
            var incoming = ownRows.SelectMany(row => Split(row.Get("Следующие шаги")))
                .Where(uniqueRows.ContainsKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var row in ownRows)
            {
                var id = row.Get("ID шага");
                var type = row.Get("Тип");
                var targets = Split(row.Get("Следующие шаги"));
                if (!type.Equals("startEvent", StringComparison.OrdinalIgnoreCase) && !incoming.Contains(id))
                    Add("Error", row, "ID шага", "Шаг не имеет входящего перехода и образует обрыв процесса.", process.Id, id);
                if (!type.Equals("endEvent", StringComparison.OrdinalIgnoreCase) && targets.Count == 0)
                    Add("Error", row, "Следующие шаги", "Шаг не имеет исходящего перехода и образует тупик.", process.Id, id);
                if (type.Equals("endEvent", StringComparison.OrdinalIgnoreCase) && targets.Count > 0)
                    Add("Error", row, "Следующие шаги", "Завершающее событие не должно иметь исходящих переходов.", process.Id, id);
            }

            var starts = ownRows.Where(row => row.Get("Тип").Equals("startEvent", StringComparison.OrdinalIgnoreCase)).ToArray();
            if (starts.Length == 1 && uniqueRows.Count == ownRows.Length)
            {
                var reached = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var pending = new Queue<string>();
                pending.Enqueue(starts[0].Get("ID шага"));
                while (pending.TryDequeue(out var id))
                {
                    if (!reached.Add(id)) continue;
                    foreach (var target in Split(uniqueRows[id].Get("Следующие шаги")).Where(uniqueRows.ContainsKey)) pending.Enqueue(target);
                }
                foreach (var row in ownRows.Where(row => !reached.Contains(row.Get("ID шага"))))
                    Add("Error", row, "ID шага", "Шаг недостижим из начального события.", process.Id, row.Get("ID шага"));
            }
        }

        var channels = new List<TableChannel>();
        var channelKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in channelRows)
        {
            var processId = row.Get("ID процесса"); var stepId = row.Get("ID шага"); var channelId = row.Get("ID канала");
            channels.Add(new(processId, stepId, channelId));
            if (!stepKeys.Contains($"{processId}\u001f{stepId}")) Add("Error", row, "ID шага", "Канал ссылается на отсутствующий шаг.", processId, stepId);
            if (string.IsNullOrWhiteSpace(channelId)) Add("Error", row, "ID канала", "Укажите ID канала.", processId, stepId);
            else if (!channelKeys.Add($"{processId}\u001f{stepId}\u001f{channelId}")) Add("Error", row, "ID канала", "ID канала повторяется для шага.", processId, stepId);
            var kind = row.Get("Тип канала"); var flow = row.Get("Режим"); var direction = row.Get("Направление");
            if (!ChannelKinds.Contains(kind)) Add("Error", row, "Тип канала", "Неизвестный тип канала.", processId, stepId);
            if (!ChannelFlows.Contains(flow)) Add("Error", row, "Режим", "Режим должен быть primary, alternative или parallel.", processId, stepId);
            if (!ChannelDirections.Contains(direction)) Add("Error", row, "Направление", "Направление должно быть input, work или output.", processId, stepId);
            if (string.IsNullOrWhiteSpace(row.Get("Название"))) Add("Error", row, "Название", "Укажите название канала.", processId, stepId);
            if (kind.Equals("system", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(row.Get("Система")))
                Add("Warning", row, "Система", "Для системного канала не указана информационная система.", processId, stepId);
        }

        if (processRows.Count == 0)
            issues.Add(new("Error", "Процессы", 0, null, "В таблице нет ни одного процесса."));

        var changes = await AnalyzeChangesAsync(processRows, stepRows, channelRows, catalogItems, organization, issues, cancellationToken);
        return Build(file.FileName, processes, steps, channels, catalogIds, issues, changes);

        void Add(string severity, SheetRow row, string? column, string message, string? processId = null, string? stepId = null) =>
            issues.Add(new(severity, row.Sheet, row.Number, column, message, processId, stepId));
        void ValidateOrganization(SheetRow row, string entityColumn, string unitColumn, string? processId, string? stepId = null, bool warningWhenBlank = false)
        {
            var entityId = row.Get(entityColumn); var unitId = row.Get(unitColumn);
            if (string.IsNullOrWhiteSpace(entityId) || string.IsNullOrWhiteSpace(unitId))
            {
                if (warningWhenBlank) Add("Warning", row, unitColumn, "Не заполнена привязка к подразделению.", processId, stepId);
                return;
            }
            if (!entities.TryGetValue(entityId, out var entity)) Add("Error", row, entityColumn, $"Организация «{entityId}» не найдена в оргструктуре.", processId, stepId);
            else if (!(entity.Units ?? []).Any(unit => unit.Id.Equals(unitId, StringComparison.OrdinalIgnoreCase)))
                Add("Error", row, unitColumn, $"Подразделение «{unitId}» не найдено в организации «{entity.Name}».", processId, stepId);
            else if (!units.Contains(unitId)) Add("Error", row, unitColumn, $"Подразделение «{unitId}» не найдено в оргструктуре.", processId, stepId);
        }
    }

    private async Task<IReadOnlyDictionary<string, ProcessTableChangeSummary>> AnalyzeChangesAsync(
        IReadOnlyList<SheetRow> processRows,
        IReadOnlyList<SheetRow> stepRows,
        IReadOnlyList<SheetRow> channelRows,
        IReadOnlyList<ProcessSummaryModel> catalogItems,
        OrganizationMapModel organization,
        List<ProcessTableIssueModel> issues,
        CancellationToken cancellationToken)
    {
        var summaries = catalogItems.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var result = new Dictionary<string, ProcessTableChangeSummary>(StringComparer.OrdinalIgnoreCase);
        foreach (var processRow in processRows.Where(row => !string.IsNullOrWhiteSpace(row.Get("ID процесса"))))
        {
            var processId = processRow.Get("ID процесса");
            var incoming = stepRows.Where(row => row.Get("ID процесса").Equals(processId, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (!summaries.TryGetValue(processId, out var summary))
            {
                var additions = incoming.Select(row => $"Добавлен шаг «{row.Get("Название") ?? row.Get("ID шага")}»").Take(12).ToArray();
                var newProcessFieldChanges = new List<ProcessTableFieldChangeModel>
                {
                    new("Process", "Added", processId, processRow.Get("Название"), "Процесс", null, processRow.Get("Название"))
                };
                newProcessFieldChanges.AddRange(incoming.Select(row => new ProcessTableFieldChangeModel("Step", "Added", row.Get("ID шага"), row.Get("Название"), "Шаг", null, row.Get("Название"))));
                result[processId] = new(true, incoming.Length, 0, 0, 0, additions, newProcessFieldChanges, []);
                continue;
            }

            ProcessModel existing;
            try { existing = await catalog.LoadAsync(processId, summary.HasDraft || summary.Status == "Draft", cancellationToken); }
            catch (FileNotFoundException) { continue; }
            foreach (var row in incoming.Where(row => existing.Nodes.Any(node => node.Id == row.Get("ID шага") && node.BpmnType is "subProcess" or "callActivity")))
                issues.Add(new("Error", row.Sheet, row.Number, "Тип BPMN", "Встроенные подпроцессы и вызовы со специальными параметрами изменяются через BPMN-редактор или BPMN-импорт; таблица не переносит их внутреннее содержимое.", processId, row.Get("ID шага")));
            var processMapping = organization.CrossCompanyProcesses.FirstOrDefault(item => item.ProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase));
            var laneMappings = (processMapping?.LaneOrganizations ?? []).ToDictionary(item => item.LaneId, StringComparer.OrdinalIgnoreCase);
            var processAssignments = await assignments.LoadAsync(existing, access.Users(), cancellationToken);
            var laneAssignments = processAssignments.Lanes.ToDictionary(item => item.LaneId, item => item.UserIds, StringComparer.OrdinalIgnoreCase);
            var incomingById = incoming.Where(row => !string.IsNullOrWhiteSpace(row.Get("ID шага")))
                .ToDictionary(row => row.Get("ID шага"), StringComparer.OrdinalIgnoreCase);
            var existingById = existing.Nodes.ToDictionary(node => node.Id, StringComparer.OrdinalIgnoreCase);
            var added = incomingById.Keys.Except(existingById.Keys, StringComparer.OrdinalIgnoreCase).ToArray();
            var removed = existingById.Keys.Except(incomingById.Keys, StringComparer.OrdinalIgnoreCase).ToArray();
            var processFieldChanges = ProcessFieldChanges(processRow, existing);
            var stepFieldChanges = incomingById.Keys.Intersect(existingById.Keys, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(id => id, id => StepFieldChanges(incomingById[id], channelRows, existingById[id], existing, laneMappings, laneAssignments), StringComparer.OrdinalIgnoreCase);
            var modified = stepFieldChanges.Where(item => item.Value.Count > 0).Select(item => item.Key).ToArray();
            var unchanged = incomingById.Count - added.Length - modified.Length;
            var processChanged = processFieldChanges.Count > 0;
            var descriptions = new List<string>();
            if (processChanged) descriptions.Add("Изменён паспорт процесса");
            descriptions.AddRange(added.Select(id => $"Добавлен шаг «{incomingById[id].Get("Название")}»"));
            descriptions.AddRange(modified.Select(id => $"Изменён шаг «{incomingById[id].Get("Название")}»"));
            descriptions.AddRange(removed.Select(id => $"Будет удалён шаг «{existingById[id].Name}»"));
            var fieldChanges = new List<ProcessTableFieldChangeModel>(processFieldChanges);
            fieldChanges.AddRange(added.Select(id => new ProcessTableFieldChangeModel("Step", "Added", id, incomingById[id].Get("Название"), "Шаг", null, incomingById[id].Get("Название"))));
            foreach (var id in modified) fieldChanges.AddRange(stepFieldChanges[id]);
            fieldChanges.AddRange(removed.Select(id => new ProcessTableFieldChangeModel("Step", "Removed", id, existingById[id].Name, "Шаг", existingById[id].Name, null)));
            var renameSuggestions = FindRenameSuggestions(added, removed, incomingById, existingById);
            result[processId] = new(processChanged, added.Length, modified.Length, removed.Length, unchanged, descriptions.Take(12).ToArray(), fieldChanges.Take(250).ToArray(), renameSuggestions);
        }
        return result;
    }

    private static IReadOnlyList<ProcessTableFieldChangeModel> ProcessFieldChanges(SheetRow row, ProcessModel existing)
    {
        var passport = existing.Passport ?? new ProcessPassportModel();
        var changes = new List<ProcessTableFieldChangeModel>();
        AddChange(changes, "Process", existing.Id, existing.Name, "Название", existing.Name, row.Get("Название"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Уровень", passport.Level.ToString(CultureInfo.InvariantCulture), ParseInteger(row.Get("Уровень"))?.ToString(CultureInfo.InvariantCulture));
        AddChange(changes, "Process", existing.Id, existing.Name, "Родительский процесс", passport.ParentProcessId, row.Get("Родительский процесс"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Классификация", passport.Classification, row.Get("Классификация"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Цель", passport.Purpose, row.Get("Цель"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Границы", passport.Scope, row.Get("Границы"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Триггер", passport.Trigger, row.Get("Триггер"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Варианты запуска", DisplayList(passport.TriggerOptions), DisplayList(Split(row.Get("Варианты запуска"))));
        AddChange(changes, "Process", existing.Id, existing.Name, "Результат", passport.Result, row.Get("Результат"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Системы", DisplayList(passport.Systems), DisplayList(Split(row.Get("Системы"))));
        AddChange(changes, "Process", existing.Id, existing.Name, "Документы", DisplayList(passport.Documents), DisplayList(Split(row.Get("Документы"))));
        if (row.Has("_Requirements")) AddChange(changes, "Process", existing.Id, existing.Name, "Сверка с источником", DisplayRequirements(passport.SourceRequirements), DisplayRequirements(ResolveRequirements(row, passport.SourceRequirements)));
        AddChange(changes, "Process", existing.Id, existing.Name, "Организация-владелец", existing.OwnerLegalEntityId, row.Get("Организация-владелец ID"));
        AddChange(changes, "Process", existing.Id, existing.Name, "Подразделение-владелец", existing.OwnerUnitId, row.Get("Подразделение-владелец ID"));
        return changes;
    }

    private static IReadOnlyList<ProcessTableFieldChangeModel> StepFieldChanges(SheetRow row, IReadOnlyList<SheetRow> channelRows, NodeModel node, ProcessModel process,
        IReadOnlyDictionary<string, LaneOrganizationModel> laneMappings,
        IReadOnlyDictionary<string, IReadOnlyList<string>> laneAssignments)
    {
        var targets = Split(row.Get("Следующие шаги"));
        var labels = Split(row.Get("Условия переходов"), preserveEmpty: true);
        var normalizedLabels = targets.Select((_, index) => index < labels.Count ? labels[index] : string.Empty).ToArray();
        var existingEdges = process.Edges.Where(edge => edge.SourceId.Equals(node.Id, StringComparison.Ordinal)).ToArray();
        var incomingChannels = channelRows.Where(channel => channel.Get("ID процесса").Equals(row.Get("ID процесса"), StringComparison.OrdinalIgnoreCase) &&
                channel.Get("ID шага").Equals(node.Id, StringComparison.OrdinalIgnoreCase))
            .Select(channel => $"{channel.Get("ID канала")}\u001f{channel.Get("Тип канала")}\u001f{channel.Get("Режим")}\u001f{channel.Get("Направление")}\u001f{channel.Get("Название")}\u001f{channel.Get("Система")}\u001f{channel.Get("Документ")}")
            .OrderBy(value => value, StringComparer.Ordinal).ToArray();
        var existingChannels = (node.Channels ?? []).Select(channel => $"{channel.Id}\u001f{channel.Kind}\u001f{channel.Flow}\u001f{channel.Direction}\u001f{channel.Label}\u001f{channel.SystemName}\u001f{channel.DocumentName}")
            .OrderBy(value => value, StringComparer.Ordinal).ToArray();
        laneMappings.TryGetValue(node.LaneId, out var laneMapping);
        laneAssignments.TryGetValue(node.LaneId, out var assignedUsers);
        var changes = new List<ProcessTableFieldChangeModel>();
        AddChange(changes, "Step", node.Id, node.Name, "Тип", node.Type, row.Get("Тип"));
        if (row.Has("Тип BPMN")) AddChange(changes, "Step", node.Id, node.Name, "Тип BPMN", node.BpmnType ?? node.Type, ResolveBpmnType(row, node));
        if (row.Has("Способ выполнения")) AddChange(changes, "Step", node.Id, node.Name, "Способ выполнения", node.ExecutionMode, row.Get("Способ выполнения"));
        if (row.Has("Система выполнения")) AddChange(changes, "Step", node.Id, node.Name, "Система выполнения", node.SystemName, row.Get("Система выполнения"));
        if (row.Has("Инструкция")) AddChange(changes, "Step", node.Id, node.Name, "Инструкция", node.Instruction, row.Get("Инструкция"));
        if (row.Has("Исполнитель действия")) AddChange(changes, "Step", node.Id, node.Name, "Исполнитель действия", node.ExecutorKind, ResolveExecutorKind(row, node));
        if (row.Has("_Evidence")) AddChange(changes, "Step", node.Id, node.Name, "Источники и вопросы", DisplayEvidence(node.Evidence), DisplayEvidence(JsonSerializer.Deserialize<StepEvidenceModel[]>(row.Get("_Evidence"))));
        AddChange(changes, "Step", node.Id, node.Name, "Название", node.Name, row.Get("Название"));
        AddChange(changes, "Step", node.Id, node.Name, "Дорожка", node.LaneId, row.Get("Дорожка ID"));
        AddChange(changes, "Step", node.Id, node.Name, "Организация", laneMapping?.LegalEntityId, row.Get("Организация ID"));
        AddChange(changes, "Step", node.Id, node.Name, "Подразделение", laneMapping?.UnitId, row.Get("Подразделение ID"));
        AddChange(changes, "Step", node.Id, node.Name, "Сотрудники", DisplayList((assignedUsers ?? []).OrderBy(value => value, StringComparer.OrdinalIgnoreCase)), DisplayList(Split(row.Get("Сотрудники ID")).OrderBy(value => value, StringComparer.OrdinalIgnoreCase)));
        AddChange(changes, "Step", node.Id, node.Name, "Описание", node.Description, row.Get("Описание"));
        AddChange(changes, "Step", node.Id, node.Name, "Ответственный", node.Responsible, row.Get("Ответственный"));
        AddChange(changes, "Step", node.Id, node.Name, "Входы", DisplayList(node.Inputs), DisplayList(Split(row.Get("Входы"))));
        AddChange(changes, "Step", node.Id, node.Name, "Ожидаемый результат", node.ExpectedResult, row.Get("Ожидаемый результат"));
        AddChange(changes, "Step", node.Id, node.Name, "Критерий завершения", node.CompletionCriteria, row.Get("Критерий завершения"));
        AddChange(changes, "Step", node.Id, node.Name, "Работа", node.WorkDuration ?? node.Duration, row.Get("Работа"));
        AddChange(changes, "Step", node.Id, node.Name, "Ожидание", node.WaitDuration, row.Get("Ожидание"));
        AddChange(changes, "Step", node.Id, node.Name, "Связанный процесс", node.LinkedProcessId, row.Get("Связанный процесс ID"));
        AddChange(changes, "Transition", node.Id, node.Name, "Следующие шаги", DisplayList(existingEdges.Select(edge => edge.TargetId)), DisplayList(targets));
        AddChange(changes, "Transition", node.Id, node.Name, "Условия переходов", DisplayList(existingEdges.Select(edge => edge.Label)), DisplayList(normalizedLabels));
        AddChange(changes, "Channel", node.Id, node.Name, "Каналы", DisplayChannels(existingChannels), DisplayChannels(incomingChannels));
        if (row.Has("Объекты реестра ID"))
        {
            var ids = Split(row.Get("Объекты реестра ID"), true); var names = Split(row.Get("Объекты реестра — названия"), true);
            var roles = Split(row.Get("Роли объектов"), true); var required = Split(row.Get("Обязательность объектов"), true);
            var versions = Split(row.Get("Версии объектов"), true); var conditions = Split(row.Get("Условия объектов"), true);
            var incoming = ids.Select((id, index) => $"{id}\u001f{names.ElementAtOrDefault(index)}\u001f{roles.ElementAtOrDefault(index)}\u001f{required.ElementAtOrDefault(index)}\u001f{versions.ElementAtOrDefault(index)}\u001f{conditions.ElementAtOrDefault(index)}");
            var current = (node.InformationObjects ?? []).Select(item => $"{item.ObjectId}\u001f{item.Name}\u001f{item.Role}\u001f{(item.Required ? "Да" : "Нет")}\u001f{item.Version}\u001f{item.Condition}");
            AddChange(changes, "Step", node.Id, node.Name, "Объекты реестра", DisplayBindings(current), DisplayBindings(incoming));
        }
        return changes;
    }

    private static void AddChange(List<ProcessTableFieldChangeModel> changes, string scope, string? elementId, string? elementName,
        string field, string? oldValue, string? newValue)
    {
        if (Same(oldValue, newValue)) return;
        changes.Add(new(scope, "Modified", elementId, elementName, field, EmptyToNull(oldValue ?? string.Empty), EmptyToNull(newValue ?? string.Empty)));
    }

    private static string DisplayList(IEnumerable<string?>? values) => string.Join(" | ", (values ?? []).Select(value => value?.Trim() ?? string.Empty));
    private static string DisplayChannels(IEnumerable<string> values) => string.Join("; ", values.Select(value =>
    {
        var parts = value.Split('\u001f');
        return parts.Length < 7 ? value : $"{parts[0]}: {parts[4]} [{parts[1]}, {parts[2]}, {parts[3]}]" +
            (string.IsNullOrWhiteSpace(parts[5]) ? string.Empty : $" · {parts[5]}") +
            (string.IsNullOrWhiteSpace(parts[6]) ? string.Empty : $" · {parts[6]}");
    }));
    private static string DisplayBindings(IEnumerable<string> values) => string.Join("; ", values.Select(value =>
    {
        var parts = value.Split('\u001f');
        return parts.Length < 6 ? value : $"{parts[1]} [{parts[2]}, {parts[3]}, версия {parts[4]}]" +
            (string.IsNullOrWhiteSpace(parts[5]) ? string.Empty : $" · {parts[5]}");
    }));

    private static IReadOnlyList<ProcessTableRenameSuggestionModel> FindRenameSuggestions(
        IReadOnlyList<string> added,
        IReadOnlyList<string> removed,
        IReadOnlyDictionary<string, SheetRow> incoming,
        IReadOnlyDictionary<string, NodeModel> existing)
    {
        var suggestions = new List<ProcessTableRenameSuggestionModel>();
        foreach (var incomingId in added)
        {
            var incomingName = incoming[incomingId].Get("Название");
            var normalizedName = NormalizeName(incomingName);
            if (normalizedName.Length == 0) continue;
            var candidates = removed.Where(existingId => NormalizeName(existing[existingId].Name) == normalizedName &&
                Same(existing[existingId].Type, incoming[incomingId].Get("Тип"))).ToArray();
            if (candidates.Length != 1) continue;
            var existingId = candidates[0];
            if (suggestions.Any(item => item.ExistingStepId.Equals(existingId, StringComparison.OrdinalIgnoreCase))) continue;
            suggestions.Add(new(existingId, existing[existingId].Name, incomingId, incomingName));
        }
        return suggestions;
    }

    private static string NormalizeName(string? value) => Regex.Replace((value ?? string.Empty).Trim().ToLowerInvariant(), @"[^\p{L}\p{N}]", string.Empty);

    private static bool Same(string? first, string? second) => string.Equals(first?.Trim() ?? string.Empty, second?.Trim() ?? string.Empty, StringComparison.Ordinal);

    public async Task<ProcessTableImportResultModel> ApplyAsync(
        IFormFile file,
        string appliedBy,
        IReadOnlyCollection<string>? selectedProcessIds = null,
        IReadOnlyCollection<string>? confirmedRemovalProcessIds = null,
        IReadOnlyCollection<ProcessTableStepIdMappingModel>? stepIdMappings = null,
        CancellationToken cancellationToken = default)
    {
        var preview = await PreviewAsync(file, cancellationToken);
        var requestedIds = (selectedProcessIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var selectiveImport = selectedProcessIds is not null;
        if (selectiveImport && requestedIds.Count == 0)
            throw new InvalidDataException("Выберите хотя бы один процесс для загрузки.");
        var blockingErrors = preview.Issues.Where(issue => issue.Severity == "Error" &&
            (!selectiveImport || issue.Row == 0 || (!string.IsNullOrWhiteSpace(issue.ProcessId) && requestedIds.Contains(issue.ProcessId)))).ToArray();
        if (blockingErrors.Length > 0)
            throw new InvalidDataException($"Для выбранных процессов найдено ошибок: {blockingErrors.Length}. Исправьте их и повторите проверку.");
        var validatedMappings = ValidateStepIdMappings(preview, requestedIds, selectiveImport, stepIdMappings ?? []);
        var mappedRemovalCounts = validatedMappings.GroupBy(item => item.ProcessId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Select(item => item.ExistingStepId).Distinct(StringComparer.OrdinalIgnoreCase).Count(), StringComparer.OrdinalIgnoreCase);
        var confirmedRemovalIds = (confirmedRemovalProcessIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unconfirmedRemovals = preview.Processes.Where(item => item.RemovedStepCount - mappedRemovalCounts.GetValueOrDefault(item.Id) > 0 &&
                (!selectiveImport || requestedIds.Contains(item.Id)) && !confirmedRemovalIds.Contains(item.Id))
            .Select(item => $"{item.Name} ({item.RemovedStepCount - mappedRemovalCounts.GetValueOrDefault(item.Id)})").ToArray();
        if (unconfirmedRemovals.Length > 0)
            throw new InvalidDataException($"Отдельно подтвердите удаление шагов: {string.Join(", ", unconfirmedRemovals)}.");

        var workbook = await LoadWorkbookAsync(file, cancellationToken);
        var allProcessRows = AttachRequirements(workbook, ReadRows(workbook["Процессы"]), ReadRows(workbook["Шаги"]), []);
        var workbookIds = allProcessRows.Select(row => row.Get("ID процесса")).Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missingIds = requestedIds.Where(id => !workbookIds.Contains(id)).OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToArray();
        if (missingIds.Length > 0)
            throw new InvalidDataException($"В таблице не найдены выбранные процессы: {string.Join(", ", missingIds)}.");
        var processRows = selectiveImport
            ? allProcessRows.Where(row => requestedIds.Contains(row.Get("ID процесса"))).ToArray()
            : allProcessRows;
        var stepRows = ReadRows(workbook["Шаги"]);
        stepRows = AttachEvidence(workbook, stepRows, []);
        var channelRows = ReadRows(workbook["Каналы"]);
        (stepRows, channelRows) = ApplyStepIdMappings(stepRows, channelRows, validatedMappings);
        processRows = processRows.Select(row =>
        {
            if (!row.Has("_Requirements")) return row;
            var requirements = JsonSerializer.Deserialize<SourceRequirementModel[]>(row.Get("_Requirements")) ?? [];
            var mapped = requirements.Select(item => item with { ElementIds = (item.ElementIds ?? []).Select(id =>
                validatedMappings.FirstOrDefault(mapping => mapping.ProcessId.Equals(row.Get("ID процесса"), StringComparison.OrdinalIgnoreCase) && mapping.IncomingStepId.Equals(id, StringComparison.OrdinalIgnoreCase))?.ExistingStepId ?? id).ToArray() }).ToArray();
            return new SheetRow(row.Sheet, row.Number, new Dictionary<string, string>(row.Values, StringComparer.OrdinalIgnoreCase) { ["_Requirements"] = JsonSerializer.Serialize(mapped) });
        }).ToArray();
        var organization = await organizations.LoadAsync(cancellationToken);
        var users = access.Users();
        var catalogItems = await catalog.ListAsync(cancellationToken);
        var existingIds = catalogItems.Select(item => item.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var existingSummaries = catalogItems.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        if (selectiveImport)
        {
            var requiredNewProcesses = processRows.Select(row => row.Get("Родительский процесс"))
                .Concat(stepRows.Where(row => requestedIds.Contains(row.Get("ID процесса"))).Select(row => row.Get("Связанный процесс ID")))
                .Where(id => !string.IsNullOrWhiteSpace(id) && workbookIds.Contains(id) && !existingIds.Contains(id) && !requestedIds.Contains(id))
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToArray();
            if (requiredNewProcesses.Length > 0)
                throw new InvalidDataException($"Выберите также новые связанные процессы: {string.Join(", ", requiredNewProcesses)}.");
        }
        var lockedIds = processRows.Select(row => row.Get("ID процесса"))
            .Where(editLocks.HasActiveLock)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(id => id, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (lockedIds.Length > 0)
            throw new InvalidDataException($"Закройте редактор процессов перед импортом: {string.Join(", ", lockedIds)}.");
        var backup = await backups.CreateAsync($"Перед табличным импортом: {appliedBy}", cancellationToken);
        var imported = new List<ProcessTableImportItemModel>();

        foreach (var processRow in processRows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var processId = processRow.Get("ID процесса");
            ProcessModel? existing = null;
            if (existingSummaries.TryGetValue(processId, out var existingSummary))
            {
                try { existing = await catalog.LoadAsync(processId, existingSummary.HasDraft || existingSummary.Status == "Draft", cancellationToken); }
                catch (FileNotFoundException) { }
            }
            var generated = Generate(processRow,
                stepRows.Where(row => row.Get("ID процесса").Equals(processId, StringComparison.OrdinalIgnoreCase)).ToArray(),
                channelRows.Where(row => row.Get("ID процесса").Equals(processId, StringComparison.OrdinalIgnoreCase)).ToArray(),
                organization, existing);
            var summary = await catalog.SaveGeneratedDraftAsync(processId, generated.Bpmn, generated.Context, cancellationToken);
            await organizations.SaveProcessLanesAsync(processId, new(generated.LaneMappings), cancellationToken);
            await assignments.SaveAsync(await catalog.LoadAsync(processId, draft: true, cancellationToken),
                new(generated.Assignments), users, cancellationToken);
            imported.Add(new(processId, summary.Name, existingIds.Contains(processId) ? "Updated" : "Created", summary.NodeCount, summary.LaneCount));
        }

        var reportFileName = await SaveImportReportAsync(preview, imported, validatedMappings, cancellationToken);
        await importHistory.AppendAsync(new(
            Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow, appliedBy, file.FileName, backup.FileName,
            preview.ProcessCount, imported.Count,
            imported.Count(item => item.Status == "Created"), imported.Count(item => item.Status == "Updated"),
            Math.Max(0, preview.ProcessCount - imported.Count), validatedMappings.Count,
            reportFileName, true, imported), cancellationToken);
        return new(backup.FileName, imported.Count(item => item.Status == "Created"),
            imported.Count(item => item.Status == "Updated"), imported, validatedMappings.Count, reportFileName);
    }

    public string ResolveImportReportPath(string fileName)
    {
        return importHistory.ResolveReportPath(fileName);
    }

    private static IReadOnlyList<ProcessTableStepIdMappingModel> ValidateStepIdMappings(
        ProcessTablePreviewModel preview,
        IReadOnlySet<string> requestedIds,
        bool selectiveImport,
        IReadOnlyCollection<ProcessTableStepIdMappingModel> mappings)
    {
        var normalized = mappings.Where(item => !string.IsNullOrWhiteSpace(item.ProcessId) &&
                !string.IsNullOrWhiteSpace(item.IncomingStepId) && !string.IsNullOrWhiteSpace(item.ExistingStepId))
            .Select(item => new ProcessTableStepIdMappingModel(item.ProcessId.Trim(), item.IncomingStepId.Trim(), item.ExistingStepId.Trim()))
            .ToArray();
        if (normalized.GroupBy(item => $"{item.ProcessId}\u001f{item.IncomingStepId}", StringComparer.OrdinalIgnoreCase).Any(group => group.Count() > 1) ||
            normalized.GroupBy(item => $"{item.ProcessId}\u001f{item.ExistingStepId}", StringComparer.OrdinalIgnoreCase).Any(group => group.Count() > 1))
            throw new InvalidDataException("Один шаг нельзя сопоставить нескольким идентификаторам.");

        foreach (var mapping in normalized)
        {
            if (selectiveImport && !requestedIds.Contains(mapping.ProcessId))
                throw new InvalidDataException($"Сопоставление относится к невыбранному процессу «{mapping.ProcessId}».");
            var process = preview.Processes.FirstOrDefault(item => item.Id.Equals(mapping.ProcessId, StringComparison.OrdinalIgnoreCase));
            var allowed = process?.RenameSuggestions?.Any(item =>
                item.IncomingStepId.Equals(mapping.IncomingStepId, StringComparison.OrdinalIgnoreCase) &&
                item.ExistingStepId.Equals(mapping.ExistingStepId, StringComparison.OrdinalIgnoreCase)) == true;
            if (!allowed)
                throw new InvalidDataException($"Сопоставление шагов «{mapping.IncomingStepId}» → «{mapping.ExistingStepId}» устарело или не подтверждено проверкой.");
        }
        return normalized;
    }

    private static (IReadOnlyList<SheetRow> Steps, IReadOnlyList<SheetRow> Channels) ApplyStepIdMappings(
        IReadOnlyList<SheetRow> steps,
        IReadOnlyList<SheetRow> channels,
        IReadOnlyList<ProcessTableStepIdMappingModel> mappings)
    {
        if (mappings.Count == 0) return (steps, channels);
        var byProcess = mappings.GroupBy(item => item.ProcessId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToDictionary(item => item.IncomingStepId, item => item.ExistingStepId, StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase);
        string Map(string processId, string stepId) => byProcess.TryGetValue(processId, out var processMappings)
            ? processMappings.GetValueOrDefault(stepId, stepId) : stepId;

        var mappedSteps = steps.Select(row =>
        {
            var processId = row.Get("ID процесса");
            var values = row.Values.ToDictionary(item => item.Key, item => item.Value, StringComparer.OrdinalIgnoreCase);
            values["ID шага"] = Map(processId, row.Get("ID шага"));
            values["Следующие шаги"] = Join(Split(row.Get("Следующие шаги"), preserveEmpty: true).Select(id => Map(processId, id)), preserveEmpty: true);
            return new SheetRow(row.Sheet, row.Number, values);
        }).ToArray();
        var mappedChannels = channels.Select(row =>
        {
            var values = row.Values.ToDictionary(item => item.Key, item => item.Value, StringComparer.OrdinalIgnoreCase);
            values["ID шага"] = Map(row.Get("ID процесса"), row.Get("ID шага"));
            return new SheetRow(row.Sheet, row.Number, values);
        }).ToArray();
        return (mappedSteps, mappedChannels);
    }

    private async Task<string> SaveImportReportAsync(
        ProcessTablePreviewModel preview,
        IReadOnlyList<ProcessTableImportItemModel> imported,
        IReadOnlyList<ProcessTableStepIdMappingModel> mappings,
        CancellationToken cancellationToken)
    {
        var importedById = imported.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var lines = new List<string> { "Процесс ID;Процесс;Результат;Тип записи;Элемент ID;Элемент;Поле;Было;Стало;Комментарий" };
        foreach (var process in preview.Processes)
        {
            var outcome = importedById.TryGetValue(process.Id, out var importedItem)
                ? importedItem.Status == "Created" ? "Создан черновик" : "Обновлён черновик"
                : process.ErrorCount > 0 ? "Пропущен: ошибки" : "Не выбран";
            lines.Add(Csv(process.Id, process.Name, outcome, "Итог", "", "", "", "", "", $"Ошибок: {process.ErrorCount}; предупреждений: {process.WarningCount}"));
            foreach (var change in process.FieldChanges ?? [])
                lines.Add(Csv(process.Id, process.Name, outcome, change.Kind, change.ElementId, change.ElementName, change.Field, change.OldValue, change.NewValue, change.Scope));
            foreach (var mapping in mappings.Where(item => item.ProcessId.Equals(process.Id, StringComparison.OrdinalIgnoreCase)))
                lines.Add(Csv(process.Id, process.Name, outcome, "Сопоставление ID", mapping.ExistingStepId, "", "Технический ID", mapping.IncomingStepId, mapping.ExistingStepId, "Сохранена идентичность существующего шага"));
        }
        var directory = Path.Combine(loader.DataRoot, "ImportReports");
        Directory.CreateDirectory(directory);
        var fileName = $"table-import-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.csv";
        await File.WriteAllTextAsync(Path.Combine(directory, fileName), "\uFEFF" + string.Join(Environment.NewLine, lines), new UTF8Encoding(false), cancellationToken);
        return fileName;
    }

    private static string Csv(params string?[] values) => string.Join(';', values.Select(value => $"\"{(value ?? string.Empty).Replace("\"", "\"\"")}\""));

    public async Task<ProcessTableExportModel> ExportAsync(
        string rootProcessId,
        bool includeDescendants,
        bool includeDrafts,
        CancellationToken cancellationToken = default)
    {
        var summaries = await catalog.ListAsync(cancellationToken);
        var rootSummary = summaries.FirstOrDefault(item => item.Id.Equals(rootProcessId, StringComparison.OrdinalIgnoreCase))
            ?? throw new FileNotFoundException($"Процесс «{rootProcessId}» не найден.");
        var loaded = new List<ProcessModel>();
        foreach (var summary in summaries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (summary.Status == "Draft" && !includeDrafts) continue;
            try { loaded.Add(await catalog.LoadAsync(summary.Id, includeDrafts && (summary.HasDraft || summary.Status == "Draft"), cancellationToken)); }
            catch (FileNotFoundException) when (!summary.Id.Equals(rootProcessId, StringComparison.OrdinalIgnoreCase)) { }
        }

        var root = loaded.FirstOrDefault(item => item.Id.Equals(rootSummary.Id, StringComparison.OrdinalIgnoreCase))
            ?? throw new FileNotFoundException($"Доступная редакция процесса «{rootProcessId}» не найдена.");
        var selectedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { root.Id };
        if (includeDescendants)
        {
            var changed = true;
            while (changed)
            {
                changed = false;
                foreach (var process in loaded.Where(process => process.Passport?.ParentProcessId is not null && selectedIds.Contains(process.Passport.ParentProcessId)))
                    changed |= selectedIds.Add(process.Id);
            }
        }
        var selected = loaded.Where(process => selectedIds.Contains(process.Id))
            .OrderBy(process => process.Passport?.Level ?? 2)
            .ThenBy(process => process.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
        if (selected.Length > 500) throw new InvalidDataException("Одна выгрузка не может содержать более 500 процессов.");

        var organization = await organizations.LoadAsync(cancellationToken);
        var mappings = organization.CrossCompanyProcesses.ToDictionary(item => item.ProcessId, StringComparer.OrdinalIgnoreCase);
        var users = access.Users();
        var assignmentMaps = new Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(StringComparer.OrdinalIgnoreCase);
        foreach (var process in selected)
        {
            var processAssignments = await assignments.LoadAsync(process, users, cancellationToken);
            assignmentMaps[process.Id] = processAssignments.Lanes.ToDictionary(item => item.LaneId, item => item.UserIds, StringComparer.Ordinal);
        }

        var processRows = selected.Select(process =>
        {
            var passport = process.Passport ?? new ProcessPassportModel();
            return (IReadOnlyList<object?>)[null, process.Id, process.Name, passport.Level, passport.ParentProcessId, passport.Classification,
                process.OwnerLegalEntityId, process.OwnerUnitId, passport.Purpose, passport.Scope, passport.Trigger, Join(passport.TriggerOptions),
                passport.Result, Join(passport.Systems), Join(passport.Documents)];
        }).ToArray();
        var stepRows = new List<IReadOnlyList<object?>>();
        var channelRows = new List<IReadOnlyList<object?>>();
        var evidenceRows = new List<IReadOnlyList<object?>>();
        var requirementRows = selected.SelectMany(process => (process.Passport?.SourceRequirements ?? []).Select(item => (IReadOnlyList<object?>)new object?[] { null, process.Id, item.Id, item.Text, item.Source, item.Locator, Join(item.ElementIds), item.CheckSequence ? "Да" : "Нет" })).ToArray();
        foreach (var process in selected)
        {
            mappings.TryGetValue(process.Id, out var mapping);
            var lanes = (mapping?.LaneOrganizations ?? []).ToDictionary(item => item.LaneId, StringComparer.Ordinal);
            assignmentMaps.TryGetValue(process.Id, out var processAssignments);
            var orderedNodes = process.Nodes.OrderBy(node => node.X).ThenBy(node => node.Y).ThenBy(node => node.Id, StringComparer.Ordinal).ToArray();
            for (var index = 0; index < orderedNodes.Length; index++)
            {
                var node = orderedNodes[index];
                lanes.TryGetValue(node.LaneId, out var lane);
                var outgoing = process.Edges.Where(edge => edge.SourceId.Equals(node.Id, StringComparison.Ordinal)).ToArray();
                IReadOnlyList<string>? userIds = null;
                processAssignments?.TryGetValue(node.LaneId, out userIds);
                var bindings = node.InformationObjects ?? [];
                foreach (var evidence in node.Evidence ?? [])
                    evidenceRows.Add([null, process.Id, node.Id, evidence.Status switch { "fact" => "Факт", "assumption" => "Предположение", _ => "Вопрос" }, evidence.Statement, evidence.Source, evidence.Locator, evidence.Author]);
                stepRows.Add([null, process.Id, index + 1, node.Id, node.Type, node.Name, node.LaneId,
                    lane?.LegalEntityId, lane?.UnitId, Join(userIds), node.Responsible, node.Description, Join(node.Inputs),
                    node.ExpectedResult, node.CompletionCriteria, node.WorkDuration ?? node.Duration, node.WaitDuration,
                    node.LinkedProcessId, Join(outgoing.Select(edge => edge.TargetId)), Join(outgoing.Select(edge => edge.Label ?? ""), preserveEmpty: true),
                    Join(bindings.Select(item => item.ObjectId), preserveEmpty: true), Join(bindings.Select(item => item.Name), preserveEmpty: true),
                    Join(bindings.Select(item => item.Role), preserveEmpty: true), Join(bindings.Select(item => item.Required ? "Да" : "Нет"), preserveEmpty: true),
                    Join(bindings.Select(item => item.Version), preserveEmpty: true), Join(bindings.Select(item => item.Condition), preserveEmpty: true),
                    node.BpmnType ?? node.Type, node.ExecutionMode, node.SystemName, node.Instruction, node.ExecutorKind]);
                foreach (var channel in node.Channels ?? [])
                    channelRows.Add([null, process.Id, node.Id, channel.Id, channel.Kind, channel.Flow, channel.Direction,
                        channel.Label, channel.SystemName, channel.DocumentName]);
            }
        }
        if (stepRows.Count > 20_000 || channelRows.Count > 50_000 || evidenceRows.Count > 50_000 || requirementRows.Length > 50_000)
            throw new InvalidDataException("Ветка процессов слишком велика для одной табличной выгрузки.");

        var templatePath = Path.Combine(loader.DataRoot, "Templates", "process-table-template.xlsx");
        if (!File.Exists(templatePath)) throw new FileNotFoundException("Табличный шаблон не найден.", templatePath);
        var content = await BuildExportWorkbookAsync(templatePath, processRows, stepRows, channelRows, organization, cancellationToken, evidenceRows, requirementRows);
        var suffix = includeDescendants ? "branch" : "process";
        return new(content, $"Process-Navigator-{root.Id}-{suffix}.xlsx", selected.Length);
    }

    public async Task<byte[]> TemplateAsync(CancellationToken cancellationToken = default)
    {
        var organization = await organizations.LoadAsync(cancellationToken);
        var templatePath = Path.Combine(loader.DataRoot, "Templates", "process-table-template.xlsx");
        if (!File.Exists(templatePath)) throw new FileNotFoundException("Табличный шаблон не найден.", templatePath);
        return await BuildExportWorkbookAsync(templatePath, [], [], [], organization, cancellationToken);
    }

    private static GeneratedProcess Generate(
        SheetRow process,
        IReadOnlyList<SheetRow> stepRows,
        IReadOnlyList<SheetRow> channelRows,
        OrganizationMapModel organization,
        ProcessModel? existing)
    {
        var processId = process.Get("ID процесса");
        var steps = stepRows.OrderBy(row => ParseInteger(row.Get("Порядок")) ?? int.MaxValue).ToArray();
        var legalEntities = organization.LegalEntities.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var lanes = steps.GroupBy(row => row.Get("Дорожка ID"), StringComparer.OrdinalIgnoreCase).Select(group =>
        {
            var mapped = group.First(row => !string.IsNullOrWhiteSpace(row.Get("Организация ID")) && !string.IsNullOrWhiteSpace(row.Get("Подразделение ID")));
            var entity = legalEntities[mapped.Get("Организация ID")];
            var unit = (entity.Units ?? []).First(item => item.Id.Equals(mapped.Get("Подразделение ID"), StringComparison.OrdinalIgnoreCase));
            var explicitName = group.Select(row => row.Get("Ответственный")).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
            var name = explicitName ?? (string.IsNullOrWhiteSpace(unit.ShortName) ? unit.Name : unit.ShortName);
            var userIds = group.SelectMany(row => Split(row.Get("Сотрудники ID"))).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            return new GeneratedLane(group.Key, name, entity.Id, unit.Id, unit.Name,
                string.IsNullOrWhiteSpace(unit.ShortName) || !name.Equals(unit.ShortName, StringComparison.OrdinalIgnoreCase) ? "full" : "short", userIds);
        }).ToArray();

        var channelsByStep = channelRows.GroupBy(row => row.Get("ID шага"), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<ProcessChannelModel>)group.Select(row => new ProcessChannelModel(
                row.Get("ID канала"), row.Get("Тип канала"), row.Get("Название"), EmptyToNull(row.Get("Система")),
                EmptyToNull(row.Get("Документ")), row.Get("Режим"), row.Get("Направление"))).ToArray(), StringComparer.OrdinalIgnoreCase);
        var elementContexts = steps.ToDictionary(row => row.Get("ID шага"), row =>
        {
            var lane = lanes.First(item => item.Id.Equals(row.Get("Дорожка ID"), StringComparison.OrdinalIgnoreCase));
            var channels = channelsByStep.GetValueOrDefault(row.Get("ID шага"), []);
            var existingNode = existing?.Nodes.FirstOrDefault(node => node.Id.Equals(row.Get("ID шага"), StringComparison.OrdinalIgnoreCase));
            var objectIds = Split(row.Get("Объекты реестра ID"), preserveEmpty: true);
            var objectNames = Split(row.Get("Объекты реестра — названия"), preserveEmpty: true);
            var objectRoles = Split(row.Get("Роли объектов"), preserveEmpty: true);
            var objectRequired = Split(row.Get("Обязательность объектов"), preserveEmpty: true);
            var objectVersions = Split(row.Get("Версии объектов"), preserveEmpty: true);
            var objectConditions = Split(row.Get("Условия объектов"), preserveEmpty: true);
            var objectBindings = !row.Has("Объекты реестра ID") ? existingNode?.InformationObjects ?? [] : objectIds.Select((id, index) => new InformationObjectBindingModel(
                id, objectNames.ElementAtOrDefault(index) ?? id, objectRoles.ElementAtOrDefault(index) ?? "Reference",
                ParseRequired(objectRequired.ElementAtOrDefault(index) ?? "") ?? true, EmptyToNull(objectConditions.ElementAtOrDefault(index) ?? ""),
                EmptyToNull(objectVersions.ElementAtOrDefault(index) ?? ""))).ToArray();
            return new ElementContextUpdateModel(EmptyToNull(row.Get("Описание")), EmptyToNull(row.Get("Ответственный")),
                EmptyToNull(row.Get("Работа")), existingNode?.Artifacts ?? [], existingNode?.Actions ?? [], Split(row.Get("Входы")), EmptyToNull(row.Get("Ожидаемый результат")),
                EmptyToNull(row.Get("Критерий завершения")), row.Has("Инструкция") ? EmptyToNull(row.Get("Инструкция")) : existingNode?.Instruction,
                row.Has("Способ выполнения") ? EmptyToNull(row.Get("Способ выполнения")) : existingNode is not null ? existingNode.ExecutionMode : (ResolveBpmnType(row, existingNode) == "manualTask" ? "manual" : channels.Any(item => item.Kind == "system") ? "system" : "manual"),
                row.Has("Система выполнения") ? EmptyToNull(row.Get("Система выполнения")) : existingNode is not null ? existingNode.SystemName : channels.FirstOrDefault(item => item.Kind == "system")?.SystemName, EmptyToNull(row.Get("Работа")), EmptyToNull(row.Get("Ожидание")),
                [lane.Department], EmptyToNull(row.Get("Связанный процесс ID")), [new ParticipantUnitRefModel(lane.LegalEntityId, lane.UnitId)], channels,
                objectBindings,
                ResolveExecutorKind(row, existingNode), row.Has("_Evidence") ? JsonSerializer.Deserialize<StepEvidenceModel[]>(row.Get("_Evidence")) : existingNode?.Evidence);
        }, StringComparer.OrdinalIgnoreCase);

        var ownerEntityId = process.Get("Организация-владелец ID");
        var ownerUnitId = process.Get("Подразделение-владелец ID");
        var ownerEntity = legalEntities[ownerEntityId];
        var ownerUnit = (ownerEntity.Units ?? []).First(item => item.Id.Equals(ownerUnitId, StringComparison.OrdinalIgnoreCase));
        var existingPassport = existing?.Passport;
        var passport = new ProcessPassportModel(ParseInteger(process.Get("Уровень")) ?? 0, process.Get("Классификация"),
            EmptyToNull(process.Get("Родительский процесс")), EmptyToNull(process.Get("Цель")), EmptyToNull(process.Get("Границы")),
            EmptyToNull(process.Get("Триггер")), EmptyToNull(process.Get("Результат")), existingPassport?.Inputs ?? [],
            string.IsNullOrWhiteSpace(process.Get("Результат")) ? [] : [process.Get("Результат")], Split(process.Get("Системы")),
            Split(process.Get("Документы")), existingPassport?.RelatedProcessIds ?? [], Split(process.Get("Варианты запуска")), ResolveRequirements(process, existingPassport?.SourceRequirements));
        var context = JsonSerializer.Serialize(new
        {
            version = "0.1",
            owner = string.IsNullOrWhiteSpace(ownerUnit.ShortName) ? ownerUnit.Name : ownerUnit.ShortName,
            ownerLegalEntityId = ownerEntityId,
            ownerUnitId,
            status = "Draft",
            passport,
            elements = elementContexts
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });

        return new(BuildBpmn(processId, process.Get("Название"), steps, lanes, existing), context,
            lanes.Select(lane => new LaneOrganizationModel(lane.Id, lane.LegalEntityId, lane.Department, lane.UnitId, lane.DisplayNameMode)).ToArray(),
            lanes.Select(lane => new LaneAssignmentUpdateModel(lane.Id, lane.UserIds)).ToArray());
    }

    private static async Task<byte[]> BuildExportWorkbookAsync(
        string templatePath,
        IReadOnlyList<IReadOnlyList<object?>> processRows,
        IReadOnlyList<IReadOnlyList<object?>> stepRows,
        IReadOnlyList<IReadOnlyList<object?>> channelRows,
        OrganizationMapModel organization,
        CancellationToken cancellationToken,
        IReadOnlyList<IReadOnlyList<object?>>? evidenceRows = null,
        IReadOnlyList<IReadOnlyList<object?>>? requirementRows = null)
    {
        var template = await File.ReadAllBytesAsync(templatePath, cancellationToken);
        using var memory = new MemoryStream();
        await memory.WriteAsync(template, cancellationToken);
        memory.Position = 0;
        using (var archive = new ZipArchive(memory, ZipArchiveMode.Update, leaveOpen: true))
        {
            RewriteDataSheet(archive, "xl/worksheets/sheet2.xml", "xl/tables/table1.xml", processRows, 15, [4],
                row => $"IF(OR(B{row}=\"\",C{row}=\"\",G{row}=\"\",H{row}=\"\",K{row}=\"\",M{row}=\"\",AND(D{row}>0,E{row}=\"\")),\"Заполнить обязательные поля\",\"Готово\")");
            RewriteDataSheet(archive, "xl/worksheets/sheet3.xml", "xl/tables/table2.xml", stepRows, StepHeaders.Length, [3],
                row => $"IF(OR(B{row}=\"\",D{row}=\"\",E{row}=\"\",F{row}=\"\"),\"Заполнить обязательные поля\",IF(AND(E{row}<>\"startEvent\",E{row}<>\"endEvent\",I{row}=\"\"),\"Указать подразделение\",IF(AND(E{row}=\"task\",N{row}=\"\"),\"Указать результат\",\"Готово\")))",
                StepHeaders);
            RewriteDataSheet(archive, "xl/worksheets/sheet4.xml", "xl/tables/table3.xml", channelRows, 10, [],
                row => $"IF(OR(B{row}=\"\",C{row}=\"\",D{row}=\"\",E{row}=\"\",F{row}=\"\",G{row}=\"\",H{row}=\"\"),\"Заполнить обязательные поля\",IF(AND(E{row}=\"system\",I{row}=\"\"),\"Указать систему\",\"Готово\"))");
            RewriteDictionaries(archive, organization);
            AddEvidenceSheet(archive, evidenceRows ?? []);
            AddEvidenceSheet(archive, requirementRows ?? [], true);
            UpdateGuide(archive);
            var workbook = ReadXml(archive, "xl/workbook.xml");
            XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            workbook.Root?.Element(main + "calcPr")?.Remove();
            workbook.Root?.Add(new XElement(main + "calcPr", new XAttribute("calcMode", "auto"), new XAttribute("fullCalcOnLoad", "1"), new XAttribute("forceFullCalc", "1")));
            ReplaceXml(archive, "xl/workbook.xml", workbook);
        }
        return memory.ToArray();
    }

    private static string DisplayEvidence(IReadOnlyList<StepEvidenceModel>? entries) => string.Join("\n", (entries ?? []).Select(entry =>
        $"{entry.Status switch { "fact" => "Факт", "assumption" => "Предположение", _ => "Вопрос" }}: {entry.Statement} [источник: {entry.Source}; место: {entry.Locator}; автор: {entry.Author}]"));

    private static string DisplayRequirements(IReadOnlyList<SourceRequirementModel>? entries) => string.Join("\n", (entries ?? []).Select(item =>
        $"{item.Id}: {item.Text} [источник: {item.Source}; место: {item.Locator}; элементы: {Join(item.ElementIds)}; проверка маршрута: {(item.CheckSequence ? "Да" : "Нет")}]"));

    private static IReadOnlyList<SourceRequirementModel>? ResolveRequirements(SheetRow row, IReadOnlyList<SourceRequirementModel>? existing)
    {
        if (!row.Has("_Requirements")) return existing;
        return (JsonSerializer.Deserialize<SourceRequirementModel[]>(row.Get("_Requirements")) ?? []).Select(item =>
            row.Get("_RequirementsRouteColumn") == "yes" ? item : item with { CheckSequence = existing?.FirstOrDefault(old => old.Id == item.Id)?.CheckSequence ?? false }).ToArray();
    }

    private static IReadOnlyList<SheetRow> AttachRequirements(IReadOnlyDictionary<string, XElement> workbook, IReadOnlyList<SheetRow> processes, IReadOnlyList<SheetRow> steps, List<ProcessTableIssueModel> issues)
    {
        processes = processes.Select(row => new SheetRow(row.Sheet, row.Number, row.Values.Where(pair => !pair.Key.StartsWith("_Requirements", StringComparison.OrdinalIgnoreCase)).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase))).ToArray();
        if (!workbook.TryGetValue("Сверка", out var sheet)) return processes;
        var header = sheet.Elements("row").FirstOrDefault(row => (int?)row.Attribute("number") == 3);
        var names = header?.Elements("cell").Select(cell => cell.Value.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
        foreach (var name in RequirementHeaders.Skip(1).Where(name => name != "Проверять маршрут" && !names.Contains(name))) issues.Add(new("Error", "Сверка", 0, name, $"Отсутствует колонка «{name}»."));
        var ids = processes.Select(row => row.Get("ID процесса")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var knownSteps = steps.GroupBy(row => row.Get("ID процесса"), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Select(row => row.Get("ID шага")).ToHashSet(StringComparer.Ordinal), StringComparer.OrdinalIgnoreCase);
        var entries = new Dictionary<string, List<SourceRequirementModel>>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in ReadRows(sheet))
        {
            var processId = row.Get("ID процесса");
            void Issue(string severity, string column, string message) => issues.Add(new(severity, "Сверка", row.Number, column, message, processId));
            if (!ids.Contains(processId)) { Issue("Error", "ID процесса", "Процесс не найден на листе «Процессы»."); continue; }
            try
            {
                var checkRoute = string.IsNullOrWhiteSpace(row.Get("Проверять маршрут")) ? false : ParseRequired(row.Get("Проверять маршрут")) ?? throw new InvalidDataException("В колонке «Проверять маршрут» укажите Да или Нет.");
                var item = ProcessCatalogService.NormalizeSourceRequirements([new(row.Get("ID пункта"), row.Get("Содержание"), row.Get("Источник"), EmptyToNull(row.Get("Место в источнике")), Split(row.Get("Элементы схемы ID")), checkRoute)])[0];
                if (!entries.TryGetValue(processId, out var list)) entries[processId] = list = [];
                if (list.Any(entry => entry.Id == item.Id)) Issue("Error", "ID пункта", "ID пункта повторяется внутри процесса.");
                list.Add(item);
                if (list.Count > 100) Issue("Error", "ID пункта", "Не более 100 пунктов на процесс.");
                if (item.ElementIds!.Count == 0) Issue("Warning", "Элементы схемы ID", "Пункт пока не сопоставлен со схемой.");
                foreach (var id in item.ElementIds.Where(id => !knownSteps.TryGetValue(processId, out var stepIds) || !stepIds.Contains(id)))
                    Issue("Warning", "Элементы схемы ID", $"Элемент «{id}» отсутствует на листе «Шаги» для этого процесса. Привязка сохранится как требующая уточнения.");
            }
            catch (InvalidDataException error) { Issue("Error", "Содержание", error.Message); }
        }
        return processes.Select(row => new SheetRow(row.Sheet, row.Number, new Dictionary<string, string>(row.Values, StringComparer.OrdinalIgnoreCase)
        { ["_Requirements"] = JsonSerializer.Serialize(entries.GetValueOrDefault(row.Get("ID процесса")) ?? []), ["_RequirementsRouteColumn"] = names.Contains("Проверять маршрут") ? "yes" : "no" })).ToArray();
    }

    private static IReadOnlyList<SheetRow> AttachEvidence(IReadOnlyDictionary<string, XElement> workbook, IReadOnlyList<SheetRow> steps, List<ProcessTableIssueModel> issues)
    {
        steps = steps.Select(row => new SheetRow(row.Sheet, row.Number, row.Values.Where(pair => !pair.Key.Equals("_Evidence", StringComparison.OrdinalIgnoreCase)).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase))).ToArray();
        if (!workbook.TryGetValue("Основания", out var sheet)) return steps;
        var rows = ReadRows(sheet);
        var header = sheet.Elements("row").FirstOrDefault(row => (int?)row.Attribute("number") == 3);
        var names = header?.Elements("cell").Select(cell => cell.Value.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
        foreach (var name in EvidenceHeaders.Skip(1).Where(name => !names.Contains(name)))
            issues.Add(new("Error", "Основания", 0, name, $"Отсутствует колонка «{name}»."));
        string Key(SheetRow row) => row.Get("ID процесса") + "\u001f" + row.Get("ID шага");
        var known = steps.Select(Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var entries = new Dictionary<string, List<StepEvidenceModel>>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            var key = Key(row);
            void Error(string column, string message) => issues.Add(new("Error", "Основания", row.Number, column, message, row.Get("ID процесса"), row.Get("ID шага")));
            if (!known.Contains(key)) { Error("ID шага", "Шаг не найден на листе «Шаги» в указанном процессе."); continue; }
            var status = row.Get("Статус сведений") switch { "Факт" or "fact" => "fact", "Предположение" or "assumption" => "assumption", "Вопрос" or "question" => "question", _ => "" };
            try
            {
                var item = ProcessCatalogService.NormalizeEvidence([new(status, row.Get("Содержание"), EmptyToNull(row.Get("Источник")), EmptyToNull(row.Get("Место в источнике")), EmptyToNull(row.Get("Автор сведений")))])[0];
                if (!entries.TryGetValue(key, out var list)) entries[key] = list = [];
                list.Add(item);
                if (list.Count > 20) Error("ID шага", "Не более 20 оснований и вопросов на шаг.");
                if (status != "fact") issues.Add(new("Warning", "Основания", row.Number, "Статус сведений", "Сведения требуют уточнения: " + item.Statement, row.Get("ID процесса"), row.Get("ID шага")));
            }
            catch (InvalidDataException error) { Error(status == "" ? "Статус сведений" : "Содержание", error.Message); }
        }
        return steps.Select(row => new SheetRow(row.Sheet, row.Number, new Dictionary<string, string>(row.Values, StringComparer.OrdinalIgnoreCase)
        { ["_Evidence"] = JsonSerializer.Serialize(entries.GetValueOrDefault(Key(row)) ?? []) })).ToArray();
    }

    private static void AddEvidenceSheet(ZipArchive archive, IReadOnlyList<IReadOnlyList<object?>> rows, bool requirements = false)
    {
        var key = requirements ? "requirements" : "evidence";
        var headers = requirements ? RequirementHeaders : EvidenceHeaders;
        var sheetName = requirements ? "Сверка" : "Основания";
        var path = $"xl/worksheets/{key}.xml";
        var tablePath = $"xl/tables/{key}.xml";
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace rel = "http://schemas.openxmlformats.org/package/2006/relationships";
        XNamespace officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        XNamespace content = "http://schemas.openxmlformats.org/package/2006/content-types";
        var sheet = ReadXml(archive, "xl/worksheets/sheet4.xml");
        sheet.Root?.Element(main + "dataValidations")?.Remove();
        sheet.Root?.Element(main + "mergeCells")?.Remove();
        sheet.Root?.Element(main + "cols")?.Remove();
        sheet.Root?.Element(main + "sheetData")?.AddBeforeSelf(new XElement(main + "cols", headers.Select((_, index) =>
            new XElement(main + "col", new XAttribute("min", index + 1), new XAttribute("max", index + 1), new XAttribute("width", (requirements ? index is 3 or 4 : index is 4 or 5) ? 60 : 28), new XAttribute("customWidth", 1)))));
        sheet.Root?.Element(main + "tableParts")?.ReplaceWith(new XElement(main + "tableParts", new XAttribute("count", 1), new XElement(main + "tablePart", new XAttribute(officeRel + "id", "rId" + key + "Table"))));
        ReplaceXml(archive, path, sheet);
        var table = ReadXml(archive, "xl/tables/table3.xml");
        var tableId = archive.Entries.Where(entry => entry.FullName.StartsWith("xl/tables/") && entry.FullName.EndsWith(".xml"))
            .Select(entry => (int?)ReadXml(entry).Root?.Attribute("id") ?? 0).DefaultIfEmpty().Max() + 1;
        table.Root?.SetAttributeValue("id", tableId);
        table.Root?.SetAttributeValue("name", requirements ? "SourceRequirements" : "StepEvidence");
        table.Root?.SetAttributeValue("displayName", requirements ? "SourceRequirements" : "StepEvidence");
        ReplaceXml(archive, tablePath, table);
        ReplaceXml(archive, $"xl/worksheets/_rels/{key}.xml.rels", new XDocument(new XElement(rel + "Relationships",
            new XElement(rel + "Relationship", new XAttribute("Id", "rId" + key + "Table"), new XAttribute("Type", officeRel.NamespaceName + "/table"), new XAttribute("Target", $"../tables/{key}.xml")))));
        RewriteDataSheet(archive, path, tablePath, rows, headers.Length, [],
            row => requirements ? $"IF(OR(B{row}=\"\",C{row}=\"\",D{row}=\"\",E{row}=\"\"),\"Заполнить обязательные поля\",IF(G{row}=\"\",\"Нет привязки\",\"Указаны привязки\"))" : $"IF(OR(B{row}=\"\",C{row}=\"\",D{row}=\"\",E{row}=\"\",AND(D{row}=\"Факт\",F{row}=\"\")),\"Заполнить обязательные поля\",\"Готово\")", headers);
        var readySheet = ReadXml(archive, path);
        if (!requirements) EnsureListValidation(readySheet, main, "D4:D500", "\"Факт,Предположение,Вопрос\"");
        else EnsureListValidation(readySheet, main, "H4:H500", "\"Да,Нет\"");
        foreach (var cell in readySheet.Descendants(main + "c").Where(cell => (string?)cell.Attribute("r") is "A1" or "A2"))
        {
            var title = requirements ? ((string?)cell.Attribute("r") == "A1" ? "Сверка исходного описания со схемой" : "Лист заменяет пункты всех процессов книги. Удалите лист, чтобы сохранить прежние пункты. Привязки разделяйте |.") : (string?)cell.Attribute("r") == "A1" ? "Основания и вопросы шагов" : "Лист заменяет записи всех шагов книги. Удалите лист целиком, чтобы сохранить прежние записи. Факт требует источника.";
            cell.RemoveNodes(); cell.SetAttributeValue("t", "str"); cell.Add(new XElement(main + "v", title));
        }
        ReplaceXml(archive, path, readySheet);
        var workbook = ReadXml(archive, "xl/workbook.xml");
        var sheets = workbook.Root!.Element(main + "sheets")!;
        sheets.Add(new XElement(main + "sheet", new XAttribute("name", sheetName), new XAttribute("sheetId", sheets.Elements().Max(item => (int)item.Attribute("sheetId")!) + 1), new XAttribute(officeRel + "id", "rId" + key)));
        ReplaceXml(archive, "xl/workbook.xml", workbook);
        var relations = ReadXml(archive, "xl/_rels/workbook.xml.rels");
        relations.Root!.Add(new XElement(rel + "Relationship", new XAttribute("Id", "rId" + key), new XAttribute("Type", officeRel.NamespaceName + "/worksheet"), new XAttribute("Target", $"worksheets/{key}.xml")));
        ReplaceXml(archive, "xl/_rels/workbook.xml.rels", relations);
        var types = ReadXml(archive, "[Content_Types].xml");
        types.Root!.Add(new XElement(content + "Override", new XAttribute("PartName", "/" + path), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")),
            new XElement(content + "Override", new XAttribute("PartName", "/" + tablePath), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml")));
        ReplaceXml(archive, "[Content_Types].xml", types);
    }

    private static void RewriteDataSheet(
        ZipArchive archive,
        string sheetPath,
        string tablePath,
        IReadOnlyList<IReadOnlyList<object?>> rows,
        int columnCount,
        IReadOnlyCollection<int> numericColumns,
        Func<int, string> formula,
        IReadOnlyList<string>? headers = null)
    {
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var document = ReadXml(archive, sheetPath);
        var sheetData = document.Root?.Element(main + "sheetData") ?? throw new InvalidDataException($"В шаблоне отсутствует sheetData: {sheetPath}.");
        if (headers is not null)
        {
            var headerRow = sheetData.Elements(main + "row").FirstOrDefault(row => (int?)row.Attribute("r") == 3)
                ?? throw new InvalidDataException($"В шаблоне отсутствует строка заголовков: {sheetPath}.");
            headerRow.RemoveNodes();
            for (var index = 0; index < headers.Count; index++)
                headerRow.Add(new XElement(main + "c", new XAttribute("r", $"{ColumnName(index + 1)}3"), new XAttribute("s", 10),
                    new XAttribute("t", "str"), new XElement(main + "v", headers[index])));
            var columns = document.Root?.Element(main + "cols");
            if (columns is not null)
                for (var index = columns.Elements(main + "col").Count() + 1; index <= headers.Count; index++)
                    columns.Add(new XElement(main + "col", new XAttribute("min", index), new XAttribute("max", index),
                        new XAttribute("width", index == 30 ? 70 : index is 22 or 26 ? 42 : 24), new XAttribute("hidden", 0), new XAttribute("customWidth", 1)));
        }
        sheetData.Elements(main + "row").Where(row => ((int?)row.Attribute("r") ?? 0) > 3).Remove();
        var outputRows = rows.Count == 0 ? new[] { Enumerable.Repeat<object?>(null, columnCount).ToArray() } : rows;
        for (var index = 0; index < outputRows.Count; index++)
        {
            var rowNumber = index + 4;
            var row = new XElement(main + "row", new XAttribute("r", rowNumber));
            for (var columnIndex = 1; columnIndex <= columnCount; columnIndex++)
            {
                var reference = $"{ColumnName(columnIndex)}{rowNumber}";
                var cell = new XElement(main + "c", new XAttribute("r", reference), new XAttribute("s", columnIndex == 1 ? 6 : 11));
                var value = columnIndex <= outputRows[index].Count ? outputRows[index][columnIndex - 1] : null;
                if (columnIndex == 1 && rows.Count > 0)
                {
                    cell.SetAttributeValue("t", "str");
                    cell.Add(new XElement(main + "f", formula(rowNumber)), new XElement(main + "v", CompletionStatus(sheetPath, outputRows[index])));
                }
                else if (value is not null && numericColumns.Contains(columnIndex))
                {
                    cell.SetAttributeValue("t", "n");
                    cell.Add(new XElement(main + "v", Convert.ToString(value, CultureInfo.InvariantCulture)));
                }
                else
                {
                    cell.SetAttributeValue("t", "str");
                    cell.Add(new XElement(main + "v", value?.ToString() ?? string.Empty));
                }
                row.Add(cell);
            }
            sheetData.Add(row);
        }
        var lastRow = Math.Max(4, rows.Count + 3);
        var dimension = document.Root?.Element(main + "dimension");
        if (dimension is null) document.Root?.AddFirst(new XElement(main + "dimension", new XAttribute("ref", $"A1:{ColumnName(columnCount)}{lastRow}")));
        else dimension.SetAttributeValue("ref", $"A1:{ColumnName(columnCount)}{lastRow}");
        foreach (var formatting in document.Descendants(main + "conditionalFormatting")) formatting.SetAttributeValue("sqref", $"A4:A{lastRow}");
        if (headers == StepHeaders)
        {
            EnsureListValidation(document, main, "E4:E500", "\"startEvent,endEvent,task,exclusiveGateway,parallelGateway\"");
            EnsureListValidation(document, main, "W4:W500", "\"Input,Output,Reference\"");
            EnsureListValidation(document, main, "X4:X500", "\"Да,Нет\"");
            EnsureListValidation(document, main, "AA4:AA500", "\"task,userTask,manualTask,serviceTask,sendTask,receiveTask,businessRuleTask,startEvent,endEvent,exclusiveGateway,parallelGateway\"");
            EnsureListValidation(document, main, "AB4:AB500", "\"manual,external,system\"");
            EnsureListValidation(document, main, "AE4:AE500", "\"human,system\"");
        }
        foreach (var validation in document.Descendants(main + "dataValidation"))
        {
            var range = (string?)validation.Attribute("sqref");
            var match = Regex.Match(range ?? string.Empty, "^(?<column>[A-Z]+)4:\\k<column>[0-9]+$");
            if (match.Success) validation.SetAttributeValue("sqref", $"{match.Groups["column"].Value}4:{match.Groups["column"].Value}{Math.Max(500, lastRow)}");
        }
        ReplaceXml(archive, sheetPath, document);

        var table = ReadXml(archive, tablePath);
        table.Root?.SetAttributeValue("ref", $"A3:{ColumnName(columnCount)}{lastRow}");
        table.Root?.Element(main + "autoFilter")?.SetAttributeValue("ref", $"A3:{ColumnName(columnCount)}{lastRow}");
        if (headers is not null)
        {
            var tableColumns = table.Root?.Element(main + "tableColumns") ?? throw new InvalidDataException("В шаблоне отсутствуют столбцы таблицы.");
            tableColumns.RemoveNodes();
            tableColumns.SetAttributeValue("count", headers.Count);
            for (var index = 0; index < headers.Count; index++)
                tableColumns.Add(new XElement(main + "tableColumn", new XAttribute("id", index + 1), new XAttribute("name", headers[index])));
        }
        ReplaceXml(archive, tablePath, table);
    }

    private static void EnsureListValidation(XDocument document, XNamespace main, string range, string values)
    {
        var validations = document.Root?.Element(main + "dataValidations");
        if (validations is null)
        {
            validations = new XElement(main + "dataValidations");
            document.Root?.Add(validations);
        }
        if (validations.Elements(main + "dataValidation").Any(item => string.Equals((string?)item.Attribute("sqref"), range, StringComparison.OrdinalIgnoreCase)))
            return;
        validations.Add(new XElement(main + "dataValidation",
            new XAttribute("type", "list"),
            new XAttribute("allowBlank", 1),
            new XAttribute("showErrorMessage", 1),
            new XAttribute("errorStyle", "stop"),
            new XAttribute("errorTitle", "Недопустимое значение"),
            new XAttribute("error", "Выберите значение из списка."),
            new XAttribute("sqref", range),
            new XElement(main + "formula1", values)));
        validations.SetAttributeValue("count", validations.Elements(main + "dataValidation").Count());
    }

    private static void RewriteDictionaries(ZipArchive archive, OrganizationMapModel organization)
    {
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var path = "xl/worksheets/sheet5.xml";
        var document = ReadXml(archive, path);
        var sheetData = document.Root?.Element(main + "sheetData") ?? throw new InvalidDataException("В шаблоне отсутствует лист справочников.");
        sheetData.Elements(main + "row").Where(row => ((int?)row.Attribute("r") ?? 0) > 3).Remove();
        var units = organization.LegalEntities.SelectMany(entity => (entity.Units ?? []).Select(unit => new[]
        {
            entity.Id, entity.Name, unit.Id, string.IsNullOrWhiteSpace(unit.ShortName) ? unit.Name : $"{unit.ShortName} — {unit.Name}"
        })).ToArray();
        string?[][] options =
        [
            ["system", "primary", "input", "startEvent"], ["email", "alternative", "work", "task"],
            ["paper", "parallel", "output", "exclusiveGateway"], ["phone", null, null, "endEvent"],
            ["memo", null, null, null], ["meeting", null, null, null], ["other", null, null, null]
        ];
        var count = Math.Max(units.Length, options.Length);
        for (var index = 0; index < count; index++)
        {
            var rowNumber = index + 4;
            var values = new string?[9];
            if (index < units.Length) Array.Copy(units[index], 0, values, 0, 4);
            if (index < options.Length) Array.Copy(options[index], 0, values, 5, 4);
            var row = new XElement(main + "row", new XAttribute("r", rowNumber));
            for (var column = 1; column <= 9; column++)
                row.Add(new XElement(main + "c", new XAttribute("r", $"{ColumnName(column)}{rowNumber}"), new XAttribute("s", 6),
                    new XAttribute("t", "str"), new XElement(main + "v", values[column - 1] ?? string.Empty)));
            sheetData.Add(row);
        }
        ReplaceXml(archive, path, document);
    }

    private static void UpdateGuide(ZipArchive archive)
    {
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var path = "xl/worksheets/sheet1.xml";
        var document = ReadXml(archive, path);
        var cell = document.Descendants(main + "c").FirstOrDefault(item => (string?)item.Attribute("r") == "B12");
        if (cell is not null)
        {
            cell.SetAttributeValue("t", "str");
            cell.RemoveNodes();
            cell.Add(new XElement(main + "v", "Книгу можно проверить и загрузить обратно. Устойчивые ID обновляют соответствующие черновики без создания дублей."));
        }
        ReplaceXml(archive, path, document);
    }

    private static string CompletionStatus(string sheetPath, IReadOnlyList<object?> row)
    {
        string Value(int oneBasedIndex) => oneBasedIndex <= row.Count ? row[oneBasedIndex - 1]?.ToString()?.Trim() ?? string.Empty : string.Empty;
        if (sheetPath.EndsWith("requirements.xml", StringComparison.Ordinal))
            return new[] { 2, 3, 4, 5 }.Any(index => string.IsNullOrWhiteSpace(Value(index))) ? "Заполнить обязательные поля" : string.IsNullOrWhiteSpace(Value(7)) ? "Нет привязки" : "Указаны привязки";
        if (sheetPath.EndsWith("evidence.xml", StringComparison.Ordinal))
            return new[] { 2, 3, 4, 5 }.Any(index => string.IsNullOrWhiteSpace(Value(index))) || (Value(4) == "Факт" && string.IsNullOrWhiteSpace(Value(6))) ? "Заполнить обязательные поля" : "Готово";
        if (sheetPath.EndsWith("sheet2.xml", StringComparison.OrdinalIgnoreCase))
            return string.IsNullOrWhiteSpace(Value(2)) || string.IsNullOrWhiteSpace(Value(3)) || string.IsNullOrWhiteSpace(Value(7)) ||
                string.IsNullOrWhiteSpace(Value(8)) || string.IsNullOrWhiteSpace(Value(11)) || string.IsNullOrWhiteSpace(Value(13)) ||
                (int.TryParse(Value(4), out var level) && level > 0 && string.IsNullOrWhiteSpace(Value(5))) ? "Заполнить обязательные поля" : "Готово";
        if (sheetPath.EndsWith("sheet3.xml", StringComparison.OrdinalIgnoreCase))
        {
            if (new[] { 2, 4, 5, 6 }.Any(index => string.IsNullOrWhiteSpace(Value(index)))) return "Заполнить обязательные поля";
            if (Value(5) is not ("startEvent" or "endEvent") && string.IsNullOrWhiteSpace(Value(9))) return "Указать подразделение";
            return Value(5) == "task" && string.IsNullOrWhiteSpace(Value(14)) ? "Указать результат" : "Готово";
        }
        if (new[] { 2, 3, 4, 5, 6, 7, 8 }.Any(index => string.IsNullOrWhiteSpace(Value(index)))) return "Заполнить обязательные поля";
        return Value(5) == "system" && string.IsNullOrWhiteSpace(Value(9)) ? "Указать систему" : "Готово";
    }

    private static void ReplaceXml(ZipArchive archive, string path, XDocument document)
    {
        archive.GetEntry(path)?.Delete();
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false });
        document.Save(writer);
    }

    private static string ColumnName(int oneBasedIndex)
    {
        var value = oneBasedIndex;
        var result = string.Empty;
        while (value > 0) { value--; result = (char)('A' + value % 26) + result; value /= 26; }
        return result;
    }

    private static string? ResolveExecutorKind(SheetRow row, NodeModel? existing)
    {
        if (row.Has("Исполнитель действия")) return EmptyToNull(row.Get("Исполнитель действия"));
        return existing?.ExecutorKind;
    }

    private static string ResolveBpmnType(SheetRow row, NodeModel? existing)
    {
        var general = ElementTypes.FirstOrDefault(type => type.Equals(row.Get("Тип"), StringComparison.OrdinalIgnoreCase)) ?? row.Get("Тип");
        if (general != "task") return general;
        var explicitType = row.Get("Тип BPMN");
        if (!string.IsNullOrWhiteSpace(explicitType)) return explicitType;
        return existing?.Type == "task" ? existing.BpmnType ?? "task" : "task";
    }

    private static string BuildBpmn(string processId, string processName, IReadOnlyList<SheetRow> steps, IReadOnlyList<GeneratedLane> lanes, ProcessModel? existing)
    {
        XNamespace bpmn = "http://www.omg.org/spec/BPMN/20100524/MODEL";
        XNamespace bpmndi = "http://www.omg.org/spec/BPMN/20100524/DI";
        XNamespace dc = "http://www.omg.org/spec/DD/20100524/DC";
        XNamespace di = "http://www.omg.org/spec/DD/20100524/DI";
        var existingNodes = existing?.Nodes.ToDictionary(node => node.Id, StringComparer.OrdinalIgnoreCase)
            ?? new Dictionary<string, NodeModel>(StringComparer.OrdinalIgnoreCase);
        var laneLayouts = lanes.Select((lane, index) =>
        {
            var existingLane = existing?.Lanes.FirstOrDefault(item => item.Id.Equals(lane.Id, StringComparison.OrdinalIgnoreCase));
            return new { Y = existingLane?.Y ?? 40 + index * 180, Height = existingLane?.Height ?? 180d };
        }).ToArray();
        var ordered = steps.Select((row, index) =>
        {
            var laneIndex = Array.FindIndex(lanes.ToArray(), lane => lane.Id.Equals(row.Get("Дорожка ID"), StringComparison.OrdinalIgnoreCase));
            var type = row.Get("Тип");
            var width = type == "task" ? 180d : type is "exclusiveGateway" or "parallelGateway" ? 56d : 44d;
            var height = type == "task" ? 90d : type is "exclusiveGateway" or "parallelGateway" ? 56d : 44d;
            if (existingNodes.TryGetValue(row.Get("ID шага"), out var existingNode) &&
                existingNode.Type.Equals(type, StringComparison.OrdinalIgnoreCase) && existingNode.LaneId.Equals(row.Get("Дорожка ID"), StringComparison.OrdinalIgnoreCase))
                return new GeneratedNode(row, existingNode.X, existingNode.Y, existingNode.Width, existingNode.Height);
            var layout = laneLayouts[laneIndex];
            return new GeneratedNode(row, 160 + index * 250, layout.Y + (layout.Height - height) / 2, width, height);
        }).ToArray();
        var nodes = ordered.ToDictionary(item => item.Row.Get("ID шага"), StringComparer.OrdinalIgnoreCase);
        var edges = new List<GeneratedEdge>(); var edgeNumber = 0;
        var availableEdges = existing?.Edges.ToList() ?? [];
        var usedEdgeIds = new HashSet<string>(availableEdges.Select(edge => edge.Id), StringComparer.OrdinalIgnoreCase);
        string NextEdgeId()
        {
            string id;
            do { id = $"Flow_{++edgeNumber}"; } while (!usedEdgeIds.Add(id));
            return id;
        }
        foreach (var source in ordered)
        {
            var targets = Split(source.Row.Get("Следующие шаги"));
            var labels = Split(source.Row.Get("Условия переходов"), preserveEmpty: true);
            for (var index = 0; index < targets.Count; index++)
            {
                var label = index < labels.Count ? EmptyToNull(labels[index]) : null;
                var preserved = availableEdges.FirstOrDefault(edge => edge.SourceId.Equals(source.Row.Get("ID шага"), StringComparison.OrdinalIgnoreCase) &&
                    edge.TargetId.Equals(targets[index], StringComparison.OrdinalIgnoreCase) && Same(edge.Label, label));
                if (preserved is not null) availableEdges.Remove(preserved);
                edges.Add(new(preserved?.Id ?? NextEdgeId(), source.Row.Get("ID шага"), targets[index], label, preserved?.Points ?? []));
            }
        }
        var processElement = new XElement(bpmn + "process", new XAttribute("id", processId), new XAttribute("name", processName), new XAttribute("isExecutable", "false"));
        var laneSet = new XElement(bpmn + "laneSet", new XAttribute("id", $"LaneSet_{processId}"));
        foreach (var lane in lanes)
            laneSet.Add(new XElement(bpmn + "lane", new XAttribute("id", lane.Id), new XAttribute("name", lane.Name),
                ordered.Where(node => node.Row.Get("Дорожка ID").Equals(lane.Id, StringComparison.OrdinalIgnoreCase))
                    .Select(node => new XElement(bpmn + "flowNodeRef", node.Row.Get("ID шага")))));
        processElement.Add(laneSet);
        foreach (var node in ordered)
        {
            existingNodes.TryGetValue(node.Row.Get("ID шага"), out var originalNode);
            var localName = ResolveBpmnType(node.Row, originalNode);
            var element = new XElement(bpmn + localName, new XAttribute("id", node.Row.Get("ID шага")), new XAttribute("name", node.Row.Get("Название")));
            foreach (var edge in edges.Where(edge => edge.TargetId.Equals(node.Row.Get("ID шага"), StringComparison.OrdinalIgnoreCase))) element.Add(new XElement(bpmn + "incoming", edge.Id));
            foreach (var edge in edges.Where(edge => edge.SourceId.Equals(node.Row.Get("ID шага"), StringComparison.OrdinalIgnoreCase))) element.Add(new XElement(bpmn + "outgoing", edge.Id));
            processElement.Add(element);
        }
        foreach (var edge in edges)
        {
            var element = new XElement(bpmn + "sequenceFlow", new XAttribute("id", edge.Id), new XAttribute("sourceRef", edge.SourceId), new XAttribute("targetRef", edge.TargetId));
            if (edge.Label is not null) element.SetAttributeValue("name", edge.Label);
            processElement.Add(element);
        }

        var width = Math.Max(1100, ordered.Max(node => node.X + node.Width) + 180);
        var plane = new XElement(bpmndi + "BPMNPlane", new XAttribute("id", $"Plane_{processId}"), new XAttribute("bpmnElement", processId));
        for (var index = 0; index < lanes.Count; index++)
            plane.Add(new XElement(bpmndi + "BPMNShape", new XAttribute("id", $"{lanes[index].Id}_di"), new XAttribute("bpmnElement", lanes[index].Id), new XAttribute("isHorizontal", "true"),
                new XElement(dc + "Bounds", new XAttribute("x", 45), new XAttribute("y", laneLayouts[index].Y), new XAttribute("width", width), new XAttribute("height", laneLayouts[index].Height))));
        foreach (var node in ordered)
            plane.Add(new XElement(bpmndi + "BPMNShape", new XAttribute("id", $"{node.Row.Get("ID шага")}_di"), new XAttribute("bpmnElement", node.Row.Get("ID шага")),
                new XElement(dc + "Bounds", new XAttribute("x", node.X), new XAttribute("y", node.Y), new XAttribute("width", node.Width), new XAttribute("height", node.Height))));
        foreach (var edge in edges)
        {
            var points = edge.Points;
            if (points.Count < 2)
            {
                var source = nodes[edge.SourceId]; var target = nodes[edge.TargetId];
                var sourceX = source.X + source.Width; var sourceY = source.Y + source.Height / 2; var targetX = target.X; var targetY = target.Y + target.Height / 2;
                var middle = (sourceX + targetX) / 2;
                points = [new(sourceX, sourceY), new(middle, sourceY), new(middle, targetY), new(targetX, targetY)];
            }
            plane.Add(new XElement(bpmndi + "BPMNEdge", new XAttribute("id", $"{edge.Id}_di"), new XAttribute("bpmnElement", edge.Id),
                points.Select(point => new XElement(di + "waypoint", new XAttribute("x", point.X), new XAttribute("y", point.Y)))));
        }
        var document = new XDocument(new XDeclaration("1.0", "UTF-8", null),
            new XElement(bpmn + "definitions", new XAttribute(XNamespace.Xmlns + "bpmn", bpmn), new XAttribute(XNamespace.Xmlns + "bpmndi", bpmndi),
                new XAttribute(XNamespace.Xmlns + "dc", dc), new XAttribute(XNamespace.Xmlns + "di", di), new XAttribute("id", $"Definitions_{processId}"),
                new XAttribute("targetNamespace", "https://process-navigator.local/table"), processElement,
                new XElement(bpmndi + "BPMNDiagram", new XAttribute("id", $"Diagram_{processId}"), plane)));
        return document.ToString(SaveOptions.DisableFormatting);
    }

    private static ProcessTablePreviewModel Build(string fileName, IReadOnlyList<TableProcess> processes, IReadOnlyList<TableStep> steps,
        IReadOnlyList<TableChannel> channels, IReadOnlyCollection<string> catalogIds, IReadOnlyList<ProcessTableIssueModel> issues,
        IReadOnlyDictionary<string, ProcessTableChangeSummary> changes)
    {
        var items = processes.Where(item => !string.IsNullOrWhiteSpace(item.Id)).Select(process =>
        {
            var own = issues.Where(issue => process.Id.Equals(issue.ProcessId, StringComparison.OrdinalIgnoreCase)).ToArray();
            changes.TryGetValue(process.Id, out var change);
            return new ProcessTablePreviewItemModel(process.Id, process.Name, catalogIds.Contains(process.Id) ? "Update" : "New", process.Level,
                steps.Count(item => item.ProcessId.Equals(process.Id, StringComparison.OrdinalIgnoreCase)),
                channels.Count(item => item.ProcessId.Equals(process.Id, StringComparison.OrdinalIgnoreCase)),
                own.Count(item => item.Severity == "Error"), own.Count(item => item.Severity == "Warning"),
                change?.ProcessChanged ?? false, change?.Added ?? 0, change?.Modified ?? 0, change?.Removed ?? 0,
                change?.Unchanged ?? 0, change?.Changes ?? [], change?.FieldChanges ?? [], change?.RenameSuggestions ?? []);
        }).ToArray();
        var errors = issues.Count(item => item.Severity == "Error");
        return new(fileName, processes.Count, items.Count(item => item.Status == "New"), items.Count(item => item.Status == "Update"),
            steps.Count, channels.Count, errors, issues.Count - errors, errors == 0, items, issues.Take(300).ToArray());
    }

    private static async Task<Dictionary<string, XElement>> LoadWorkbookAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length is <= 0 or > MaximumFileSize) throw new InvalidDataException("Файл Excel пуст или превышает 10 МБ.");
        if (!Path.GetExtension(file.FileName).Equals(".xlsx", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Поддерживается только файл Excel в формате .xlsx.");
        await using var source = file.OpenReadStream();
        using var memory = new MemoryStream();
        await source.CopyToAsync(memory, cancellationToken);
        memory.Position = 0;
        using var archive = new ZipArchive(memory, ZipArchiveMode.Read, leaveOpen: false);
        if (archive.Entries.Count > MaximumEntries || archive.Entries.Sum(entry => entry.Length) > MaximumExpandedSize)
            throw new InvalidDataException("Содержимое книги превышает безопасный предел.");
        return ReadWorkbook(archive);
    }

    private static Dictionary<string, XElement> ReadWorkbook(ZipArchive archive)
    {
        var sharedStrings = ReadSharedStrings(archive);
        var workbook = ReadXml(archive, "xl/workbook.xml");
        var relationships = ReadXml(archive, "xl/_rels/workbook.xml.rels");
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        XNamespace packageRel = "http://schemas.openxmlformats.org/package/2006/relationships";
        var targets = relationships.Descendants(packageRel + "Relationship").ToDictionary(item => (string?)item.Attribute("Id") ?? "", item => (string?)item.Attribute("Target") ?? "");
        var result = new Dictionary<string, XElement>(StringComparer.OrdinalIgnoreCase);
        foreach (var sheet in workbook.Descendants(main + "sheet"))
        {
            var name = (string?)sheet.Attribute("name") ?? ""; var relationshipId = (string?)sheet.Attribute(rel + "id") ?? "";
            if (!targets.TryGetValue(relationshipId, out var target)) continue;
            var normalizedTarget = target.Replace('\\', '/').TrimStart('/');
            var normalized = normalizedTarget.StartsWith("xl/", StringComparison.OrdinalIgnoreCase)
                ? normalizedTarget
                : "xl/" + normalizedTarget;
            var xml = ReadXml(archive, normalized);
            var expanded = ExpandCells(xml, sharedStrings);
            expanded.SetAttributeValue("name", name);
            result[name] = expanded;
        }
        return result;
    }

    private static XElement ExpandCells(XDocument sheet, IReadOnlyList<string> sharedStrings)
    {
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var root = new XElement("sheet");
        foreach (var row in sheet.Descendants(main + "row"))
        {
            var output = new XElement("row", new XAttribute("number", (string?)row.Attribute("r") ?? "0"));
            foreach (var cell in row.Elements(main + "c"))
            {
                var reference = (string?)cell.Attribute("r") ?? ""; var type = (string?)cell.Attribute("t") ?? "";
                var raw = (string?)cell.Element(main + "v") ?? "";
                var value = type switch
                {
                    "s" when int.TryParse(raw, out var index) && index >= 0 && index < sharedStrings.Count => sharedStrings[index],
                    "inlineStr" => string.Concat(cell.Descendants(main + "t").Select(item => item.Value)),
                    "b" => raw == "1" ? "TRUE" : "FALSE",
                    _ => raw
                };
                output.Add(new XElement("cell", new XAttribute("column", Column(reference)), value));
            }
            root.Add(output);
        }
        return root;
    }

    private static IReadOnlyList<string> ReadSharedStrings(ZipArchive archive)
    {
        var entry = archive.GetEntry("xl/sharedStrings.xml"); if (entry is null) return [];
        var document = ReadXml(entry); XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        return document.Descendants(main + "si").Select(item => string.Concat(item.Descendants(main + "t").Select(text => text.Value))).ToArray();
    }

    private static IReadOnlyList<SheetRow> ReadRows(XElement sheet)
    {
        var all = sheet.Elements("row").ToDictionary(row => (int?)row.Attribute("number") ?? 0);
        if (!all.TryGetValue(3, out var header)) throw new InvalidDataException("В табличном шаблоне не найдена строка заголовков 3.");
        var headers = header.Elements("cell").ToDictionary(cell => (string?)cell.Attribute("column") ?? "", cell => cell.Value.Trim());
        return all.Where(pair => pair.Key > 3).OrderBy(pair => pair.Key).Select(pair =>
        {
            var values = pair.Value.Elements("cell").ToDictionary(cell => (string?)cell.Attribute("column") ?? "", cell => cell.Value.Trim());
            return new SheetRow((string?)sheet.Attribute("name") ?? "", pair.Key, headers.ToDictionary(item => item.Value, item => values.GetValueOrDefault(item.Key, ""), StringComparer.OrdinalIgnoreCase));
        }).Where(row => row.Values.Any(value => !string.IsNullOrWhiteSpace(value.Value)) && row.Values.Any(value => value.Key != "Статус заполнения" && !string.IsNullOrWhiteSpace(value.Value))).ToArray();
    }

    private static XDocument ReadXml(ZipArchive archive, string path) => ReadXml(archive.GetEntry(path) ?? throw new InvalidDataException($"В книге отсутствует служебная часть «{path}»."));
    private static XDocument ReadXml(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 20_000_000 });
        return XDocument.Load(reader, LoadOptions.None);
    }
    private static string Column(string reference) => new(reference.TakeWhile(char.IsLetter).ToArray());
    private static string? EmptyToNull(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static int? ParseInteger(string value) => int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result) ? result : null;
    private static bool? ParseRequired(string value) => value.Trim().ToLowerInvariant() switch
    {
        "да" or "yes" or "true" or "1" => true,
        "нет" or "no" or "false" or "0" => false,
        _ => null
    };
    private static string Join(IEnumerable<string?>? values, bool preserveEmpty = false) => values is null ? string.Empty :
        string.Join(" | ", values.Select(value => value?.Trim() ?? string.Empty).Where(value => preserveEmpty || value.Length > 0));
    private static IReadOnlyList<string> Split(string value, bool preserveEmpty = false) => string.IsNullOrWhiteSpace(value) ? [] : value.Split('|').Select(item => item.Trim()).Where(item => preserveEmpty || item.Length > 0).ToArray();

    [GeneratedRegex("^[A-Za-z0-9._-]+$")]
    private static partial Regex TechnicalId();

    private sealed record TableProcess(string Id, string Name, int? Level);
    private sealed record TableStep(string ProcessId, string StepId);
    private sealed record TableChannel(string ProcessId, string StepId, string ChannelId);
    private sealed record GeneratedProcess(string Bpmn, string Context, IReadOnlyList<LaneOrganizationModel> LaneMappings,
        IReadOnlyList<LaneAssignmentUpdateModel> Assignments);
    private sealed record GeneratedLane(string Id, string Name, string LegalEntityId, string UnitId, string Department,
        string DisplayNameMode, IReadOnlyList<string> UserIds);
    private sealed record GeneratedNode(SheetRow Row, double X, double Y, double Width, double Height);
    private sealed record GeneratedEdge(string Id, string SourceId, string TargetId, string? Label, IReadOnlyList<PointModel> Points);
    private sealed record ProcessTableChangeSummary(bool ProcessChanged, int Added, int Modified, int Removed, int Unchanged,
        IReadOnlyList<string> Changes, IReadOnlyList<ProcessTableFieldChangeModel> FieldChanges,
        IReadOnlyList<ProcessTableRenameSuggestionModel> RenameSuggestions);
    private sealed record SheetRow(string Sheet, int Number, IReadOnlyDictionary<string, string> Values)
    {
        public string Get(string name) => Values.GetValueOrDefault(name, "").Trim();
        public bool Has(string name) => Values.ContainsKey(name);
    }
}
