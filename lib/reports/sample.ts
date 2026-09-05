/** Public synthetic illustration only. Never use this as a customer report source. */
export const SAMPLE_REPORT = {
  synthetic: true,
  domain: 'example.invalid',
  score: 62,
  grade: 'C',
  observedAt: '2026-09-01',
  checks: [
    { key: 'robots', status: 'pass' },
    { key: 'schema', status: 'warn' },
    { key: 'content', status: 'fail' },
  ],
} as const
