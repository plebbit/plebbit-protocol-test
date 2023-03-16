// the test server can crash without logs, this script adds logs when this happens

const fetch = require('node-fetch')
const {offlineIpfs, pubsubIpfs} = require('./ipfs-config')

const fetchText = async (url) => {
  let text
  try {
    text = await fetch(url, {cache: 'no-cache'}).then((res) => res.text())
  } catch (e) {}
  return text
}

// log when the test server crashes
setInterval(async () => {
  const text = await fetchText('http://localhost:59281')
  if (text === 'test server ready') {
    return
  }
  console.error('test server crashed http://localhost:59281')
}, 200).unref?.()

// log when ipfs crashes
setInterval(async () => {
  const text = await fetchText(`http://localhost:${offlineIpfs.gatewayPort}/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc/readme`)
  if (text && text.startsWith('Hello and Welcome to IPFS')) {
    return
  }
  console.error(`test server offline ipfs daemon crashed http://localhost:${offlineIpfs.gatewayPort}`)
}, 200).unref?.()

// log when pubsub ipfs crashes
setInterval(async () => {
  const text = await fetchText(`http://localhost:${pubsubIpfs.gatewayPort}/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc/readme`)
  if (text && text.startsWith('Hello and Welcome to IPFS')) {
    return
  }
  console.error(`test server pubsub ipfs daemon crashed http://localhost:${offlineIpfs.gatewayPort}`)
}, 200).unref?.()
