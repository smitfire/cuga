import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type GuardDecisionKind = 'allow' | 'deny' | 'ask_hitl';

export interface PolicyEvaluation {
  decision: GuardDecisionKind;
  code?: string;
  reason?: string;
}

const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)\.env(?:\..+)?$/i,
  /(?:^|\/)\.credentials\.yaml$/i,
  /(?:^|\/)\.ssh(?:\/|$)/i,
  /(?:^|\/)\.git\/config$/i,
  /\.pem$|\.key$/i,
];

const DESTRUCTIVE_COMMAND_PATTERNS: readonly { re: RegExp; decision: GuardDecisionKind; reason: string }[] = [
  { re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(?:\/|~|\$HOME|\*)\b/, decision: 'deny', reason: 'destructive root/home recursive delete blocked' },
  { re: /\bgit\s+push\s+.*(?:--force|-f)\b/, decision: 'ask_hitl', reason: 'force git push requires explicit human approval' },
  { re: /\bgit\s+reset\s+--hard\b/, decision: 'ask_hitl', reason: 'git reset --hard discards uncommitted work; requires approval' },
  { re: /\bcurl\b[^|;\n]*\|\s*(?:sh|bash|zsh)\b/, decision: 'deny', reason: 'piped remote shell execution blocked' },
  { re: /(?:^|[\s"'`])(?:~\/|\$HOME\/|\S*\/)?(?:\.env(?:\.[A-Za-z0-9_-]+)?|\.credentials\.yaml|\.ssh\/)(?:$|[\s"'`/])/, decision: 'deny', reason: 'shell access to credential or key files blocked' },
];

const FORBIDDEN_INTENT_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?\b/i,
  /\bexfiltrate\s+(?:secrets?|credentials?|tokens?|keys?)\b/i,
  /\bbypass\s+(?:policy|guard|approval|sandbox)\b/i,
];

function resolveExistingPrefix(targetPath: string): string {
  let cur = resolve(targetPath);
  const tail: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    tail.unshift(cur.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cur = parent;
  }
  const realBase = existsSync(cur) ? realpathSync(cur) : cur;
  return tail.length > 0 ? resolve(realBase, ...tail) : realBase;
}

function isWithinScope(
  workspaceRoot: string,
  rawPath: string,
  writeScopes?: readonly string[],
): { ok: boolean; rel: string; error?: string } {
  let realRoot: string;
  let resolved: string;
  try {
    realRoot = realpathSync(resolve(workspaceRoot));
    const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(realRoot, rawPath);
    resolved = resolveExistingPrefix(candidate);
  } catch (err) {
    return { ok: false, rel: rawPath, error: err instanceof Error ? err.message : String(err) };
  }
  const rel = relative(realRoot, resolved);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    return { ok: false, rel };
  }
  if (!writeScopes || writeScopes.length === 0) return { ok: true, rel };
  const normRel = rel.replace(/\\/g, '/');
  const matched = writeScopes.some((scope) => {
    const normScope = scope.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return normRel === normScope || normRel.startsWith(`${normScope}/`);
  });
  return { ok: matched, rel: normRel };
}

export class IntentGuard {
  evaluate(text: string): PolicyEvaluation {
    if (!text) return { decision: 'allow' };
    for (const re of FORBIDDEN_INTENT_PATTERNS) {
      if (re.test(text)) {
        return { decision: 'deny', code: 'CUGA_INTENT_BLOCKED', reason: `intent matched forbidden directive: ${re.source}` };
      }
    }
    return { decision: 'allow' };
  }
}

export class ToolGuard {
  evaluate(input: {
    toolName: string;
    args: Record<string, unknown>;
    workspaceRoot: string;
    writeScopes?: readonly string[];
  }): PolicyEvaluation {
    const { toolName, args, workspaceRoot, writeScopes } = input;
    const isWriteTool = ['write', 'edit', 'apply_patch', 'str_replace_editor', 'delete'].includes(toolName);
    const pathArg = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : undefined;

    if (pathArg) {
      const normalized = pathArg.replace(/\\/g, '/');
      if (SENSITIVE_PATH_PATTERNS.some((re) => re.test(normalized))) {
        return { decision: 'deny', code: 'CUGA_SENSITIVE_PATH', reason: `access to sensitive path "${normalized}" denied` };
      }
      if (isWriteTool) {
        const scopeCheck = isWithinScope(workspaceRoot, pathArg, writeScopes);
        if (scopeCheck.error) {
          return {
            decision: 'deny',
            code: 'CUGA_WORKSPACE_INVALID',
            reason: `workspace resolution failed for "${pathArg}": ${scopeCheck.error}`,
          };
        }
        if (!scopeCheck.ok) {
          return {
            decision: 'ask_hitl',
            code: 'CUGA_OUT_OF_SCOPE_WRITE',
            reason: `write to "${scopeCheck.rel || pathArg}" is outside active writeScopes [${(writeScopes ?? []).join(', ')}]`,
          };
        }
      }
    }

    if (toolName === 'bash' || toolName === 'terminal' || toolName === 'shell') {
      const cmd = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : '';
      for (const rule of DESTRUCTIVE_COMMAND_PATTERNS) {
        if (rule.re.test(cmd)) {
          return { decision: rule.decision, code: 'CUGA_COMMAND_POLICY', reason: rule.reason };
        }
      }
    }

    return { decision: 'allow' };
  }
}
