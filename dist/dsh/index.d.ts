import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type CrystallizedPlaybook, type PolicyEvaluation, type ReasoningDecision, type RecordedStep } from '../core/index.js';
export declare const name = "ns-cuga";
export declare const inject: readonly ["tools", "agents"];
export interface PluginConfig {
    liteToolThreshold: number;
    enforceIntentGuard: boolean;
    autoCrystallize: boolean;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    liteToolThreshold: z<number, number, "defined">;
    enforceIntentGuard: z<boolean, boolean, "defined">;
    autoCrystallize: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    liteToolThreshold: z<number, number, "defined">;
    enforceIntentGuard: z<boolean, boolean, "defined">;
    autoCrystallize: z<boolean, boolean, "defined">;
}>>, "plain">;
export interface CugaSessionState {
    goal: string;
    reasoning?: ReasoningDecision;
    steps: RecordedStep[];
    hadDenial: boolean;
    lastPlaybook: CrystallizedPlaybook | null;
}
export interface NsCugaService {
    evaluatePolicy(input: {
        toolName: string;
        args: Record<string, unknown>;
        workspaceRoot: string;
        writeScopes?: readonly string[];
    }): PolicyEvaluation;
    evaluateIntent(text: string): PolicyEvaluation;
    classifyReasoning(input: {
        prompt: string;
        activeToolCount: number;
        hasDependencies?: boolean;
    }): ReasoningDecision;
    getSessionState(sessionId: string): Readonly<CugaSessionState> | undefined;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        nsCuga?: NsCugaService;
    }
}
export declare function apply(ctx: Context, rawConfig?: Partial<PluginConfig>): void;
//# sourceMappingURL=index.d.ts.map