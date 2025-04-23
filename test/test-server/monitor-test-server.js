// the test server can crash without logs, this script adds logs when this happens
// you should also import assertTestServerDidntCrash and run it beforeEach and afterEach

import {offlineIpfs, pubsubIpfs} from './ipfs-config.js'

// make sure only one instance is running in node
let started = false
const startMonitoring = async () => {
  if (started) {
    return
  }
  started = true

  // log when test server or ipfs crashes
  setInterval(async () => {
    logTestServerCrashed()
  }, 200).unref?.()
}

// make sure only one instance is running in karma
try {
  if (!window.PLEBBIT_MONITOR_TEST_SERVER_STARTED) {
    startMonitoring()
  }
  window.PLEBBIT_MONITOR_TEST_SERVER_STARTED = true
} catch (e) {}
startMonitoring()

const logTestServerCrashed = async () => {
  try {
    await assertTestServerDidntCrash()
  } catch (e) {
    console.error(e.message)
  }
}

export const assertTestServerDidntCrash = async () => {
  const testServerText = await fetchText('http://127.0.0.1:59281')
  if (testServerText !== 'test server ready') {
    throw Error('test server crashed http://127.0.0.1:59281')
  }
  const offlineIpfsText = await fetchText(`http://127.0.0.1:${offlineIpfs.gatewayPort}/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc/readme`)
  if (!offlineIpfsText?.startsWith('Hello and Welcome to IPFS')) {
    throw Error(`test server crashed offline ipfs daemon http://127.0.0.1:${offlineIpfs.gatewayPort}`)
  }
  const pubsubIpfsText = await fetchText(`http://127.0.0.1:${pubsubIpfs.gatewayPort}/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc/readme`)
  if (!pubsubIpfsText?.startsWith('Hello and Welcome to IPFS')) {
    throw Error(`test server crashed pubsub ipfs daemon http://127.0.0.1:${pubsubIpfs.gatewayPort}`)
  }
}

const fetchText = async (url) => {
  try {
    const res = await fetch(url, {cache: 'no-cache'})
    const resText = await res.text()
    return resText
  } catch (e) {
    console.error(`Error for fetch url`, url, e)
  }
  return undefined
}
