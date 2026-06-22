import type { AnalysisResult } from '../types/upi';
import { ANALYSIS_TABS, type AnalysisTabModel as AnalysisViewModelTabModel } from './analysisViewModel';

type InternalUnreachableTabSwitchCompatibility = {
  id: never;
  label: never;
  kind: 'raw';
};

export type AnalysisTabModel = AnalysisViewModelTabModel | InternalUnreachableTabSwitchCompatibility;

export function buildAnalysisTabs(_result: AnalysisResult | null): AnalysisViewModelTabModel[] {
  return ANALYSIS_TABS;
}
