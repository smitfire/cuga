export interface RecordedStep {
    tool: string;
    argsSummary: string;
    ok: boolean;
}
export interface CrystallizedPlaybook {
    kind: 'guidance';
    title: string;
    summary: string;
    body: string;
    keywords: string;
}
/** CUGA Save & Reuse: extracts clean verified multi-step trajectories as stack-reusable playbooks. */
export declare class TrajectoryCrystallizer {
    crystallize(input: {
        goal: string;
        steps: readonly RecordedStep[];
        verified: boolean;
    }): CrystallizedPlaybook | null;
}
//# sourceMappingURL=trajectory-crystallizer.d.ts.map