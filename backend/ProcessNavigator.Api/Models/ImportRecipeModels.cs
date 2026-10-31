using System.Text.Json.Serialization;
namespace ProcessNavigator.Api.Models;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ImportRecipeRule(string Kind,string Value,string Scope,string? TargetId=null,bool KeepNew=false);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ImportRecipeCreate(string Name,IReadOnlyList<ImportRecipeRule> Rules);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ImportRecipeRequest(int ExpectedRevision,string? Fingerprint=null);
public sealed record ImportRecipeFile(string Id,string FileName,long Size,string Sha256);
public sealed record ImportRecipeBatch(string Id,DateTimeOffset CreatedAt,IReadOnlyList<ImportRecipeFile> Files);
public sealed record ImportRecipe(int SchemaVersion,string Id,string OwnerId,string Name,int Revision,DateTimeOffset CreatedAt,
    IReadOnlyList<ImportRecipeRule> Rules,IReadOnlyList<ImportRecipeBatch> Batches);
public sealed record ImportRecipeList(IReadOnlyList<ImportRecipe> Recipes,int Unreadable);
public sealed record ImportRecipeFilePreview(string FileId,string FileName,string State,int AppliedRules,int UnusedRules,
    int RemainingGroups,int ErrorCount,int WarningCount,string? Fingerprint,IReadOnlyList<string> Messages);
public sealed record ImportRecipePreview(string RecipeId,int Revision,string BatchId,IReadOnlyList<ImportRecipeFilePreview> Files);
