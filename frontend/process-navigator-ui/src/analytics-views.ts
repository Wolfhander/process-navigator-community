export const analyticsViews = ['overview', 'processes', 'departments', 'systems', 'history', 'documents','execution'] as const;
export type AnalyticsView = typeof analyticsViews[number];
