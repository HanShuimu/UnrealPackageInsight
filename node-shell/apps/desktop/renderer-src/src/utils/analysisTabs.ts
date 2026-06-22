import type { AnalysisResult } from '../types/upi';
import { ANALYSIS_TABS, type AnalysisTabModel } from './analysisViewModel';

export type { AnalysisTabModel };

export function buildAnalysisTabs(_result: AnalysisResult | null): AnalysisTabModel[] {
  return ANALYSIS_TABS;
}
