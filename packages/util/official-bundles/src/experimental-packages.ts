/** Unprefixed experimental package names retained by the repository's package policy. */

/**
 * Experimental package exceptions whose names do not use the legacy experimental prefix. Keep this exact list aligned
 * with `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` in `scripts/experimental-package-policy.ts`.
 */
export const EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-cua',
  '@deepseek-ai/dsh-cua-bundle',
  '@deepseek-ai/dsh-tool-session-query',
  '@deepseek-ai/dsh-session-title-all-prompts-llm',
  '@deepseek-ai/dsh-tool-terminal',
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-skill-badge',
  '@deepseek-ai/dsh-hook-protocol',
  '@deepseek-ai/dsh-hooks-claude-code',
  '@deepseek-ai/dsh-hooks-codex',
  '@deepseek-ai/dsh-webhook',
  '@deepseek-ai/dsh-webhook-github',
  '@deepseek-ai/dsh-action-cards',
  '@deepseek-ai/dsh-client-ui-action-cards',
  '@deepseek-ai/dsh-creation-recommendations',
  '@deepseek-ai/dsh-client-ui-creation-recommendations',
  '@deepseek-ai/dsh-plugin-recommendations',
  '@deepseek-ai/dsh-client-ui-plugin-recommendations',
  '@deepseek-ai/dsh-personalized-recommendations',
])
