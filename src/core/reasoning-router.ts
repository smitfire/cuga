export type ReasoningMode = 'lite' | 'standard' | 'deep';

export interface ReasoningDecision {
  mode: ReasoningMode;
  effort: 'low' | 'medium' | 'high';
  maxStepsHint: number;
  reasons: string[];
}

export class ReasoningModeRouter {
  private readonly liteToolThreshold: number;

  constructor(opts?: { liteToolThreshold?: number }) {
    this.liteToolThreshold = opts?.liteToolThreshold ?? 6;
  }

  classify(input: { prompt: string; activeToolCount: number; hasDependencies?: boolean }): ReasoningDecision {
    const reasons: string[] = [];
    const text = input.prompt.toLowerCase();
    const len = input.prompt.trim().length;

    if (input.hasDependencies || /\b(architect|refactor|migrate|security|audit|benchmark|orchestrat)\b/.test(text)) {
      reasons.push('multi-step or architectural prompt signal');
      return { mode: 'deep', effort: 'high', maxStepsHint: 30, reasons };
    }
    if (len < 160 && input.activeToolCount <= this.liteToolThreshold && !/\b(test|debug|fix|implement)\b/.test(text)) {
      reasons.push('short low-tool lookup query');
      return { mode: 'lite', effort: 'low', maxStepsHint: 6, reasons };
    }
    reasons.push('standard coding workload');
    return { mode: 'standard', effort: 'medium', maxStepsHint: 16, reasons };
  }
}
