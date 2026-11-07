/** Display names for Pulse runtime platform keys; an unknown key is shown as stored rather than guessed. */
const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  'gemini-flash': 'Gemini',
  'gpt-4o': 'ChatGPT',
  'claude-haiku': 'Claude',
  'perplexity-sonar': 'Perplexity',
  'perplexity-sonar-pro': 'Perplexity Pro',
}

export const platformName = (key: string) => PLATFORM_NAMES[key] ?? key
