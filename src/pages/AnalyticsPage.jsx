import React from 'react';
import OverviewTab from './analytics/OverviewTab';

// Thin shell. The Supplier Report tab joins OverviewTab here in the
// supplier-performance work; until there are two tabs there is no tab bar,
// because a single tab is just chrome.
export default function AnalyticsPage({ data, suppliers, theme }) {
  return <OverviewTab data={data} suppliers={suppliers} theme={theme} />;
}
