const DEFAULT_CONFIG = {
  enabled_sov: false, sov_threshold: 50,
  enabled_wow: false, wow_threshold: 10,
  notify_email: true, notify_inapp: true,
}

test('default alert config has correct shape', () => {
  expect(DEFAULT_CONFIG.sov_threshold).toBe(50)
  expect(DEFAULT_CONFIG.wow_threshold).toBe(10)
  expect(DEFAULT_CONFIG.notify_email).toBe(true)
})
