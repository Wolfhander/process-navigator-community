using System.Globalization;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class ScheduleWorkCalendar
{
    public static bool IsNight(string start,string end) =>
        TimeSpan.TryParseExact(start,["h\\:mm","hh\\:mm"],CultureInfo.InvariantCulture,out var first) &&
        TimeSpan.TryParseExact(end,["h\\:mm","hh\\:mm"],CultureInfo.InvariantCulture,out var last) && last<first;
    public TimeSpan Start { get; }
    public TimeSpan End { get; }
    public HashSet<DayOfWeek> WorkingDays { get; }
    public HashSet<DateOnly> NonWorkingDates { get; }
    public TimeSpan Offset { get; }
    private readonly TimeZoneInfo? zone;
    public ScheduleWorkCalendar(ScheduleCalendarModel value)
    {
        if (value is null || value.WorkingDays is null || value.NonWorkingDates is null ||
            !TimeSpan.TryParseExact(value.WorkdayStart, ["h\\:mm", "hh\\:mm"], CultureInfo.InvariantCulture, out var start) ||
            !TimeSpan.TryParseExact(value.WorkdayEnd, ["h\\:mm", "hh\\:mm"], CultureInfo.InvariantCulture, out var end) ||
            start < TimeSpan.Zero || start >= TimeSpan.FromDays(1) || end < TimeSpan.Zero || end >= TimeSpan.FromDays(1) || start == end ||
            value.WorkingDays.Count is < 1 or > 7 || value.WorkingDays.Any(d => d is < 0 or > 6) ||
            value.NonWorkingDates.Count > 366 || value.UtcOffsetMinutes is < -720 or > 840)
            throw new InvalidDataException("Проверьте календарь: часы, рабочие дни, исключения и UTC.");
        Start = start; End = end; Offset = TimeSpan.FromMinutes(value.UtcOffsetMinutes);
        WorkingDays = value.WorkingDays.Select(d => (DayOfWeek)d).ToHashSet();
        NonWorkingDates = [];
        foreach (var text in value.NonWorkingDates)
        {
            if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                throw new InvalidDataException("Проверьте нерабочую дату календаря.");
            NonWorkingDates.Add(date);
        }
        if (!string.IsNullOrWhiteSpace(value.TimeZoneId))
        {
            try { zone = TimeZoneInfo.FindSystemTimeZoneById(value.TimeZoneId); }
            catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
            { throw new InvalidDataException("Часовой пояс календаря недоступен: " + value.TimeZoneId, e); }
        }
    }
    private DateTime Local(DateTimeOffset instant) => zone is null ? instant.ToOffset(Offset).DateTime : TimeZoneInfo.ConvertTime(instant, zone).DateTime;
    private DateTimeOffset AtZone(DateTimeOffset instant) => zone is null ? instant.ToOffset(Offset) : TimeZoneInfo.ConvertTime(instant, zone);
    private DateTimeOffset Instant(DateTime local, bool ending)
    {
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (zone is null) return new(local, Offset);
        // Explicit policy: spring gap advances to first valid minute; autumn
        // overlap covers both occurrences (earliest start, latest end).
        for (var n = 0; zone.IsInvalidTime(local); n++)
        {
            if (n >= 180) throw new InvalidDataException("Переход часового пояса превышает поддержанные 180 минут.");
            local = local.AddMinutes(1);
        }
        var offset = zone.IsAmbiguousTime(local)
            ? (ending ? zone.GetAmbiguousTimeOffsets(local).Min() : zone.GetAmbiguousTimeOffsets(local).Max())
            : zone.GetUtcOffset(local);
        return new(local, offset);
    }
    private (DateTimeOffset Start, DateTimeOffset End)? Shift(DateTime date)
    {
        if (!WorkingDays.Contains(date.DayOfWeek) || NonWorkingDates.Contains(DateOnly.FromDateTime(date))) return null;
        var start = Instant(date + Start, false);
        var end = Instant(date.AddDays(End < Start ? 1 : 0) + End, true);
        return end > start ? (start, end) : null;
    }
    private (DateTimeOffset Start, DateTimeOffset End) Find(DateTimeOffset value, bool forward)
    {
        var date = Local(value).Date.AddDays(forward ? -1 : 0);
        for (var n = 0; n < 100000; n++, date = date.AddDays(forward ? 1 : -1))
        {
            var shift = Shift(date);
            if (shift is { } s && (forward ? s.End > value : s.Start < value)) return s;
        }
        throw new InvalidDataException("Календарь превысил предел 100 000 дат.");
    }
    public DateTimeOffset Normalize(DateTimeOffset value, bool forward)
    {
        var s = Find(value, forward);
        return AtZone(forward ? (value < s.Start ? s.Start : value) : (value > s.End ? s.End : value));
    }
    public DateTimeOffset Add(DateTimeOffset value, double hours, bool forward = true)
    {
        if (!double.IsFinite(hours) || hours < 0) throw new InvalidDataException("Недопустимая длительность календаря.");
        var current = Normalize(value, forward);
        var remaining = hours * 60;
        for (var n = 0; remaining > .001; n++)
        {
            if (n >= 100000) throw new InvalidDataException("Расчёт превысил предел 100 000 смен.");
            var shift = Find(current, forward);
            var available = forward ? (shift.End - current).TotalMinutes : (current - shift.Start).TotalMinutes;
            if (remaining <= available) return AtZone(current.AddMinutes(forward ? remaining : -remaining));
            remaining -= available;
            current = Normalize(forward ? shift.End : shift.Start, forward);
        }
        return current;
    }
    public double Between(DateTimeOffset from, DateTimeOffset to)
    {
        if (from > to) return -Between(to, from);
        var current = from; var minutes = 0d;
        for (var n = 0; current < to; n++)
        {
            if (n >= 100000) throw new InvalidDataException("Сравнение превысило предел календаря.");
            current = Normalize(current, true);
            if (current >= to) break;
            var shift = Find(current, true);
            var end = shift.End < to ? shift.End : to;
            minutes += (end - current).TotalMinutes;
            current = end;
        }
        return minutes / 60;
    }
}
