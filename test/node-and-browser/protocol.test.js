const Plebbit = require('@plebbit/plebbit-js')
const cborg = require('cborg')
const {fromString: uint8ArrayFromString} = require('uint8arrays/from-string')
const {toString: uint8ArrayToString} = require('uint8arrays/to-string')
const {signBufferRsa} = require('../signature-utils')
const {offlineIpfs, pubsubIpfs} = require('../test-server/ipfs-config')
const plebbitOptions = {
  ipfsHttpClientOptions: `http://localhost:${offlineIpfs.apiPort}/api/v0`,
  pubsubHttpClientOptions: `http://localhost:${pubsubIpfs.apiPort}/api/v0`,
}
console.log(plebbitOptions)
const signers = require('../fixtures/signers')
const subplebbitAddress = signers[0].address
// don't use a plebbit signer instance, use plain text object to test
const authorSigner = signers[1]
let plebbit, plebbitSigner

describe('protocol (node and browser)', () => {
  before(async () => {
    plebbit = await Plebbit(plebbitOptions)
    // plebbitSigner = await plebbit.createSigner({privateKey: signers[1].privateKey, type: 'rsa'})
  })
  after(async () => {

  })

  describe('comment', () => {
    it('comment', async () => {
      // const comment = await plebbit.createComment({
      //   subplebbitAddress,
      //   signer: authorSigner,
      //   content: 'content',
      //   title: 'title'
      // })
      // comment.once('challenge', () => comment.publishChallengeAnswers(['2']))
      // await comment.publish()
      // console.log(comment)
      // const challengeVerification = await new Promise(resolve =>
      //   comment.once('challengeverification', resolve)
      // )
      // console.log('challengeverification', challengeVerification)

      // create comment
      const comment = {
        "subplebbitAddress":"QmZVYzLChjKrYDVty6e5JokKffGDZivmEJz9318EYfp2ui",
        "timestamp":1672198583,
        "protocolVersion":"1.0.0",
        "content":"content",
        "title":"title",
        "author":{"address": authorSigner.address}
      }

      // create signature
      // signed prop names can be in any order
      const signedPropertyNames = shuffleArray(["subplebbitAddress","author","timestamp","content","title","link","parentCid"])
      const propsToSign = {}
      for (const propertyName of signedPropertyNames) {
        propsToSign[propertyName] = comment[propertyName]
      }
      console.log({propsToSign})
      const bufferToSign = cborg.encode(propsToSign)
      const signatureBuffer = await signBufferRsa(bufferToSign, authorSigner.privateKey)
      const signatureBase64 = uint8ArrayToString(signatureBuffer, 'base64')

      // add signature
      comment.signature = {
        "signature": signatureBase64,
        "publicKey": authorSigner.publicKey,
        "type": "rsa",
        signedPropertyNames
      }
      console.log({comment})

    })
  })
})

function shuffleArray(array) {
  array = [...array]
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1))
    var temp = array[i]
    array[i] = array[j]
    array[j] = temp
  }
  return array
}
