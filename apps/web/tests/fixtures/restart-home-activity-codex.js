import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'restart-home-activity-codex'
export const inject = ['subagents']

export function apply(ctx) {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error('restart Activity fixture requires DSH_HOME')
  mkdirSync(home, { recursive: true })
  const activationPath = join(home, 'restart-activity-provider-starts.txt')
  const codexPath = join(home, 'restart-activity-codex-starts.txt')
  const registrationsPath = join(home, 'restart-activity-provider-registered.txt')
  appendFileSync(registrationsPath, 'registered\n', 'utf8')
  ctx.on('subagent/start', (info) => {
    appendFileSync(activationPath, info.provider + '\n', 'utf8')
  })
  ctx.effect(() => ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: {},
    inheritsParentContext: false,
    async start() {
      const existing = existsSync(codexPath) ? readFileSync(codexPath, 'utf8') : ''
      const attempt = existing.trim().length === 0 ? 1 : existing.trimEnd().split('\n').length + 1
      appendFileSync(codexPath, 'start\n', 'utf8')
      if (attempt > 1) throw new Error('fixture transport ended after the external start was invoked')
      return {
        id: 'restart-codex-run-' + String(attempt),
        result: Promise.resolve({
          output: [{ type: 'text', text: 'The external one-shot report was saved.' }],
          stopReason: 'completed',
        }),
        dispose: async () => {},
      }
    },
  }), 'register restart Activity Codex test provider')
}
