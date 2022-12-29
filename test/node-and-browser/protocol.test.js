const Plebbit = require('@plebbit/plebbit-js')
const cborg = require('cborg')
const IpfsHttpClient = require('ipfs-http-client')
const {encrypt, decrypt} = require('../encryption-utils')
const {fromString: uint8ArrayFromString} = require('uint8arrays/from-string')
const {toString: uint8ArrayToString} = require('uint8arrays/to-string')
const {signBufferRsa} = require('../signature-utils')
const {offlineIpfs, pubsubIpfs} = require('../test-server/ipfs-config')
const plebbitOptions = {
  ipfsHttpClientOptions: `http://localhost:${offlineIpfs.apiPort}/api/v0`,
  pubsubHttpClientOptions: `http://localhost:${pubsubIpfs.apiPort}/api/v0`,
}
console.log(plebbitOptions)
const pubsubIpfsClient = IpfsHttpClient.create({url: plebbitOptions.pubsubHttpClientOptions})
const signers = require('../fixtures/signers')
const subplebbitSigner = signers[0]
const subplebbitAddress = signers[0].address
// don't use a plebbit signer instance, use plain text object to test
const authorSigner = signers[1]
const pubsubMessageSigner = signers[2]
let plebbit, plebbitSigner

describe('protocol (node and browser)', () => {
  before(async () => {
    // plebbit = await Plebbit(plebbitOptions)
    // plebbitSigner = await plebbit.createSigner({privateKey: signers[1].privateKey, type: 'rsa'})
  })
  after(async () => {

  })

  describe('create comment and publish over pubsub', () => {
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

      // create comment signature
      // signed prop names can be in any order
      const commentSignedPropertyNames = shuffleArray(["subplebbitAddress","author","timestamp","content","title","link","parentCid"])
      const commentSignature = await sign({
        objectToSign: comment,
        signedPropertyNames: commentSignedPropertyNames,
        privateKey: authorSigner.privateKey
      })
      comment.signature = {
        "signature": commentSignature,
        "publicKey": authorSigner.publicKey,
        "type": "rsa",
        signedPropertyNames: commentSignedPropertyNames
      }
      console.log({comment})

      // encrypt publication
      const encryptedPublication = await encrypt(JSON.stringify(comment), subplebbitSigner.publicKey)

      // create pubsub challenge request message
      const challengeRequestPubsubMessageObject = {
        type: 'CHALLENGEREQUEST',
        // signature: 'Signature'
        challengeRequestId: getRandomString(),
        acceptedChallengeTypes: ['image'],
        encryptedPublication: encryptedPublication,
        protocolVersion: '1.0.0',
        userAgent: `/plebbit-js:1.0.0/`
      }

      // create pubsub challenge request message signature
      const challengeRequestPubsubMessageSignedPropertyNames = shuffleArray(['type','challengeRequestId', 'encryptedPublication', 'acceptedChallengeTypes'])
      const challengeRequestPubsubMessageSignature = await sign({
        objectToSign: challengeRequestPubsubMessageObject,
        // signed prop names can be in any order
        signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
        privateKey: pubsubMessageSigner.privateKey
      })
      challengeRequestPubsubMessageObject.signature = {
        "signature": challengeRequestPubsubMessageSignature,
        "publicKey": pubsubMessageSigner.publicKey,
        "type": "rsa",
        signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames
      }
      console.log({challengeRequestPubsubMessageObject})

      // // publish pubsub challenge request message
      // const challengePubsubMessage = await publishPubsubMessage(subplebbitAddress, pubsubMessage)
    })
  })
})

const sign = async ({objectToSign, signedPropertyNames, privateKey}) => {
  const propsToSign = {}
  for (const propertyName of signedPropertyNames) {
    propsToSign[propertyName] = objectToSign[propertyName]
  }
  // console.log({propsToSign})
  const bufferToSign = cborg.encode(propsToSign)
  const signatureBuffer = await signBufferRsa(bufferToSign, privateKey)
  const signatureBase64 = uint8ArrayToString(signatureBuffer, 'base64')
  return signatureBase64
}

const publishPubsubMessage = async (pubsubTopic, message) => {
  let onMessageReceived
  messageReceivedPromise = new Promise(resolve => {
    onMessageReceived = (message) => {
      console.log(`received message from ${message.from}:`, toString(message.data))
      resolve(message)
    }
  })

  console.log('trying to subscribe to:', pubsubTopic)
  await pubsubIpfsClient.pubsub.subscribe(pubsubTopic, onMessageReceived)
  console.log('subscribed to:', pubsubTopic)

  console.log('trying to publish:', message)
  await pubsubIpfsClient.pubsub.publish(pubsubTopic, Buffer.from(message))
  console.log('published:', message)

  const messageReceived = await messageReceivedPromise
  return messageReceived
}

const getRandomString = () => (Math.random() + 1).toString(36).replace('.', '')

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
