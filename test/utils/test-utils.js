const isCI = () => {
  let isCI = false
  try {
    if (window.PLEBBIT_PROTOCOL_TEST_CI) {
      isCI = true
    }
  } catch (e) {}
  try {
    if (process.env.CI) {
      isCI = true
    }
  } catch (e) {}
  return isCI
}

module.exports = {isCI}
