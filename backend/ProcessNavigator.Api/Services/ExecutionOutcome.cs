using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;
public static class ExecutionOutcome
{
    public static void Validate(ProcessInstanceModel instance){
        var value=instance.Outcome;if(value is null)return;
        if(value.Kind is not ("Success" or "Refusal" or "Error" or "Cancellation")||string.IsNullOrWhiteSpace(value.Reason)||
            value.Reason.Length>500||string.IsNullOrWhiteSpace(value.RecordedBy)||value.RecordedAt<instance.StartedAt||value.UnfinishedElementIds is null)
            throw new InvalidDataException("Повреждена классификация завершения.");
        var unfinished=instance.Steps.Where(s=>s.Status is not ("Completed" or "Skipped")).Select(s=>s.ElementId).ToHashSet();
        if(!unfinished.SetEquals(value.UnfinishedElementIds)||value.UnfinishedElementIds.Distinct().Count()!=value.UnfinishedElementIds.Count)
            throw new InvalidDataException("Исход не соответствует снимку незавершённых ветвей.");
        if(value.Kind=="Success"?(instance.Status!="Completed"||unfinished.Count!=0||instance.CompletedAt!=value.RecordedAt):
            (instance.Status!="Cancelled"||instance.CompletedAt.HasValue))
            throw new InvalidDataException("Статус и исход завершения противоречат друг другу.");
    }
}
