import {defineConfig} from '@playwright/test'
import base from './playwright.config'
// Every audit component spec aborts all outbound browser requests before serving its synthetic document and explicit fixture APIs.
// This standalone matrix needs no application server or authenticated session; it never substitutes for preview persistence UAT.
export default defineConfig({...base,webServer:undefined,testMatch:'tests/e2e/first-pulse-run.spec.ts',projects:base.projects?.filter(project=>['chromium','mobile'].includes(project.name??'')).map(project=>({...project,testMatch:'tests/e2e/first-pulse-run.spec.ts'}))})
