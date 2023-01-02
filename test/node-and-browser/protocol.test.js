const chai = require('chai')
const {expect} = chai
chai.use(require('chai-string'))

const Plebbit = require('@plebbit/plebbit-js')
const fetch = require('node-fetch')
const cborg = require('cborg')
const IpfsHttpClient = require('ipfs-http-client')
const {encrypt, decrypt} = require('../utils/encryption')
const {ipfsKeyImport} = require('../utils/ipfs')
const {fromString: uint8ArrayFromString} = require('uint8arrays/from-string')
const {toString: uint8ArrayToString} = require('uint8arrays/to-string')
const {signBufferRsa, verifyBufferRsa} = require('../utils/signature')
const {offlineIpfs, pubsubIpfs} = require('../test-server/ipfs-config')
const plebbitOptions = {
  ipfsHttpClientOptions: `http://localhost:${offlineIpfs.apiPort}/api/v0`,
  pubsubHttpClientOptions: `http://localhost:${pubsubIpfs.apiPort}/api/v0`,
}
const ipfsGatewayUrl = `http://localhost:${offlineIpfs.gatewayPort}`
console.log({plebbitOptions, ipfsGatewayUrl})
const pubsubIpfsClient = IpfsHttpClient.create({url: plebbitOptions.pubsubHttpClientOptions})
const ipfsClient = IpfsHttpClient.create({url: plebbitOptions.ipfsHttpClientOptions})
const signers = require('../fixtures/signers')
const subplebbitSigner = signers[0]
// don't use a plebbit signer instance, use plain text object to test
const authorSigner = signers[1]
const pubsubMessageSigner = signers[2]
let plebbit

describe('protocol (node and browser)', () => {
  before(async () => {
    plebbit = await Plebbit(plebbitOptions)
    plebbit.on('error', console.error)
  })
  after(async () => {})

  it.skip('create comment and publish over pubsub', async () => {
    // create comment
    const comment = {
      subplebbitAddress: subplebbitSigner.address,
      timestamp: Math.round(Date.now() / 1000),
      protocolVersion: '1.0.0',
      content: 'content',
      title: 'title',
      author: {address: authorSigner.address},
    }

    // create comment signature
    // signed prop names can be in any order
    const commentSignedPropertyNames = shuffleArray(['subplebbitAddress', 'author', 'timestamp', 'content', 'title', 'link', 'parentCid'])
    const commentSignature = await sign({
      objectToSign: comment,
      signedPropertyNames: commentSignedPropertyNames,
      privateKey: authorSigner.privateKey,
    })
    comment.signature = {
      signature: commentSignature,
      publicKey: authorSigner.publicKey,
      type: 'rsa',
      signedPropertyNames: commentSignedPropertyNames,
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
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge request message signature
    const challengeRequestPubsubMessageSignedPropertyNames = shuffleArray(['type', 'challengeRequestId', 'encryptedPublication', 'acceptedChallengeTypes'])
    const challengeRequestPubsubMessageSignature = await sign({
      objectToSign: challengeRequestPubsubMessage,
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeRequestPubsubMessage.signature = {
      signature: challengeRequestPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'rsa',
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
    }
    console.log({challengeRequestPubsubMessage})

    // publish pubsub challenge request message
    const challengePubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeRequestPubsubMessage)
    console.log({challengePubsubMessage})

    // decrypt challenges
    const challenges = JSON.parse(
      await decrypt(
        challengePubsubMessage.encryptedChallenges.encrypted,
        challengePubsubMessage.encryptedChallenges.encryptedKey,
        // TODO: change to pubsubMessageSigner.privateKey when plebbit-js bug is fixed
        authorSigner.privateKey
      )
    )
    console.log({challenges})

    // validate challenge pubsub message
    expect(challenges[0].challenge).to.equal('1+1=?')
    expect(challenges[0].type).to.equal('text')
    expect(challengePubsubMessage.type).to.equal('CHALLENGE')
    expect(challengePubsubMessage.encryptedChallenges.type).to.equal('aes-cbc')
    expect(challengePubsubMessage.challengeRequestId).to.equal(challengeRequestPubsubMessage.challengeRequestId)

    // validate challenge pubsub message subplebbit owner signature
    expect(challengePubsubMessage.signature.type).to.equal('rsa')
    expect(challengePubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(challengePubsubMessage.signature.signedPropertyNames).to.include.members(['type', 'challengeRequestId', 'encryptedChallenges'])
    expect(
      await verify({
        objectToSign: challengePubsubMessage,
        signedPropertyNames: challengePubsubMessage.signature.signedPropertyNames,
        signature: challengePubsubMessage.signature.signature,
        publicKey: subplebbitSigner.publicKey,
      })
    ).to.equal(true)

    // create pubsub challenge answer message
    const challengeAnswers = ['2']
    const encryptedChallengeAnswers = await encrypt(JSON.stringify(challengeAnswers), subplebbitSigner.publicKey)
    const challengeAnswerPubsubMessage = {
      type: 'CHALLENGEANSWER',
      challengeAnswerId: getRandomString(),
      challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
      encryptedChallengeAnswers,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge answer message signature
    const challengeAnswerPubsubMessageSignedPropertyNames = shuffleArray(['type', 'challengeRequestId', 'challengeAnswerId', 'encryptedChallengeAnswers'])
    const challengeAnswerPubsubMessageSignature = await sign({
      objectToSign: challengeAnswerPubsubMessage,
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeAnswerPubsubMessage.signature = {
      signature: challengeAnswerPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'rsa',
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
    }
    console.log({challengeAnswerPubsubMessage})

    // publish pubsub challenge answer message
    const challengeVerificationPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeAnswerPubsubMessage)
    console.log({challengeVerificationPubsubMessage})

    // decrypt challenge verification publication
    const publishedPublication = JSON.parse(
      await decrypt(
        challengeVerificationPubsubMessage.encryptedPublication.encrypted,
        challengeVerificationPubsubMessage.encryptedPublication.encryptedKey,
        // TODO: change to pubsubMessageSigner.privateKey when plebbit-js bug is fixed
        authorSigner.privateKey
      )
    )
    console.log({publishedPublication})

    // validate challenge verification pubsub message
    expect(publishedPublication.author.address).to.equal(comment.author.address)
    expect(publishedPublication.content).to.equal(comment.content)
    expect(publishedPublication.title).to.equal(comment.title)
    expect(publishedPublication.timestamp).to.equal(comment.timestamp)
    expect(publishedPublication.depth).to.equal(0)
    expect(publishedPublication.subplebbitAddress).to.equal(comment.subplebbitAddress)
    expect(publishedPublication.signature).to.deep.equal(comment.signature)
    expect(publishedPublication.cid).to.startWith('Qm')
    // TODO: uncomment when plebbit-js bug is fixed
    // expect(publishedPublication.ipnsName).to.startWith('Qm')
    expect(challengeVerificationPubsubMessage.type).to.equal('CHALLENGEVERIFICATION')
    expect(challengeVerificationPubsubMessage.encryptedPublication.type).to.equal('aes-cbc')
    expect(challengeVerificationPubsubMessage.challengeSuccess).to.equal(true)
    expect(challengeVerificationPubsubMessage.challengeRequestId).to.equal(challengeAnswerPubsubMessage.challengeRequestId)
    expect(challengeVerificationPubsubMessage.challengeAnswerId).to.equal(challengeAnswerPubsubMessage.challengeAnswerId)

    // validate challenge verification pubsub message subplebbit owner signature
    expect(challengeVerificationPubsubMessage.signature.type).to.equal('rsa')
    expect(challengeVerificationPubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(challengeVerificationPubsubMessage.signature.signedPropertyNames).to.include.members([
      'type',
      'challengeRequestId',
      'challengeAnswerId',
      'challengeSuccess',
      'encryptedPublication',
      'challengeErrors',
      'reason',
    ])
    expect(
      await verify({
        objectToSign: challengeVerificationPubsubMessage,
        signedPropertyNames: challengeVerificationPubsubMessage.signature.signedPropertyNames,
        signature: challengeVerificationPubsubMessage.signature.signature,
        publicKey: subplebbitSigner.publicKey,
      })
    ).to.equal(true)

    // fetch published comment with ipfs
    const commentIpfs = await fetchJson(`${ipfsGatewayUrl}/ipfs/${publishedPublication.cid}`)
    console.log({commentIpfs})

    // validate comment ipfs
    expect(commentIpfs.author.address).to.equal(publishedPublication.author.address)
    expect(commentIpfs.content).to.equal(publishedPublication.content)
    expect(commentIpfs.title).to.equal(publishedPublication.title)
    expect(commentIpfs.timestamp).to.equal(publishedPublication.timestamp)
    expect(commentIpfs.depth).to.equal(publishedPublication.depth)
    expect(commentIpfs.subplebbitAddress).to.equal(publishedPublication.subplebbitAddress)
    expect(commentIpfs.signature).to.deep.equal(publishedPublication.signature)
    expect(commentIpfs.cid).to.equal(undefined)
    expect(commentIpfs.ipnsName).to.equal(publishedPublication.ipnsName)

    // fetch comment ipns
    const commentIpns = await fetchJson(`${ipfsGatewayUrl}/ipns/${commentIpfs.ipnsName}`)
    console.log({commentIpns})

    // validate comment ipns
    expect(commentIpns.upvoteCount).to.equal(0)
    expect(commentIpns.downvoteCount).to.equal(0)
    expect(commentIpns.replyCount).to.equal(0)
    expect(typeof commentIpns.updatedAt).to.equal('number')

    // validate comment ipns signature
    expect(commentIpns.signature.type).to.equal('rsa')
    expect(commentIpns.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(commentIpns.signature.signedPropertyNames).to.include.members([
      'authorEdit',
      'upvoteCount',
      'downvoteCount',
      'replies',
      'replyCount',
      'flair',
      'spoiler',
      'pinned',
      'locked',
      'removed',
      'moderatorReason',
      'updatedAt',
      'author',
    ])
    expect(
      await verify({
        objectToSign: commentIpns,
        signedPropertyNames: commentIpns.signature.signedPropertyNames,
        signature: commentIpns.signature.signature,
        publicKey: subplebbitSigner.publicKey,
      })
    ).to.equal(true)

    // fetch subplebbit ipns
    const subplebbitIpns = await fetchJson(`${ipfsGatewayUrl}/ipns/${subplebbitSigner.address}`)
    console.log({subplebbitIpns})

    // validate subplebbit ipns
    expect(subplebbitIpns.address).to.equal(subplebbitSigner.address)
    expect(typeof subplebbitIpns.updatedAt).to.equal('number')

    // validate subplebbit ipns signature
    expect(subplebbitIpns.signature.type).to.equal('rsa')
    expect(subplebbitIpns.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(subplebbitIpns.signature.signedPropertyNames).to.include.members([
      'address',
      'title',
      'description',
      'roles',
      'pubsubTopic',
      'lastPostCid',
      'posts',
      'challengeTypes',
      'metricsCid',
      'createdAt',
      'updatedAt',
      'features',
      'suggested',
      'rules',
      'flairs',
      'encryption',
    ])
    expect(
      await verify({
        objectToSign: subplebbitIpns,
        signedPropertyNames: subplebbitIpns.signature.signedPropertyNames,
        signature: subplebbitIpns.signature.signature,
        publicKey: subplebbitSigner.publicKey,
      })
    ).to.equal(true)
  })

  it('create subplebbit and listen over pubsub', async () => {
    // change the subplebbit signer to a sub that isn't running in the test server
    const subplebbitSigner = signers[1]
    const authorSigner = signers[0]

    // create subplebbit ipns object
    const subplebbitIpns = {
      address: subplebbitSigner.address,
      title: 'title',
      description: 'description',
      createdAt: Math.round(Date.now() / 1000),
      updatedAt: Math.round(Date.now() / 1000),
      protocolVersion: '1.0.0',
      encryption: {
        type: 'aes-cbc',
        publicKey: subplebbitSigner.publicKey,
      },
      // TODO: remove posts should be optional
      posts: {pages: {}, pageCids: {}},
      // TODO: remove pubsubTopic should be optional
      pubsubTopic: subplebbitSigner.address,
    }

    // create subplebbit ipns signature
    const subplebbitIpnsSignedPropertyNames = shuffleArray([
      'address',
      'title',
      'description',
      'roles',
      'pubsubTopic',
      'lastPostCid',
      'posts',
      'challengeTypes',
      'metricsCid',
      'createdAt',
      'updatedAt',
      'features',
      'suggested',
      'rules',
      'flairs',
      'protocolVersion',
      'encryption',
    ])
    const subplebbitIpnsSignature = await sign({
      objectToSign: subplebbitIpns,
      signedPropertyNames: subplebbitIpnsSignedPropertyNames,
      privateKey: subplebbitSigner.privateKey,
    })
    subplebbitIpns.signature = {
      signature: subplebbitIpnsSignature,
      publicKey: subplebbitSigner.publicKey,
      type: 'rsa',
      signedPropertyNames: subplebbitIpnsSignedPropertyNames,
    }
    console.log({subplebbitIpns})

    // publish ipns
    try {
      // ignore failure if key is already imported
      await ipfsKeyImport({
        keyName: subplebbitSigner.address,
        privateKey: subplebbitSigner.privateKey,
        ipfsHttpUrl: plebbitOptions.ipfsHttpClientOptions,
      })
    } catch (e) {
      console.log(e.message)
    }
    const subplebbitIpnsFile = await ipfsClient.add(JSON.stringify(subplebbitIpns))
    await ipfsClient.name.publish(subplebbitIpnsFile.path, {
      lifetime: '72h',
      key: subplebbitSigner.address, // ipfs key name
      allowOffline: true,
    })

    // listen for comment over p2p
    const signer = await plebbit.createSigner({privateKey: authorSigner.privateKey, type: 'rsa'})
    const createCommentOptions = {
      subplebbitAddress: subplebbitSigner.address,
      signer,
      title: 'title',
      content: 'content',
    }
    const comment = await plebbit.createComment({...createCommentOptions})
    const pubsub = await pubsubSubscribe(subplebbitSigner.address)
    comment.on('challenge', (challenge) => {
      console.log('challenge event')
      comment.publishChallengeAnswers(['2']).catch(console.error)
    })
    const challengeVerificationPromise = new Promise((resolve) => {
      comment.on('challengeverification', (challengeVerification) => {
        console.log('challengeverification event')
        resolve(challengeVerification)
      })
    })
    comment.publish().catch(console.error)
    const challengeRequestPubsubMessage = await pubsub.getMessage()

    // decrypt publication
    challengeRequestPubsubMessage.publication = JSON.parse(
      await decrypt(
        challengeRequestPubsubMessage.encryptedPublication.encrypted,
        challengeRequestPubsubMessage.encryptedPublication.encryptedKey,
        subplebbitSigner.privateKey
      )
    )
    console.log({challengeRequestPubsubMessage})

    // validate challenge request pubsub message
    expect(challengeRequestPubsubMessage.type).to.equal('CHALLENGEREQUEST')
    expect(challengeRequestPubsubMessage.encryptedPublication.type).to.equal('aes-cbc')
    expect(typeof challengeRequestPubsubMessage.challengeRequestId).to.equal('string')

    // validate challenge request pubsub message signature
    expect(challengeRequestPubsubMessage.signature.type).to.equal('rsa')
    // TODO: pubsub message signer should not be the publication signer or loss of anonymity
    // expect(challengeRequestPubsubMessage.signature.publicKey).to.not.equal(authorSigner.publicKey)
    expect(challengeRequestPubsubMessage.signature.signedPropertyNames).to.include.members([
      'type',
      'challengeRequestId',
      'encryptedPublication',
      'acceptedChallengeTypes',
    ])
    expect(
      await verify({
        objectToSign: challengeRequestPubsubMessage,
        signedPropertyNames: challengeRequestPubsubMessage.signature.signedPropertyNames,
        signature: challengeRequestPubsubMessage.signature.signature,
        // use a random new public key, which must be the same with all future same challengeRequestId
        publicKey: challengeRequestPubsubMessage.signature.publicKey,
      })
    ).to.equal(true)

    // validate publication and publication signature
    expect(challengeRequestPubsubMessage.publication.author.address).to.equal(authorSigner.address)
    expect(challengeRequestPubsubMessage.publication.content).to.equal(createCommentOptions.content)
    expect(challengeRequestPubsubMessage.publication.title).to.equal(createCommentOptions.title)
    expect(challengeRequestPubsubMessage.publication.timestamp).to.equal(comment.timestamp)
    expect(typeof challengeRequestPubsubMessage.publication.timestamp).to.equal('number')
    expect(challengeRequestPubsubMessage.publication.subplebbitAddress).to.equal(createCommentOptions.subplebbitAddress)
    expect(challengeRequestPubsubMessage.publication.signature.signedPropertyNames).to.include.members([
      // NOTE: flair and spoiler and not included in author signature because subplebbit mods can override it
      'author',
      'subplebbitAddress',
      'timestamp',
      'parentCid',
      'content',
      'link',
    ])
    expect(
      await verify({
        objectToSign: challengeRequestPubsubMessage.publication,
        signedPropertyNames: challengeRequestPubsubMessage.publication.signature.signedPropertyNames,
        signature: challengeRequestPubsubMessage.publication.signature.signature,
        publicKey: authorSigner.publicKey,
      })
    ).to.equal(true)

    // create challenge pusub message
    const challenges = [{challenge: '1+1=?', type: 'text'}]
    const encryptedChallenges = await encrypt(JSON.stringify(challenges), challengeRequestPubsubMessage.signature.publicKey)
    const challengePubsubMessage = {
      type: 'CHALLENGE',
      challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
      encryptedChallenges,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge message signature
    const challengePubsubMessageSignedPropertyNames = shuffleArray(['type', 'challengeRequestId', 'encryptedChallenges'])
    const challengePubsubMessageSignature = await sign({
      objectToSign: challengePubsubMessage,
      signedPropertyNames: challengePubsubMessageSignedPropertyNames,
      privateKey: subplebbitSigner.privateKey,
    })
    challengePubsubMessage.signature = {
      signature: challengePubsubMessageSignature,
      publicKey: subplebbitSigner.publicKey,
      type: 'rsa',
      signedPropertyNames: challengePubsubMessageSignedPropertyNames,
    }
    console.log({challengePubsubMessage})

    // publish challenge pubsub message
    const challengeAnswerPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengePubsubMessage)

    // decrypt challenge answers
    challengeAnswerPubsubMessage.challengeAnswers = JSON.parse(
      await decrypt(
        challengeAnswerPubsubMessage.encryptedChallengeAnswers.encrypted,
        challengeAnswerPubsubMessage.encryptedChallengeAnswers.encryptedKey,
        subplebbitSigner.privateKey
      )
    )
    console.log({challengeAnswerPubsubMessage})

    // validate challenge answer pubsub message
    expect(challengeAnswerPubsubMessage.type).to.equal('CHALLENGEANSWER')
    expect(challengeAnswerPubsubMessage.encryptedChallengeAnswers.type).to.equal('aes-cbc')
    expect(challengeAnswerPubsubMessage.challengeRequestId).to.equal(challengeRequestPubsubMessage.challengeRequestId)
    expect(typeof challengeAnswerPubsubMessage.challengeAnswerId).to.equal('string')
    expect(challengeAnswerPubsubMessage.challengeAnswers).to.deep.equal(['2'])

    // validate challenge answer pubsub message signature
    expect(challengeAnswerPubsubMessage.signature.type).to.equal('rsa')
    // the pubsub message signer is the same as the original challenge request id
    expect(challengeAnswerPubsubMessage.signature.publicKey).to.equal(challengeRequestPubsubMessage.signature.publicKey)
    expect(challengeAnswerPubsubMessage.signature.signedPropertyNames).to.include.members([
      'type',
      'challengeRequestId',
      'challengeAnswerId',
      'encryptedChallengeAnswers',
    ])
    expect(
      await verify({
        objectToSign: challengeAnswerPubsubMessage,
        signedPropertyNames: challengeAnswerPubsubMessage.signature.signedPropertyNames,
        signature: challengeAnswerPubsubMessage.signature.signature,
        publicKey: challengeAnswerPubsubMessage.signature.publicKey,
      })
    ).to.equal(true)

    // create encrypted publication
    const publicationIpfs = {
      ...challengeRequestPubsubMessage.publication,
      depth: 0,
      ipnsName: 'ipns name',
    }
    const publicationIpfsFile = await ipfsClient.add(JSON.stringify(subplebbitIpns))
    const publishedPublication = {
      ...publicationIpfs,
      cid: publicationIpfsFile.path,
    }
    console.log({publishedPublication})
    const encryptedPublishedPublication = await encrypt(JSON.stringify(publishedPublication), challengeRequestPubsubMessage.signature.publicKey)

    // create challenge verification pubsub message
    const challengeVerificationPubsubMessage = {
      type: 'CHALLENGEVERIFICATION',
      challengeRequestId: challengeAnswerPubsubMessage.challengeRequestId,
      challengeAnswerId: challengeAnswerPubsubMessage.challengeAnswerId,
      challengeSuccess: true,
      encryptedPublication: encryptedPublishedPublication,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }
    const challengeVerificationPubsubMessageSignedPropertyNames = shuffleArray([
      'type',
      'challengeRequestId',
      'challengeAnswerId',
      'challengeSuccess',
      'encryptedPublication',
      'challengeErrors',
      'reason',
    ])
    const challengeVerificationPubsubMessageSignature = await sign({
      objectToSign: challengeVerificationPubsubMessage,
      signedPropertyNames: challengeVerificationPubsubMessageSignedPropertyNames,
      privateKey: subplebbitSigner.privateKey,
    })
    challengeVerificationPubsubMessage.signature = {
      signature: challengeVerificationPubsubMessageSignature,
      publicKey: subplebbitSigner.publicKey,
      type: 'rsa',
      signedPropertyNames: challengeVerificationPubsubMessageSignedPropertyNames,
    }
    console.log({challengeVerificationPubsubMessage})

    // publish challenge verification pubsub message
    await publishPubsubMessage(subplebbitSigner.address, challengeVerificationPubsubMessage)
    const challengeVerificationEvent = await challengeVerificationPromise
    console.log({challengeVerificationEvent})

    // validate challenge verification event
    expect(challengeVerificationEvent.challengeSuccess).to.equal(true)
    expect(challengeVerificationEvent.publication).to.deep.equal(publishedPublication)

    // validate comment update

    await pubsub.unsubscribe()
  })

  // TODO:

  // describe('create vote and publish over pubsub', () => {})

  // describe('create author comment edit and publish over pubsub', () => {})

  // describe('create mod comment edit and publish over pubsub', () => {})

  // describe('subplebbit edit and publish over pubsub', () => {})
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
  messageReceivedPromise = new Promise((resolve) => {
    onMessageReceived = async (rawMessageReceived) => {
      const messageReceivedString = uint8ArrayToString(rawMessageReceived.data)
      // console.log('message received', messageReceivedString)
      const messageReceivedObject = JSON.parse(messageReceivedString)

      // handle publishing CHALLENGEREQUEST and CHALLENGEANSWER
      if (messageObject.type === 'CHALLENGEREQUEST' || messageObject.type === 'CHALLENGEANSWER') {
        if (messageReceivedObject.type === 'CHALLENGE' || messageReceivedObject.type === 'CHALLENGEVERIFICATION') {
          console.log('unsubscribed from:', pubsubTopic)
          await pubsubIpfsClient.pubsub.unsubscribe(pubsubTopic)
          resolve(messageReceivedObject)
        }
      }

      // handle publishing CHALLENGE
      if (messageObject.type === 'CHALLENGE') {
        if (messageReceivedObject.type === 'CHALLENGEANSWER') {
          resolve(messageReceivedObject)
        }
      }
    }
  })

  await pubsubIpfsClient.pubsub.subscribe(pubsubTopic, onMessageReceived)
  console.log('subscribed to:', pubsubTopic)

  const message = uint8ArrayFromString(JSON.stringify(messageObject))
  await pubsubIpfsClient.pubsub.publish(pubsubTopic, message)
  console.log('published message:', messageObject.type)

  // handle publishing CHALLENGEVERIFICATION
  if (messageObject.type === 'CHALLENGEVERIFICATION') {
    return
  }

  const messageReceived = await messageReceivedPromise
  return messageReceived
}

const pubsubSubscribe = async (pubsubTopic) => {
  let getMessageResolve = () => {}

  const onMessageReceived = async (rawMessageReceived) => {
    await sleep(100) // need to sleep or doesn't work for some reason

    const messageReceivedString = uint8ArrayToString(rawMessageReceived.data)
    // console.log('message received', messageReceivedString)

    const messageReceivedObject = JSON.parse(messageReceivedString)
    if (messageReceivedObject.type === 'CHALLENGEREQUEST' || messageReceivedObject.type === 'CHALLENGEANSWER') {
      getMessageResolve(messageReceivedObject)
    }
  }

  await pubsubIpfsClient.pubsub.subscribe(pubsubTopic, onMessageReceived)
  console.log('subscribed to:', pubsubTopic)

  return {
    getMessage: async () => {
      // every time getMessage is called, replace the resolve function with the latest
      const getMessagePromise = new Promise((resolve) => {
        getMessageResolve = resolve
      })
      const message = await getMessagePromise
      return message
    },
    unsubscribe: async () => {
      await pubsubIpfsClient.pubsub.unsubscribe(pubsubTopic)
      console.log('unsubscribed from:', pubsubTopic)
    },
  }
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

const fetchJson = async (url) => {
  const _fetchJson = () =>
    fetch(url, {
      // ipfs tries to redirect to <cid>.localhost
      redirect: 'manual',
    }).then((res) => res.json())

  // retry because ipns takes some time to load
  let maxRetries = 5
  while (true) {
    try {
      const res = await _fetchJson(url)
      return res
    } catch (e) {
      if (maxRetries-- === 0) {
        throw e
      }
      await new Promise((r) => setTimeout(r, 1000)) // sleep
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
