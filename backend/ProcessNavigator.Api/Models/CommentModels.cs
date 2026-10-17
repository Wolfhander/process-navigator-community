namespace ProcessNavigator.Api.Models;

public sealed record ElementCommentModel(
    string Id,
    string ProcessId,
    string ElementId,
    string UserId,
    string AuthorName,
    string Text,
    DateTimeOffset CreatedAt);

public sealed record CreateElementCommentModel(string Text);
