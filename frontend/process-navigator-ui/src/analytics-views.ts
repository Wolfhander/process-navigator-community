export const analyticsViews = ['overview', 'processes', 'departments', 'systems', 'history', 'documents'] as const;
export type AnalyticsView = typeof analyticsViews[number];
