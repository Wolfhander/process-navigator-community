using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

// Deliberately limited event support. No mail polling, expressions, timer cycles or
// automatic background mutations. A message timeout never means message receipt.
public static class WaitEvents
{
    public static WaitEventModel? Normalize(WaitEventModel? value)
    {
        if(value is null)return null;
        string? Text(string? s,int limit){if(s is null)return null;s=s.Trim();if(s.Length>limit||s.Any(char.IsControl))throw new InvalidDataException("Слишком длинное поле ожидания или управляющие символы.");return s.Length==0?null:s;}
        if(value.Kind is not ("message" or "timer" or "unsupported"))throw new InvalidDataException("Тип ожидания: message или timer.");
        foreach(var n in new[]{value.DurationMinutes,value.TimeoutMinutes,value.ExpectedMinutes})
            if(n is not null&&(!double.IsFinite(n.Value)||n<=0||n>525600))throw new InvalidDataException("Время ожидания: конечное положительное число календарных минут, не более 365 суток.");
        if(value.Kind=="timer"&&(value.TimeoutMinutes is not null||value.ExpectedMinutes is not null))throw new InvalidDataException("У таймера задаётся длительность, не прогноз сообщения или тайм-аут.");
        if(value.Kind=="message"&&value.DurationMinutes is not null)throw new InvalidDataException("Для сообщения задаются прогноз и тайм-аут, не длительность таймера.");
        if(value.Kind=="message"&&value.ExpectedMinutes is not null&&value.TimeoutMinutes is not null&&value.ExpectedMinutes>=value.TimeoutMinutes)
            throw new InvalidDataException("Прогноз своевременного сообщения должен быть меньше тайм-аута.");
        return value with{Source=Text(value.Source,200),Channel=Text(value.Channel,200),MessageName=Text(value.MessageName,300),
            CorrelationKey=Text(value.CorrelationKey,200),UnsupportedDefinition=Text(value.UnsupportedDefinition,2000),BpmnMessageRef=Text(value.BpmnMessageRef,200)};
    }
    public static string? Problem(WaitEventModel? value)
    {
        if(value is null)return null;
        value=Normalize(value)!;
        if(value.Kind=="unsupported")return "Определение события пока не поддерживается: "+value.UnsupportedDefinition;
        if(value.Kind=="timer"&&value.DurationMinutes is null)return "Укажите длительность таймера.";
        if(value.Kind=="message"&&(value.Source is null||value.Channel is null||value.MessageName is null))
            return "Для сообщения укажите источник, канал и ожидаемое сообщение.";
        return null;
    }
    public static double? Minutes(NodeModel node)=>node.WaitEvent is { } wait
        ? wait.Kind=="timer"?wait.DurationMinutes:wait.Kind=="message"?wait.ExpectedMinutes:null:null;
    public static WaitEventModel? Read(XElement element,WaitEventModel? context)
    {
        context=Normalize(context);XNamespace b="http://www.omg.org/spec/BPMN/20100524/MODEL";
        var kind=element.Name.LocalName;
        if(kind=="startEvent"&&element.Elements().Any(e=>e.Name.LocalName.EndsWith("EventDefinition",StringComparison.Ordinal)))
            return new("unsupported",UnsupportedDefinition:"Специальное событие запуска не исполняется вручную как обычный startEvent.");
        if(kind!="intermediateCatchEvent"){
            if(kind=="receiveTask"){
                if(context is not null&&context.Kind!="message")throw new InvalidDataException("receiveTask ожидает сообщение, не таймер.");
                return Normalize((context??new("message",MessageName:(string?)element.Attribute("messageRef"))) with{BpmnMessageRef=(string?)element.Attribute("messageRef")});
            }
            if(context is not null&&kind is not ("task" or "userTask" or "manualTask" or "serviceTask"))
                throw new InvalidDataException("Ожидание допускается на действии или intermediateCatchEvent.");
            return context is null?null:context with{BpmnMessageRef=null};
        }
        var defs=element.Elements().Where(e=>e.Name.LocalName.EndsWith("EventDefinition",StringComparison.Ordinal)).ToArray();
        if(defs.Length!=1)return new("unsupported",UnsupportedDefinition:"Нужно одно messageEventDefinition либо timerEventDefinition.");
        if(defs[0].Name==b+"messageEventDefinition"){
            if(context is not null&&context.Kind!="message")throw new InvalidDataException("Тип ожидания отличается от сообщения BPMN.");
            return Normalize((context??new("message",MessageName:(string?)defs[0].Attribute("messageRef"))) with{BpmnMessageRef=(string?)defs[0].Attribute("messageRef")});
        }
        if(defs[0].Name==b+"timerEventDefinition"){
            var duration=defs[0].Element(b+"timeDuration")?.Value.Trim();
            if(defs[0].Elements().Count()!=1||duration is null||
                !Regex.IsMatch(duration,@"^P(?=.+)(?:\d+(?:\.\d+)?D)?(?:T(?=.+)(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$",RegexOptions.CultureInvariant))
                return new("unsupported",UnsupportedDefinition:"Поддержан фиксированный timeDuration (дни/часы/минуты/секунды), без timeDate, timeCycle и выражений.");
            double minutes;
            try{minutes=XmlConvert.ToTimeSpan(duration).TotalMinutes;}catch(Exception e) when(e is FormatException or OverflowException){return new("unsupported",UnsupportedDefinition:"Некорректный timeDuration.");}
            if(context is not null&&(context.Kind!="timer"||context.DurationMinutes is not null&&Math.Abs(context.DurationMinutes.Value-minutes)>1e-7))
                throw new InvalidDataException("Контекст таймера отличается от timeDuration BPMN; измените само определение BPMN.");
            return Normalize((context??new("timer")) with{DurationMinutes=minutes,BpmnMessageRef=null});
        }
        return new("unsupported",UnsupportedDefinition:defs[0].Name.LocalName);
    }
    public static WaitExecutionModel Transition(WaitExecutionModel current,WaitActionModel command,int iteration,DateTimeOffset now)
    {
        if(command.ExpectedIteration<1||iteration<1||command.ExpectedIteration!=iteration)throw new InvalidDataException("Проход изменился. Обновите выполнение перед подтверждением события.");
        var problem=Problem(current.Specification);if(problem is not null)throw new InvalidDataException(problem);
        var spec=current.Specification;
        var evidence=command.Evidence?.Trim();var key=command.CorrelationKey?.Trim();
        if(evidence?.Length>2000||key?.Length>200)throw new InvalidDataException("Слишком длинное основание события или ключ сопоставления.");
        if(command.Action=="Begin"){
            if(current.Status=="Open")return current;
            if(current.Status!="Pending")throw new InvalidDataException("Ожидание уже завершено.");
            var minutes=spec.Kind=="timer"?spec.DurationMinutes:spec.TimeoutMinutes;
            return current with{Status="Open",StartedAt=now,DueAt=minutes is not null?now.AddMinutes(minutes.Value):null};
        }
        var outcome=command.Action switch{"Receive" when spec.Kind=="message"=>"Received","CheckTimer" when spec.Kind=="timer"=>"Elapsed",
            "CheckTimeout" when spec.Kind=="message"&&spec.TimeoutMinutes is not null=>"TimedOut",_=>throw new InvalidDataException("Действие не соответствует типу ожидания.")};
        if(current.Status==outcome){
            if(outcome=="Received"&&(evidence!=current.Evidence||key!=current.CorrelationKey))throw new InvalidDataException("Уже записано другое подтверждение сообщения.");
            return current;
        }
        if(current.Status!="Open"||current.StartedAt is null)throw new InvalidDataException("Сначала запустите ожидание; завершённое событие нельзя заменить.");
        if(outcome=="Received"){
            if(evidence?.Length is not >=3)throw new InvalidDataException("Укажите основание фактического получения сообщения (3–2000 символов).");
            if(spec.CorrelationKey is not null&&key!=spec.CorrelationKey)throw new InvalidDataException("Ключ сообщения не соответствует ожидаемому.");
            if(current.DueAt is not null&&now>=current.DueAt)throw new InvalidDataException("Срок получения истёк. Явно проверьте тайм-аут; просрочку нельзя выдать за своевременное сообщение.");
        }else if(current.DueAt is null||now<current.DueAt)throw new InvalidDataException("Срок ещё не наступил.");
        return current with{Status=outcome,ResolvedAt=now,Evidence=outcome=="Received"?evidence:null,CorrelationKey=outcome=="Received"?key:null};
    }
    public static void Validate(WaitExecutionModel? value,string? stepStatus=null)
    {
        if(value is null)return;
        if(Problem(value.Specification) is { } problem)throw new InvalidDataException(problem);
        if(value.Status is not ("Pending" or "Open" or "Received" or "Elapsed" or "TimedOut")||
            value.Status=="Pending"&&(value.StartedAt is not null||value.ResolvedAt is not null||value.DueAt is not null)||
            value.Status!="Pending"&&value.StartedAt is null||
            value.Status=="Open"&&value.ResolvedAt is not null||
            value.Status is "Received" or "Elapsed" or "TimedOut"&&value.ResolvedAt is null||
            value.ResolvedAt<value.StartedAt||value.DueAt<value.StartedAt)
            throw new InvalidDataException("Повреждено сохранённое ожидание. Автоматическая замена запрещена.");
        if(value.StartedAt is not null){
            var minutes=value.Specification.Kind=="timer"?value.Specification.DurationMinutes:value.Specification.TimeoutMinutes;
            if(value.DueAt!=(minutes is null?null:value.StartedAt.Value.AddMinutes(minutes.Value)))
                throw new InvalidDataException("Срок ожидания не соответствует сохранённой спецификации.");
        }
        if(value.Status=="Received"&&(value.Specification.Kind!="message"||value.Evidence?.Length is not >=3||
            value.Specification.CorrelationKey is not null&&value.CorrelationKey!=value.Specification.CorrelationKey||
            value.DueAt is not null&&value.ResolvedAt>=value.DueAt)||
            value.Status=="Elapsed"&&(value.Specification.Kind!="timer"||value.ResolvedAt<value.DueAt)||
            value.Status=="TimedOut"&&(value.Specification.Kind!="message"||value.DueAt is null||value.ResolvedAt<value.DueAt))
            throw new InvalidDataException("Исход ожидания не соответствует типу события или сроку.");
        if(value.ResolvedAt is not null&&string.IsNullOrWhiteSpace(value.ResolvedBy)||
            stepStatus is not null&&(value.Status=="Pending"&&stepStatus is not ("NotStarted" or "Skipped")||
            value.Status is "Open" or "TimedOut"&&stepStatus!="InProgress"||
            value.Status is "Received" or "Elapsed"&&stepStatus!="Completed"))
            throw new InvalidDataException("Состояние шага не соответствует сохранённому событию.");
    }
    public static void ValidateStep(WaitExecutionModel? wait,string status,DateTimeOffset? started,DateTimeOffset? completed){
        Validate(wait,status);if(wait is null)return;
        if(wait.StartedAt!=started||wait.Status is "Received" or "Elapsed"&&wait.ResolvedAt!=completed)
            throw new InvalidDataException("Даты шага не соответствуют факту ожидания.");
    }
}
