export class ReasoningModeRouter {
    liteToolThreshold;
    constructor(opts) {
        this.liteToolThreshold = opts?.liteToolThreshold ?? 6;
    }
    classify(input) {
        const reasons = [];
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
//# sourceMappingURL=reasoning-router.js.map