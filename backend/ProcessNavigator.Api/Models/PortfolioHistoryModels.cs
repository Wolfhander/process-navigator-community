namespace ProcessNavigator.Api.Models;

public sealed record PortfolioHistorySaveModel(string Name, PortfolioAnalyticsModel ExpectedData);
public sealed record PortfolioHistorySnapshotModel(string Id, string Name, DateTimeOffset CapturedAt, string Algorithm, string Fingerprint, PortfolioAnalyticsModel Data);
public sealed record PortfolioHistorySummaryModel(string Id, string Name, DateTimeOffset CapturedAt, string Algorithm, string Fingerprint, int ProcessCount, double ReadinessPercent, int InformationIssueCount);
