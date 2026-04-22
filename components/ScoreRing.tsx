'use client'

interface Props { score: number }

function getColor(score: number) {
  if (score >= 80) return { ring: '#16a34a', bg: '#dcfce7', text: '#15803d' }
  if (score >= 50) return { ring: '#d97706', bg: '#fef3c7', text: '#b45309' }
  return { ring: '#dc2626', bg: '#fee2e2', text: '#b91c1c' }
}

export function ScoreRing({ score }: Props) {
  const { ring, bg, text } = getColor(score)
  return (
    <div
      className="flex items-center justify-center rounded-full w-20 h-20 text-2xl font-black"
      style={{ background: bg, border: `4px solid ${ring}`, color: text }}
    >
      {Math.round(score)}
    </div>
  )
}
