import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
const clientId = '11111111-1111-4111-8111-111111111111'
const entity = (revision = 1, displayName = 'Latest identity') => ({
  clientId,
  displayName,
  aliases: ['Alias'],
  revision,
  verification: 'unverified',
  updatedAt: '2026-09-06T00:00:00Z',
})
async function fixture(
  page: Page,
  lang = 'en',
  state = 'empty',
  theme = 'light',
) {
  page.on('pageerror', (error) =>
    console.error('Entity fixture error:', error.message),
  )
  const dir = process.env.C9A_HTML_DIR,
    css = process.env.C9A_CSS_PATH
  test.skip(
    !dir || !css,
    'Generate C9A_HTML_DIR with entity-render.test.tsx and set C9A_CSS_PATH',
  )
  const copy = JSON.parse(
    readFileSync(`${dir}/${lang}-copy.json`, 'utf8'),
  ) as Record<string, string>
  const html = readFileSync(`${dir}/${lang}-${state}.html`, 'utf8')
  const style = readFileSync(css!, 'utf8'),
    js = readFileSync(`${dir}/entity-fixture.js`, 'utf8')
  await page.route('**/*', (route) =>
    route.request().url() === 'https://entity.fixture/'
      ? route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html lang="${lang}" class="${theme}"><head><meta charset="utf-8"><title>Private identity acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body>${html}<script>${js}</script></body></html>`,
        })
      : route.abort(),
  )
  await page.goto('https://entity.fixture/')
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { entityFixtureReady: boolean }).entityFixtureReady,
    ),
  )
  return copy
}
for (const lang of ['en', 'zh-HK'])
  for (const width of [375, 1440])
    for (const theme of ['light', 'dark'])
      test(`C9a identity ${lang} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({
          colorScheme: theme as 'light' | 'dark',
          reducedMotion: 'reduce',
        })
        const copy = await fixture(page, lang, 'empty', theme)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          copy.title,
        )
        await expect(page.getByRole('status')).toHaveText(copy.unsaved)
        await expect(
          page.getByLabel(copy.displayName, { exact: true }),
        ).toHaveValue('Example Brand')
        await page.keyboard.press('Tab')
        await expect(
          page.getByLabel(copy.displayName, { exact: true }),
        ).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(
          page.getByLabel(copy.aliases, { exact: true }),
        ).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(
          page.getByRole('button', { name: copy.save, exact: true }),
        ).toBeFocused()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        )
      })
test('save is explicit, normalized and guarded against duplicate submissions', async ({
  page,
}) => {
  const copy = await fixture(page)
  let writes = 0
  let body: unknown
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/clients/*/entity', async (route) => {
    writes++
    body = route.request().postDataJSON()
    await gate
    await route.fulfill({ json: { entity: entity(1, 'New identity') } })
  })
  expect(writes).toBe(0)
  await page
    .getByLabel(copy.displayName, { exact: true })
    .fill(' New identity ')
  await page.getByLabel(copy.aliases, { exact: true }).fill('Alias\nalias')
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(
    page.getByRole('button', { name: copy.saving, exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByLabel(copy.displayName, { exact: true }),
  ).toBeDisabled()
  release()
  await expect(page.getByRole('status')).toHaveText(copy.saved)
  expect(writes).toBe(1)
  expect(body).toEqual({
    displayName: 'New identity',
    aliases: ['Alias'],
    expectedRevision: 0,
  })
})
test('conflict preserves draft until explicit reload; reload failure keeps conflict and draft', async ({
  page,
}) => {
  const copy = await fixture(page, 'en', 'saved')
  let reloads = 0
  let saves = 0
  await page.route('**/api/clients/*/entity', (route) => {
    if (route.request().method() === 'PUT') {
      saves++
      return route.fulfill({ status: 409, json: { error: 'ENTITY_CONFLICT' } })
    }
    reloads++
    return reloads === 1
      ? route.fulfill({ status: 500, json: { error: 'ENTITY_UNAVAILABLE' } })
      : route.fulfill({ json: { entity: entity(2) } })
  })
  await page.getByLabel(copy.displayName, { exact: true }).fill('My draft')
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(copy.conflict)
  expect(reloads).toBe(0)
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(
    'My draft',
  )
  await expect(
    page.getByRole('button', { name: copy.save, exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: copy.reload, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(copy.loadError)
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(
    'My draft',
  )
  await page.getByRole('button', { name: copy.reload, exact: true }).click()
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(
    'Latest identity',
  )
  await expect(page.getByRole('status')).toHaveText(copy.saved)
  expect(saves).toBe(1)
})
for (const mode of [
  'network',
  '500',
  '401',
  '404',
  'malformed',
  'wrong-client',
  'wrong-revision',
])
  test(`preserves draft on ${mode} save failure`, async ({ page }) => {
    const copy = await fixture(page)
    await page.route('**/api/clients/*/entity', (route) =>
      mode === 'network'
        ? route.abort()
        : route.fulfill({
            status: ['500', '401', '404'].includes(mode) ? Number(mode) : 200,
            json:
              mode === 'malformed'
                ? {}
                : {
                    entity:
                      mode === 'wrong-client'
                        ? { ...entity(), clientId: 'other' }
                        : mode === 'wrong-revision'
                          ? entity(9)
                          : entity(),
                  },
          }),
    )
    await page.getByLabel(copy.displayName, { exact: true }).fill('Keep draft')
    await page.getByRole('button', { name: copy.save, exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(
      copy[
        mode === '401'
          ? 'unauthenticated'
          : mode === '404'
            ? 'unavailable'
            : 'saveError'
      ],
    )
    await expect(
      page.getByLabel(copy.displayName, { exact: true }),
    ).toHaveValue('Keep draft')
    await expect(page.getByRole('status')).toHaveText(copy.unsaved)
    await expect(
      page.getByRole('button', { name: copy.save, exact: true }),
    ).toBeEnabled()
  })
test('late save response cannot populate a changed client', async ({
  page,
}) => {
  const copy = await fixture(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/clients/*/entity', async (route) => {
    await gate
    await route.fulfill({ json: { entity: entity() } }).catch(() => {})
  })
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(copy.saving)
  await page.evaluate(() => {
    const win = window as unknown as {
      entityFixtureSwitch: (props: unknown) => void
    }
    const props = JSON.parse(
      document.getElementById('fixture-props')!.textContent!,
    )
    win.entityFixtureSwitch({
      ...props,
      clientId: '22222222-2222-4222-8222-222222222222',
      brandName: 'Second brand',
    })
  })
  release()
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(
    'Second brand',
  )
  await expect(page.getByRole('status')).toHaveText(copy.unsaved)
})

test('retry saves the preserved draft using the saved revision', async ({
  page,
}) => {
  const copy = await fixture(page, 'en', 'saved')
  let calls = 0
  let input: unknown
  await page.route('**/api/clients/*/entity', (route) => {
    input = route.request().postDataJSON()
    calls++
    return route.fulfill(
      calls === 1
        ? { status: 500, json: { error: 'ENTITY_UNAVAILABLE' } }
        : {
            json: {
              entity: {
                ...entity(2, 'Retry draft'),
                aliases: ['Example alias'],
              },
            },
          },
    )
  })
  await page.getByLabel(copy.displayName, { exact: true }).fill('Retry draft')
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(copy.saveError)
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(copy.saved)
  expect(input).toEqual({
    displayName: 'Retry draft',
    aliases: ['Example alias'],
    expectedRevision: 1,
  })
})
test('client validation prevents oversized alias lists from reaching the API', async ({
  page,
}) => {
  const copy = await fixture(page)
  let calls = 0
  await page.route('**/api/clients/*/entity', (route) => {
    calls++
    return route.fulfill({ json: { entity: entity() } })
  })
  await page
    .getByLabel(copy.aliases, { exact: true })
    .fill(Array.from({ length: 21 }, (_, i) => `Alias ${i}`).join('\n'))
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(copy.invalid)
  expect(calls).toBe(0)
})
test('missing entity on reload is an error, while explicit null restores an unsaved suggestion', async ({
  page,
}) => {
  const copy = await fixture(page, 'en', 'saved')
  let reads = 0
  await page.route('**/api/clients/*/entity', (route) => {
    if (route.request().method() === 'PUT')
      return route.fulfill({ status: 409, json: { error: 'ENTITY_CONFLICT' } })
    reads++
    return route.fulfill({ json: reads === 1 ? {} : { entity: null } })
  })
  await page
    .getByLabel(copy.displayName, { exact: true })
    .fill('Draft retained')
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(copy.conflict)
  await page.getByRole('button', { name: copy.reload, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(copy.loadError)
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(
    'Draft retained',
  )
  await page.getByRole('button', { name: copy.reload, exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(copy.unsaved)
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(
    'Example Brand',
  )
})

test('identical normalized replay at a newer revision is saved', async ({
  page,
}) => {
  const copy = await fixture(page, 'en', 'saved')
  await page.route('**/api/clients/*/entity', (route) =>
    route.fulfill({
      json: {
        entity: { ...entity(3, 'Replay draft'), aliases: ['Example alias'] },
      },
    }),
  )
  await page
    .getByLabel(copy.displayName, { exact: true })
    .fill(' Replay draft ')
  await page.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(copy.saved)
  await expect(page.getByLabel(copy.displayName, { exact: true })).toHaveValue(
    'Replay draft',
  )
})
for (const response of [
  {
    name: 'different display name',
    value: { ...entity(3, 'Other draft'), aliases: ['Example alias'] },
  },
  { name: 'different aliases', value: entity(3, 'Replay draft') },
  {
    name: 'unchanged revision',
    value: { ...entity(1, 'Replay draft'), aliases: ['Example alias'] },
  },
  {
    name: 'older revision',
    value: { ...entity(0, 'Replay draft'), aliases: ['Example alias'] },
  },
])
  test(`rejects replay with ${response.name}`, async ({ page }) => {
    const copy = await fixture(page, 'en', 'saved')
    await page.route('**/api/clients/*/entity', (route) =>
      route.fulfill({ json: { entity: response.value } }),
    )
    await page
      .getByLabel(copy.displayName, { exact: true })
      .fill('Replay draft')
    await page.getByRole('button', { name: copy.save, exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(copy.saveError)
    await expect(
      page.getByLabel(copy.displayName, { exact: true }),
    ).toHaveValue('Replay draft')
    await expect(page.getByRole('status')).toHaveText(copy.unsaved)
  })
