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

const ABS_PATH_RE = /\/(?:Users|home|tmp|var|private)\/[^\s'"]+/g;
const HEX_UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** CUGA Save & Reuse: extracts clean verified multi-step trajectories as stack-reusable playbooks. */
export class TrajectoryCrystallizer {
  crystallize(input: {
    goal: string;
    steps: readonly RecordedStep[];
    verified: boolean;
  }): CrystallizedPlaybook | null {
    if (!input.verified) return null;
    const cleanSteps = input.steps.filter((s) => s.ok);
    if (cleanSteps.length < 2) return null;

    const parameterized = cleanSteps.slice(0, 12).map((s, idx) => {
      const cleanArgs = s.argsSummary.replace(ABS_PATH_RE, '<WORKSPACE_PATH>').replace(HEX_UUID_RE, '<ID>');
      return `${idx + 1}. ${s.tool}(${cleanArgs.slice(0, 140)})`;
    });

    const title = `Playbook: ${input.goal.replace(ABS_PATH_RE, '<PATH>').trim().slice(0, 110)}`;
    const summary = `Verified ${cleanSteps.length}-step sequence for ${input.goal.trim().slice(0, 120)}`.slice(0, 195);
    const body = [
      `Goal: ${input.goal.replace(ABS_PATH_RE, '<WORKSPACE_PATH>').trim().slice(0, 200)}`,
      'Verified Steps:',
      ...parameterized,
    ].join('\n');

    const keywords = [...new Set(cleanSteps.map((s) => s.tool))].join(' ');
    return { kind: 'guidance', title, summary, body, keywords };
  }
}
