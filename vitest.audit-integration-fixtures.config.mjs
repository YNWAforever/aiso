import {defineConfig} from 'vitest/config'
import base from './vitest.local-persistence.config.mjs'
export default defineConfig({...base,test:{...base.test,include:['__tests__/integration/citation-report.test.ts','__tests__/integration/pulse-grounding.test.ts','__tests__/integration/onboarding-resume.test.ts','__tests__/integration/share-of-voice.test.ts']}})
