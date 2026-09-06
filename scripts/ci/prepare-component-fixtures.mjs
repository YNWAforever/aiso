import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * @param {string} root
 * @param {NodeJS.ProcessEnv} environment
 * @param {(command: string, args: string[], options: {cwd: string, env: NodeJS.ProcessEnv, stdio: 'inherit'}) => {status: number | null, error?: Error}} run
 */
export async function prepareComponentFixtures(root, environment = process.env, run = spawnSync) {
  const chunks = join(root,'.next/static/chunks')
  const cssFiles = (await readdir(chunks)).filter(file=>file.endsWith('.css')).sort()
  if(!cssFiles.length) throw new Error('Production build CSS is required for component acceptance')
  const output = join(root,'.next/component-fixtures')
  await mkdir(output,{recursive:true})
  await writeFile(join(output,'build.css'),(await Promise.all(cssFiles.map(file=>readFile(join(chunks,file),'utf8')))).join('\n'))
  const env = {...environment}
  for(const slice of ['C8A','C8B','C8C','C8G','C9A','C9B']) {
    env[`${slice}_HTML_DIR`] = join(output,slice)
    env[`${slice}_CSS_PATH`] = join(output,'build.css')
  }
  const files = ['workspace-home','portfolio','pulse-view','settings','entity','observation'].map(name=>`__tests__/components/${name}-render.test.tsx`)
  const result = run(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run',...files,'--maxWorkers=1'],{cwd:root,env,stdio:'inherit'})
  if(result.error || result.status !== 0) throw new Error('Component fixture renderer failed')
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareComponentFixtures(process.cwd()).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1})
}
