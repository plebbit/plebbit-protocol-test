const FormData = require('form-data')
const fetch = require('node-fetch')
const {getIpfsKeyFromPrivateKey} = require('./crypto')

// ipfs http client key import is bugged
// this function only works in node, no browser
const ipfsKeyImport = async ({keyName, privateKey, ipfsHttpUrl}) => {
  const ipfsKey = await getIpfsKeyFromPrivateKey(privateKey)
  const data = new FormData()
  data.append('file', ipfsKey)
  const url = `${ipfsHttpUrl}/key/import?arg=${keyName}`
  const res = await fetch(url, {
    method: 'POST',
    body: data,
  })
  // console.log('ipfsKeyImport:', res)
  if (res.status !== 200) {
    throw Error(`ipfsKeyImport error: '${url}' '${res.status}' '${res.statusText}'`)
  }
}

module.exports = {ipfsKeyImport}
