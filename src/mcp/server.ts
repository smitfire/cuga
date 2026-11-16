#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { IntentGuard, ReasoningModeRouter, ToolGuard, TrajectoryCrystallizer } from '../core/index.js';

const MCP_TOOLS = [
  {
    name: 'cuga_evaluate_policy',
    description: 'Check ToolGuard policy (sensitive path deny, symlink/writeScope boundary, destructive bash) before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: { type: 'string' },
        arguments: { type: 'object' },
        writeScopes: { type: 'array', items: { type: 'string' } },
      },
      required: ['toolName', 'arguments'],
    },
  },
  {
    name: 'cuga_evaluate_intent',
    description: 'Check IntentGuard for prompt-injection or credential-exfiltration directives.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'cuga_classify_reasoning',
    description: 'Select adaptive CUGA reasoning mode (lite | standard | deep).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        activeToolCount: { type: 'integer' },
        hasDependencies: { type: 'boolean' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'cuga_crystallize_playbook',
    description: 'Crystallize verified clean trajectory steps into a parameterized reusable playbook.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        steps: { type: 'array' },
        verified: { type: 'boolean' },
      },
      required: ['goal', 'steps', 'verified'],
    },
  },
];

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function evaluatePreToolHook(workspaceRoot: string, rawJson: string): { exitCode: number; output: string } {
  let payload: {
    toolName?: string;
    tool_name?: string;
    arguments?: Record<string, unknown>;
    tool_input?: Record<string, unknown>;
    writeScopes?: string[];
  };
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return {
      exitCode: 2,
      output: JSON.stringify({ decision: 'deny', code: 'CUGA_HOOK_INPUT_INVALID', reason: 'hook payload is not valid JSON' }),
    };
  }
  const guard = new ToolGuard();
  const res = guard.evaluate({
    toolName: String(payload.toolName ?? payload.tool_name ?? ''),
    args: (payload.arguments ?? payload.tool_input ?? {}) as Record<string, unknown>,
    workspaceRoot,
    writeScopes: Array.isArray(payload.writeScopes) ? payload.writeScopes : undefined,
  });
  return { exitCode: res.decision === 'allow' ? 0 : 2, output: JSON.stringify(res) };
}

export async function startMcpServer(workspaceRoot = process.cwd()): Promise<void> {
  const intent = new IntentGuard();
  const guard = new ToolGuard();
  const router = new ReasoningModeRouter();
  const crystallizer = new TrajectoryCrystallizer();

  const write = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: { id?: string | number | null; method?: string; params?: Record<string, unknown> };
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    if (req.id === undefined || req.method === undefined) continue;
    try {
      if (req.method === 'initialize') {
        write({
          jsonrpc: '2.0',
          id: req.id,
          result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ns-cuga', version: '0.1.0' } },
        });
      } else if (req.method === 'tools/list') {
        write({ jsonrpc: '2.0', id: req.id, result: { tools: MCP_TOOLS } });
      } else if (req.method === 'tools/call') {
        const name = String(req.params?.name ?? '');
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new RpcError(-32602, 'arguments must be an object');
        let result: unknown;
        if (name === 'cuga_evaluate_policy') {
          if (typeof args.toolName !== 'string') throw new RpcError(-32602, 'toolName must be a string');
          result = guard.evaluate({
            toolName: args.toolName,
            args: (args.arguments && typeof args.arguments === 'object' ? args.arguments : {}) as Record<string, unknown>,
            workspaceRoot,
            writeScopes: Array.isArray(args.writeScopes) ? args.writeScopes.map(String) : undefined,
          });
        } else if (name === 'cuga_evaluate_intent') {
          if (typeof args.text !== 'string') throw new RpcError(-32602, 'text must be a string');
          result = intent.evaluate(args.text);
        } else if (name === 'cuga_classify_reasoning') {
          result = router.classify({
            prompt: String(args.prompt ?? ''),
            activeToolCount: typeof args.activeToolCount === 'number' ? args.activeToolCount : 8,
            hasDependencies: Boolean(args.hasDependencies),
          });
        } else if (name === 'cuga_crystallize_playbook') {
          const steps = Array.isArray(args.steps)
            ? (args.steps as Array<{ tool?: unknown; argsSummary?: unknown; ok?: unknown }>).map((s) => ({
                tool: String(s?.tool ?? ''),
                argsSummary: String(s?.argsSummary ?? ''),
                ok: Boolean(s?.ok),
              }))
            : [];
          result = {
            playbook: crystallizer.crystallize({
              goal: String(args.goal ?? ''),
              steps,
              verified: Boolean(args.verified),
            }),
          };
        } else {
          throw new RpcError(-32601, `unknown tool: ${name}`);
        }
        write({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
      } else {
        throw new RpcError(-32601, `method not found: ${req.method}`);
      }
    } catch (error) {
      write({ jsonrpc: '2.0', id: req.id, error: { code: error instanceof RpcError ? error.code : -32000, message: error instanceof Error ? error.message : String(error) } });
    }
  }
}

const isEntrypoint = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  if (process.argv[2] === '--hook-pre-tool') {
    const out = evaluatePreToolHook(process.argv[4] ?? process.cwd(), process.argv[3] ?? '{}');
    process.stdout.write(`${out.output}\n`);
    process.exit(out.exitCode);
  } else {
    await startMcpServer(process.argv[2] ?? process.cwd());
  }
}
