import type { PromptBankItem } from '@/lib/types'

function groupByCategory(prompts: PromptBankItem[]): Record<string, PromptBankItem[]> {
  return prompts.reduce<Record<string, PromptBankItem[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})
}

test('groupByCategory groups prompts correctly', () => {
  const prompts: PromptBankItem[] = [
    { id: '1', client_id: 'c1', category: 'Brand Queries', question: 'Q1', language: 'en', is_active: true,  created_at: '' },
    { id: '2', client_id: 'c1', category: 'Pain Points',   question: 'Q2', language: 'en', is_active: false, created_at: '' },
    { id: '3', client_id: 'c1', category: 'Brand Queries', question: 'Q3', language: 'zh-HK', is_active: true, created_at: '' },
  ]
  const grouped = groupByCategory(prompts)
  expect(grouped['Brand Queries']).toHaveLength(2)
  expect(grouped['Pain Points']).toHaveLength(1)
})
