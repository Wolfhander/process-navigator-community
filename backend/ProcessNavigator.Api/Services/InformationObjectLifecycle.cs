namespace ProcessNavigator.Api.Services;

public static class InformationObjectLifecycle
{
    public static void Validate(string? previousState, string? previousVersion, string state, string version)
    {
        if (state is not ("Draft" or "Active" or "Archived")) throw new InvalidDataException("Неизвестное состояние объекта.");
        // Initial registration describes an already existing document and may use any known state.
        if (previousState is null) return;
        if (!string.Equals(previousVersion, version, StringComparison.OrdinalIgnoreCase))
        {
            if (state != "Draft") throw new InvalidDataException("Новую версию сначала сохраните как черновик. Предыдущие сведения останутся в истории реестра.");
            return;
        }
        if (previousState == state || previousState == "Draft" && state is "Active" or "Archived" || previousState == "Active" && state == "Archived") return;
        throw new InvalidDataException("Для возврата в черновик или восстановления из архива укажите новую версию и состояние «Черновик».");
    }
}
