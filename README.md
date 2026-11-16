# @smitfire/cuga

CUGA-inspired runtime governance plugin for DeepSeek Harness (`@deepseek-ai/dsh@0.2.2-rc.3`) and standalone MCP / CLI pre-tool hooks.

- **IntentGuard**: screens user prompts in `agent/pre-step` against prompt-injection and credential-exfiltration directives.
- **ToolGuard**: enforces sensitive-file denies (`.env`, `.credentials.yaml`, `.ssh`, `.git/config`, keys), realpath-verified workspace + `writeScopes` HITL boundaries, and destructive shell policies across both direct tool calls and nested PTC `run_code` dispatches.
- **ReasoningModeRouter**: selects `lite`, `standard`, or `deep` guidance budgets per step.
- **TrajectoryCrystallizer**: parameterizes verified multi-step trajectories into reusable `@smitfire/context` (Forewisp) playbooks.

## Test
```bash
npm test
```
