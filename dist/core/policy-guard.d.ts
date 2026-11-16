export type GuardDecisionKind = 'allow' | 'deny' | 'ask_hitl';
export interface PolicyEvaluation {
    decision: GuardDecisionKind;
    code?: string;
    reason?: string;
}
export declare class IntentGuard {
    evaluate(text: string): PolicyEvaluation;
}
export declare class ToolGuard {
    evaluate(input: {
        toolName: string;
        args: Record<string, unknown>;
        workspaceRoot: string;
        writeScopes?: readonly string[];
    }): PolicyEvaluation;
}
//# sourceMappingURL=policy-guard.d.ts.map