import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-session';
import {
  IntentGuard,
  ReasoningModeRouter,
  ToolGuard,
  TrajectoryCrystallizer,
  type CrystallizedPlaybook,
  type PolicyEvaluation,
  type ReasoningDecision,
  type RecordedStep,
} from '../core/index.js';

export const name = 'ns-cuga';
export const inject = ['tools', 'agents'] as const;

export interface PluginConfig {
  liteToolThreshold: number;
  enforceIntentGuard: boolean;
  autoCrystallize: boolean;
}

export const Config = z.object({
  liteToolThreshold: z.number().default(6),
  enforceIntentGuard: z.boolean().default(true),
  autoCrystallize: z.boolean().default(true),
});

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
  classifyReasoning(input: { prompt: string; activeToolCount: number; hasDependencies?: boolean }): ReasoningDecision;
  getSessionState(sessionId: string): Readonly<CugaSessionState> | undefined;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    nsCuga?: NsCugaService;
  }
}

function renderJson(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }];
}

function extractUserText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role && m.role !== 'user') continue;
    if (typeof m?.content === 'string') return m.content;
    if (Array.isArray(m?.content)) {
      return m.content
        .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
        .join(' ')
        .trim();
    }
  }
  return '';
}

function workspaceRootOf(agent?: Agent): string {
  const meta = (agent?.session as { meta?: { cwd?: string } } | undefined)?.meta;
  return typeof meta?.cwd === 'string' && meta.cwd.length > 0 ? meta.cwd : process.cwd();
}

export function apply(ctx: Context, rawConfig: Partial<PluginConfig> = {}): void {
  const liteToolThreshold = rawConfig.liteToolThreshold ?? 6;
  const enforceIntentGuard = rawConfig.enforceIntentGuard ?? true;
  const autoCrystallize = rawConfig.autoCrystallize ?? true;

  const intentGuard = new IntentGuard();
  const toolGuard = new ToolGuard();
  const router = new ReasoningModeRouter({ liteToolThreshold });
  const crystallizer = new TrajectoryCrystallizer();
  const states = new Map<string, CugaSessionState>();

  const stateFor = (sessionId: string): CugaSessionState => {
    let st = states.get(sessionId);
    if (!st) {
      st = { goal: '', steps: [], hadDenial: false, lastPlaybook: null };
      states.set(sessionId, st);
    }
    return st;
  };

  ctx.provide('nsCuga', {
    evaluatePolicy: (input) => toolGuard.evaluate(input),
    evaluateIntent: (text) => intentGuard.evaluate(text),
    classifyReasoning: (input) => router.classify(input),
    getSessionState: (sessionId) => states.get(sessionId),
  });

  // Optional adaptive reasoning hint when systemPrompt is present.
  ctx.inject(['systemPrompt'], (subCtx) => {
    subCtx.systemPrompt.context({
      name: 'ns-cuga:reasoning-mode',
      order: 175,
      interpolate: false,
      text: (assembleCtx) => {
        const sid = assembleCtx.agent ? String(assembleCtx.agent.session.id) : undefined;
        const st = sid ? states.get(sid) : undefined;
        if (!st?.reasoning) return '';
        return `<cuga-reasoning mode="${st.reasoning.mode}" effort="${st.reasoning.effort}" maxStepsHint="${st.reasoning.maxStepsHint}" />`;
      },
    });
  });

  ctx.on('agent/pre-step', async (payload, next) => {
    const sid = String(payload.agent.session.id);
    const st = stateFor(sid);
    const prompt = extractUserText(payload.messages);
    if (prompt) {
      st.goal = prompt;
      if (enforceIntentGuard) {
        const intent = intentGuard.evaluate(prompt);
        if (intent.decision === 'deny') {
          return { kind: 'reject' as const };
        }
      }
      const activeToolCount = ctx.tools.definitions(payload.agent).length;
      st.reasoning = router.classify({ prompt, activeToolCount });
    }
    return next();
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    const sid = exec.agent ? String(exec.agent.session.id) : undefined;
    const args = (exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}) as Record<string, unknown>;
    const board = ctx.get('nsBoard') as
      | {
          activeWriteScopesForSession?: (sessionId: string) => readonly string[] | undefined;
          flagApprovalNeeded?: (req: { toolName: string; reason: string; agentSessionId?: string }) => void;
        }
      | undefined;

    const writeScopes = sid ? board?.activeWriteScopesForSession?.(sid) : undefined;
    const evaluation = toolGuard.evaluate({
      toolName: exec.name,
      args,
      workspaceRoot: workspaceRootOf(exec.agent),
      writeScopes,
    });

    if (evaluation.decision === 'deny') {
      if (sid) stateFor(sid).hadDenial = true;
      return {
        kind: 'deny' as const,
        reason: evaluation.reason ?? 'blocked by CUGA ToolGuard',
        info: {
          name: 'CugaPolicyDenied',
          code: evaluation.code ?? 'CUGA_POLICY_DENIED',
          reason: evaluation.reason,
        },
      };
    }

    if (evaluation.decision === 'ask_hitl') {
      const reason = evaluation.reason ?? 'CUGA policy requires human approval';
      try {
        board?.flagApprovalNeeded?.({ toolName: exec.name, reason, agentSessionId: sid });
      } catch {
        /* board sync is optional */
      }
      return {
        kind: 'ask' as const,
        reason,
        displayReason: { en: reason },
      };
    }

    return next();
  });

  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent || exec.name.startsWith('cuga_')) return;
    const sid = String(exec.agent.session.id);
    const st = stateFor(sid);
    st.steps.push({
      tool: exec.name,
      argsSummary: JSON.stringify(exec.arguments ?? {}).slice(0, 140),
      ok: result?.isError !== true,
    });
    if (st.steps.length > 40) st.steps.shift();
  });

  ctx.on('agent/error', ({ agent }) => {
    stateFor(String(agent.session.id)).hadDenial = true;
  });

  ctx.on('agent/turn-stopping', async ({ agent }) => {
    if (!autoCrystallize) return;
    const sid = String(agent.session.id);
    const st = states.get(sid);
    if (!st || st.hadDenial || st.steps.length < 2) return;
    const playbook = crystallizer.crystallize({
      goal: st.goal || `Session ${sid}`,
      steps: st.steps,
      verified: true,
    });
    st.lastPlaybook = playbook;
    if (playbook) {
      const nsContext = ctx.get('nsContext') as
        | { upsert?: (req: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      if (nsContext?.upsert) {
        try {
          await nsContext.upsert({
            schema: 'forewisp.knowledge.v1',
            kind: playbook.kind,
            scope: 'repository',
            title: playbook.title,
            summary: playbook.summary,
            body: playbook.body,
            keywords: playbook.keywords,
          });
        } catch {
          /* best-effort persistence */
        }
      }
    }
  });

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(String(agent.session.id));
  });

  const schemaObj = { type: 'object' as const, properties: {}, additionalProperties: true };

  ctx.tools.register(
    defineTool({
      name: 'cuga_evaluate_policy',
      description: 'Evaluate CUGA IntentGuard / ToolGuard policy for a candidate tool invocation.',
      parameters: {
        toolName: { type: 'string', required: true, description: 'Candidate tool name.' },
        arguments: { type: 'json', required: true, description: 'Candidate arguments object.' },
        writeScopes: { type: 'json', description: 'Optional allowed relative directory scopes.' },
      },
      output: { schema: schemaObj, render: renderJson },
      isConcurrencySafe: () => true,
      execute: async (args, exec) =>
        toolGuard.evaluate({
          toolName: String(args.toolName),
          args: (args.arguments && typeof args.arguments === 'object' ? args.arguments : {}) as Record<string, unknown>,
          workspaceRoot: workspaceRootOf(exec.agent),
          writeScopes: Array.isArray(args.writeScopes) ? args.writeScopes.map(String) : undefined,
        }) as never,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'cuga_crystallize_playbook',
      description: 'Parameterize a verified multi-step execution trajectory into a reusable Forewisp playbook.',
      parameters: {
        goal: { type: 'string', required: true, description: 'High-level goal solved by the trajectory.' },
        steps: { type: 'json', required: true, description: 'Array of { tool, argsSummary, ok } steps.' },
        verified: { type: 'boolean', required: true, description: 'Whether verification checks passed.' },
      },
      output: { schema: schemaObj, render: renderJson },
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const steps = Array.isArray(args.steps)
          ? (args.steps as Array<{ tool?: unknown; argsSummary?: unknown; ok?: unknown }>).map((s) => ({
              tool: String(s?.tool ?? ''),
              argsSummary: String(s?.argsSummary ?? ''),
              ok: Boolean(s?.ok),
            }))
          : [];
        return {
          playbook: crystallizer.crystallize({
            goal: String(args.goal ?? ''),
            steps,
            verified: Boolean(args.verified),
          }),
        } as never;
      },
    }),
  );
}
