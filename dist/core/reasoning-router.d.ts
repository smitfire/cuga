export type ReasoningMode = 'lite' | 'standard' | 'deep';
export interface ReasoningDecision {
    mode: ReasoningMode;
    effort: 'low' | 'medium' | 'high';
    maxStepsHint: number;
    reasons: string[];
}
export declare class ReasoningModeRouter {
    private readonly liteToolThreshold;
    constructor(opts?: {
        liteToolThreshold?: number;
    });
    classify(input: {
        prompt: string;
        activeToolCount: number;
        hasDependencies?: boolean;
    }): ReasoningDecision;
}
//# sourceMappingURL=reasoning-router.d.ts.map