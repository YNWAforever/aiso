import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { build } from 'vite'
export async function writeOnboardingFixture() {
  const dir = process.env.AISO_ONBOARDING_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const entry = join(resolve(dir), 'entry.tsx')
  writeFileSync(entry, `import React,{useEffect}from'react';import{createRoot}from'react-dom/client';import{OnboardingWizard}from'@/components/onboarding/OnboardingWizard';function Fixture(){useEffect(()=>{window.aisoFixtureReady=true},[]);return React.createElement(OnboardingWizard,{lang:document.documentElement.lang,accountId:'synthetic-account',initialBrand:'Synthetic Brand'})}createRoot(document.getElementById('root')).render(React.createElement(Fixture));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { '@': resolve('.'), 'next/navigation': resolve('tests/fixtures/onboarding-navigation.ts') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'OnboardingFixture', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  unlinkSync(entry)
}
