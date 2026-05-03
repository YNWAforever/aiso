'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const [dark, setDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
      setDark(true)
    }
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  if (!mounted) return <div className="w-8 h-8" />

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-dash-muted hover:bg-dash-elevated hover:text-dash-text transition-colors w-full"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={14} /> : <Moon size={14} />}
      <span>{dark ? 'Light' : 'Dark'} mode</span>
    </button>
  )
}
