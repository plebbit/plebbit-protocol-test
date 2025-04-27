import {getIpfsKeyFromPrivateKey} from './crypto.js'

// ipfs http client key import is bugged
// this function only works in node, no browser
export const ipfsKeyImport = async ({keyName, privateKey, ipfsHttpUrl}) => {
  const ipfsKey = await getIpfsKeyFromPrivateKey(privateKey)
  const data = new FormData()
  data.append('file', new Blob([ipfsKey]))
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
