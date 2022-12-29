const Plebbit = require('@plebbit/plebbit-js')
const {expect} = require('chai')
const cborg = require('cborg')
const IpfsHttpClient = require('ipfs-http-client')
const {encrypt, decrypt} = require('../encryption-utils')
const {fromString: uint8ArrayFromString} = require('uint8arrays/from-string')
const {toString: uint8ArrayToString} = require('uint8arrays/to-string')
const {signBufferRsa, verifyBufferRsa} = require('../signature-utils')
const {offlineIpfs, pubsubIpfs} = require('../test-server/ipfs-config')
const plebbitOptions = {
  ipfsHttpClientOptions: `http://localhost:${offlineIpfs.apiPort}/api/v0`,
  pubsubHttpClientOptions: `http://localhost:${pubsubIpfs.apiPort}/api/v0`,
}
console.log(plebbitOptions)
const pubsubIpfsClient = IpfsHttpClient.create({url: plebbitOptions.pubsubHttpClientOptions})
const signers = require('../fixtures/signers')
const subplebbitSigner = signers[0]
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
      //   subplebbitAddress: subplebbitSigner.address,
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
        "subplebbitAddress": subplebbitSigner.address,
        "timestamp": Math.round(Date.now() / 1000),
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
      const challengeRequestPubsubMessage = {
        type: 'CHALLENGEREQUEST',
        challengeRequestId: getRandomString(),
        acceptedChallengeTypes: ['image'],
        encryptedPublication: encryptedPublication,
        protocolVersion: '1.0.0',
        userAgent: `/protocol-test:1.0.0/`
      }

      // create pubsub challenge request message signature
      const challengeRequestPubsubMessageSignedPropertyNames = shuffleArray(['type','challengeRequestId', 'encryptedPublication', 'acceptedChallengeTypes'])
      const challengeRequestPubsubMessageSignature = await sign({
        objectToSign: challengeRequestPubsubMessage,
        signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
        privateKey: pubsubMessageSigner.privateKey
      })
      challengeRequestPubsubMessage.signature = {
        "signature": challengeRequestPubsubMessageSignature,
        "publicKey": pubsubMessageSigner.publicKey,
        "type": "rsa",
        signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames
      }
      console.log({challengeRequestPubsubMessage})

      // publish pubsub challenge request message
      const challengePubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeRequestPubsubMessage)
      console.log({challengePubsubMessage})

      // decrypt challenge
      const challenge = await decrypt(
        challengePubsubMessage.encryptedChallenges.encrypted, 
        challengePubsubMessage.encryptedChallenges.encryptedKey,
        // TODO: change to pubsubMessageSigner.privateKey when plebbit-js bug is fixed
        authorSigner.privateKey
      )
      console.log({challenge})

      // validate challenge pubsub message
      expect(challenge).to.equal('[{"challenge":"1+1=?","type":"text"}]')
      expect(challengePubsubMessage.type).to.equal('CHALLENGE')
      expect(challengePubsubMessage.encryptedChallenges.type).to.equal('aes-cbc')
      expect(challengePubsubMessage.challengeRequestId).to.equal(challengeRequestPubsubMessage.challengeRequestId)

      // validate challenge pubsub message subplebbit owner signature
      expect(challengePubsubMessage.signature.type).to.equal('rsa')
      expect(challengePubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
      expect(challengePubsubMessage.signature.signedPropertyNames.includes('type')).to.equal(true)
      expect(challengePubsubMessage.signature.signedPropertyNames.includes('challengeRequestId')).to.equal(true)
      expect(challengePubsubMessage.signature.signedPropertyNames.includes('encryptedChallenges')).to.equal(true)
      expect(await verify({
        objectToSign: challengePubsubMessage, 
        signedPropertyNames: challengePubsubMessage.signature.signedPropertyNames, 
        signature: challengePubsubMessage.signature.signature, 
        publicKey: subplebbitSigner.publicKey
      })).to.equal(true)

      // create pubsub challenge answer message
      const challengeAnswers = ['2']
      const encryptedChallengeAnswers = await encrypt(JSON.stringify(challengeAnswers), subplebbitSigner.publicKey)
      const challengeAnswerPubsubMessage = {
        type: 'CHALLENGEANSWER',
        challengeAnswerId: getRandomString(),
        challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
        encryptedChallengeAnswers,
        protocolVersion: '1.0.0',
        userAgent: `/protocol-test:1.0.0/`
      }

      // create pubsub challenge answer message signature
      const challengeAnswerPubsubMessageSignedPropertyNames = shuffleArray(['type','challengeRequestId', 'challengeAnswerId', 'encryptedChallengeAnswers'])
      const challengeAnswerPubsubMessageSignature = await sign({
        objectToSign: challengeAnswerPubsubMessage,
        signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
        privateKey: pubsubMessageSigner.privateKey
      })
      challengeAnswerPubsubMessage.signature = {
        "signature": challengeAnswerPubsubMessageSignature,
        "publicKey": pubsubMessageSigner.publicKey,
        "type": "rsa",
        signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames
      }
      console.log({challengeAnswerPubsubMessage})

      // publish pubsub challenge answer message
      const challengeVerificationPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeAnswerPubsubMessage)
      console.log({challengeVerificationPubsubMessage})
    })
  })
})

const getBufferToSign = (objectToSign, signedPropertyNames) => {
  const propsToSign = {}
  for (const propertyName of signedPropertyNames) {
    propsToSign[propertyName] = objectToSign[propertyName]
  }
  // console.log({propsToSign})
  const bufferToSign = cborg.encode(propsToSign)
  return bufferToSign
}

const sign = async ({objectToSign, signedPropertyNames, privateKey}) => {
  const bufferToSign = getBufferToSign(objectToSign, signedPropertyNames)
  const signatureBuffer = await signBufferRsa(bufferToSign, privateKey)
  const signatureBase64 = uint8ArrayToString(signatureBuffer, 'base64')
  return signatureBase64
}

const verify = async ({objectToSign, signedPropertyNames, signature, publicKey}) => {
  const bufferToSign = getBufferToSign(objectToSign, signedPropertyNames)
  const signatureAsBuffer = uint8ArrayFromString(signature, 'base64')
  const res = await verifyBufferRsa(bufferToSign, signatureAsBuffer, publicKey)
  return res
}

const publishPubsubMessage = async (pubsubTopic, messageObject) => {
  let onMessageReceived
  messageReceivedPromise = new Promise(resolve => {
    onMessageReceived = async (rawMessageReceived) => {
      const messageReceivedString = uint8ArrayToString(rawMessageReceived.data)
      // console.log('message received', messageReceivedString)
      const messageReceivedObject = JSON.parse(messageReceivedString)
      if (messageReceivedObject.type === 'CHALLENGE' || messageReceivedObject.type === 'CHALLENGEVERIFICATION') {
        await pubsubIpfsClient.pubsub.unsubscribe(pubsubTopic) 
        resolve(messageReceivedObject)
      }
    }
  })

  await pubsubIpfsClient.pubsub.subscribe(pubsubTopic, onMessageReceived)
  console.log('subscribed to:', pubsubTopic)

  const message = uint8ArrayFromString(JSON.stringify(messageObject))
  await pubsubIpfsClient.pubsub.publish(pubsubTopic, message)
  console.log('published message:', messageObject.type)

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
