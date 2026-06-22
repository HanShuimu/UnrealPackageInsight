import type { AnalysisResult } from '../types/upi';
import { ANALYSIS_TABS, type AnalysisTabModel as AnalysisViewModelTabModel } from './analysisViewModel';

type LegacyRawTabModel = { id: 'raw'; label: 'Raw'; kind: 'raw' };

export type AnalysisTabModel = AnalysisViewModelTabModel | LegacyRawTabModel;

export function buildAnalysisTabs(_result: AnalysisResult | null): AnalysisViewModelTabModel[] {
  return ANALYSIS_TABS;
}
