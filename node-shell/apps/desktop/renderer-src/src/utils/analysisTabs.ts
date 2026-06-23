import type { AnalysisResult } from '../types/upi';
import { ANALYSIS_TABS, type AnalysisTabModel as AnalysisViewModelTabModel } from './analysisViewModel';

export type AnalysisTabModel = AnalysisViewModelTabModel;

export function buildAnalysisTabs(_result: AnalysisResult | null): AnalysisViewModelTabModel[] {
  return ANALYSIS_TABS;
}
