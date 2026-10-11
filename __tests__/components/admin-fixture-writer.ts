import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { build } from 'vite'
export async function writeAdminFixture() {
  const dir = process.env.AISO_ADMIN_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const entry = join(resolve(dir), 'entry.tsx')
  writeFileSync(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{AdminDirectory}from'@/components/admin/AdminDirectory';import en from '@/messages/en.json';import zh from '@/messages/zh-HK.json';const lang=document.documentElement.lang;createRoot(document.getElementById('root')).render(React.createElement(NextIntlClientProvider,{locale:lang,messages:lang==='en'?en:zh,timeZone:'UTC'},React.createElement(AdminDirectory,{lang,query:{view:'users',page:1,q:'',accountId:null}})));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { '@': resolve('.'), 'next/link': resolve('tests/fixtures/admin-link.tsx') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'AdminFixture', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  unlinkSync(entry)
}
