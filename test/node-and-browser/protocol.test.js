// polyfill window.process for "assert" package
try {
  if (!window.process?.env) {
    window.process = {env: {}}
  }
} catch (e) {}

// log full objects in node
try {
  require('util').inspect.defaultOptions.depth = null
} catch (e) {}

require('../test-server/monitor-test-server')
const chai = require('chai')
const {expect} = chai
chai.use(require('chai-string'))

const Plebbit = require('@plebbit/plebbit-js')
const fetch = require('node-fetch')
const cborg = require('cborg')
const IpfsHttpClient = require('ipfs-http-client')
const {encryptEd25519AesGcm, decryptEd25519AesGcm} = require('../utils/encryption')
const {fromString: uint8ArrayFromString} = require('uint8arrays/from-string')
const {toString: uint8ArrayToString} = require('uint8arrays/to-string')
const {signBufferEd25519, verifyBufferEd25519} = require('../utils/signature')
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
let plebbit
let publishedCommentCid
let publishedCommentIpnsName

describe('protocol (node and browser)', function () {
  // add retries because sometimes the CI is flaky
  this.retries(3)

  before(async () => {
    plebbit = await Plebbit(plebbitOptions)
    plebbit.on('error', console.error)
  })
  after(async () => {})

  // publishedCommentCid is defined in this test, add .only if needed
  it('create comment and publish over pubsub', async () => {
    const subplebbitSigner = signers[0]
    const authorSigner = signers[1]
    const pubsubMessageSigner = signers[2]

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
      type: 'ed25519',
      signedPropertyNames: commentSignedPropertyNames,
    }
    console.log({comment})

    // encrypt publication
    const encryptedPublication = await encryptEd25519AesGcm(JSON.stringify(comment), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)

    // create pubsub challenge request message
    const challengeRequestPubsubMessage = {
      type: 'CHALLENGEREQUEST',
      timestamp: Math.round(Date.now() / 1000),
      challengeRequestId: getRandomString(),
      acceptedChallengeTypes: ['image/png'],
      encryptedPublication: encryptedPublication,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge request message signature
    const challengeRequestPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'encryptedPublication', 'acceptedChallengeTypes'])
    const challengeRequestPubsubMessageSignature = await sign({
      objectToSign: challengeRequestPubsubMessage,
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeRequestPubsubMessage.signature = {
      signature: challengeRequestPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
    }
    console.log({challengeRequestPubsubMessage})

    // publish pubsub challenge request message
    const challengePubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeRequestPubsubMessage)
    console.log({challengePubsubMessage})

    // decrypt challenges
    const challenges = JSON.parse(await decryptEd25519AesGcm(challengePubsubMessage.encryptedChallenges, pubsubMessageSigner.privateKey, subplebbitSigner.publicKey))
    console.log({challenges})

    // validate challenge pubsub message
    expect(challenges[0].challenge).to.equal('1+1=?')
    expect(challenges[0].type).to.equal('text')
    expect(challengePubsubMessage.type).to.equal('CHALLENGE')
    expect(challengePubsubMessage.encryptedChallenges.type).to.equal('ed25519-aes-gcm')
    expect(challengePubsubMessage.challengeRequestId).to.equal(challengeRequestPubsubMessage.challengeRequestId)

    // validate challenge pubsub message subplebbit owner signature
    expect(challengePubsubMessage.signature.type).to.equal('ed25519')
    expect(challengePubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(challengePubsubMessage.signature.signedPropertyNames).to.include.members(['type', 'timestamp', 'challengeRequestId', 'encryptedChallenges'])
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
    const encryptedChallengeAnswers = await encryptEd25519AesGcm(JSON.stringify(challengeAnswers), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)
    const challengeAnswerPubsubMessage = {
      type: 'CHALLENGEANSWER',
      timestamp: Math.round(Date.now() / 1000),
      challengeAnswerId: getRandomString(),
      challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
      encryptedChallengeAnswers,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge answer message signature
    const challengeAnswerPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'challengeAnswerId', 'encryptedChallengeAnswers'])
    const challengeAnswerPubsubMessageSignature = await sign({
      objectToSign: challengeAnswerPubsubMessage,
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeAnswerPubsubMessage.signature = {
      signature: challengeAnswerPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
    }
    console.log({challengeAnswerPubsubMessage})

    // publish pubsub challenge answer message
    const challengeVerificationPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeAnswerPubsubMessage)
    console.log({challengeVerificationPubsubMessage})

    // decrypt challenge verification publication
    const publishedPublication = JSON.parse(
      await decryptEd25519AesGcm(challengeVerificationPubsubMessage.encryptedPublication, pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)
    )
    console.log({publishedPublication})
    publishedCommentCid = publishedPublication.cid
    publishedCommentIpnsName = publishedPublication.ipnsName

    // validate challenge verification pubsub message
    expect(publishedPublication.author.address).to.equal(comment.author.address)
    expect(publishedPublication.content).to.equal(comment.content)
    expect(publishedPublication.title).to.equal(comment.title)
    expect(publishedPublication.timestamp).to.equal(comment.timestamp)
    expect(publishedPublication.depth).to.equal(0)
    expect(publishedPublication.subplebbitAddress).to.equal(comment.subplebbitAddress)
    expect(publishedPublication.signature).to.deep.equal(comment.signature)
    expect(publishedPublication.cid).to.startWith('Qm')
    expect(publishedPublication.ipnsName).to.startWith('12D3KooW')
    expect(challengeVerificationPubsubMessage.type).to.equal('CHALLENGEVERIFICATION')
    expect(challengeVerificationPubsubMessage.encryptedPublication.type).to.equal('ed25519-aes-gcm')
    expect(challengeVerificationPubsubMessage.challengeSuccess).to.equal(true)
    expect(challengeVerificationPubsubMessage.challengeRequestId).to.equal(challengeAnswerPubsubMessage.challengeRequestId)
    expect(challengeVerificationPubsubMessage.challengeAnswerId).to.equal(challengeAnswerPubsubMessage.challengeAnswerId)

    // validate challenge verification pubsub message subplebbit owner signature
    expect(challengeVerificationPubsubMessage.signature.type).to.equal('ed25519')
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
    expect(typeof commentIpns.author?.subplebbit?.firstCommentTimestamp).to.equal('number')
    expect(typeof commentIpns.author?.subplebbit?.lastCommentCid).to.equal('string')
    expect(typeof commentIpns.author?.subplebbit?.postScore).to.equal('number')
    expect(typeof commentIpns.author?.subplebbit?.replyScore).to.equal('number')

    // validate comment ipns signature
    expect(commentIpns.signature.type).to.equal('ed25519')
    expect(commentIpns.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(commentIpns.signature.signedPropertyNames).to.include.members([
      'edit',
      'upvoteCount',
      'downvoteCount',
      'replies',
      'replyCount',
      'flair',
      'spoiler',
      'pinned',
      'locked',
      'removed',
      'reason',
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
    expect(subplebbitIpns.signature.type).to.equal('ed25519')
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
      'statsCid',
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

    // validate included posts
    expect(subplebbitIpns.posts.pages.hot.comments.length).to.be.greaterThan(0)
    const pageComment = subplebbitIpns.posts.pages.hot.comments.filter((pageComment) => pageComment.comment.cid === publishedCommentCid)[0]
    if (!pageComment) {
      throw Error('published comment is not in subplebbit first page, must restart test server')
    }
    expect(pageComment.comment.cid).to.equal(publishedCommentCid)
    for (const propertyName in comment) {
      expect(pageComment.comment[propertyName]).to.deep.equal(comment[propertyName])
    }
    expect(pageComment.commentUpdate.cid).to.equal(publishedCommentCid)
    expect(typeof pageComment.commentUpdate.updatedAt).to.equal('number')
    expect(pageComment.commentUpdate.signature.publicKey).to.equal(subplebbitSigner.publicKey)

    // fetch page ipfs
    expect(typeof subplebbitIpns.posts.pageCids.new).to.equal('string')
    const pageIpfs = await fetchJson(`${ipfsGatewayUrl}/ipfs/${subplebbitIpns.posts.pageCids.new}`)
    console.log({pageIpfs})

    // validate page ipfs
    expect(pageIpfs.comments.length).to.be.greaterThan(0)
    expect(pageIpfs.comments[0].comment.cid).to.equal(publishedCommentCid)
    for (const propertyName in comment) {
      expect(pageIpfs.comments[0].comment[propertyName]).to.deep.equal(comment[propertyName])
    }
    expect(pageIpfs.comments[0].commentUpdate.cid).to.equal(publishedCommentCid)
    expect(typeof pageIpfs.comments[0].commentUpdate.updatedAt).to.equal('number')
    expect(pageIpfs.comments[0].commentUpdate.signature.publicKey).to.equal(subplebbitSigner.publicKey)
  })

  it('create reply and publish over pubsub', async () => {
    const subplebbitSigner = signers[0]
    const authorSigner = signers[5]
    const pubsubMessageSigner = signers[6]

    // create reply
    const reply = {
      parentCid: publishedCommentCid,
      subplebbitAddress: subplebbitSigner.address,
      timestamp: Math.round(Date.now() / 1000),
      protocolVersion: '1.0.0',
      content: 'reply content',
      author: {address: authorSigner.address},
    }

    // create reply signature
    // signed prop names can be in any order
    const replySignedPropertyNames = shuffleArray(['subplebbitAddress', 'author', 'timestamp', 'content', 'title', 'link', 'parentCid'])
    const replySignature = await sign({
      objectToSign: reply,
      signedPropertyNames: replySignedPropertyNames,
      privateKey: authorSigner.privateKey,
    })
    reply.signature = {
      signature: replySignature,
      publicKey: authorSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: replySignedPropertyNames,
    }
    console.log({reply})

    // encrypt publication
    const encryptedPublication = await encryptEd25519AesGcm(JSON.stringify(reply), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)

    // create pubsub challenge request message
    const challengeRequestPubsubMessage = {
      type: 'CHALLENGEREQUEST',
      timestamp: Math.round(Date.now() / 1000),
      challengeRequestId: getRandomString(),
      acceptedChallengeTypes: ['image/png'],
      encryptedPublication: encryptedPublication,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge request message signature
    const challengeRequestPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'encryptedPublication', 'acceptedChallengeTypes'])
    const challengeRequestPubsubMessageSignature = await sign({
      objectToSign: challengeRequestPubsubMessage,
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeRequestPubsubMessage.signature = {
      signature: challengeRequestPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
    }
    console.log({challengeRequestPubsubMessage})

    // publish pubsub challenge request message
    const challengePubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeRequestPubsubMessage)
    console.log({challengePubsubMessage})

    // decrypt challenges
    const challenges = JSON.parse(await decryptEd25519AesGcm(challengePubsubMessage.encryptedChallenges, pubsubMessageSigner.privateKey, subplebbitSigner.publicKey))
    console.log({challenges})

    // create pubsub challenge answer message
    const challengeAnswers = ['2']
    const encryptedChallengeAnswers = await encryptEd25519AesGcm(JSON.stringify(challengeAnswers), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)
    const challengeAnswerPubsubMessage = {
      type: 'CHALLENGEANSWER',
      timestamp: Math.round(Date.now() / 1000),
      challengeAnswerId: getRandomString(),
      challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
      encryptedChallengeAnswers,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge answer message signature
    const challengeAnswerPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'challengeAnswerId', 'encryptedChallengeAnswers'])
    const challengeAnswerPubsubMessageSignature = await sign({
      objectToSign: challengeAnswerPubsubMessage,
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeAnswerPubsubMessage.signature = {
      signature: challengeAnswerPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
    }
    console.log({challengeAnswerPubsubMessage})

    // publish pubsub challenge answer message
    const challengeVerificationPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeAnswerPubsubMessage)
    console.log({challengeVerificationPubsubMessage})

    // decrypt challenge verification publication
    const publishedPublication = JSON.parse(
      await decryptEd25519AesGcm(challengeVerificationPubsubMessage.encryptedPublication, pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)
    )
    console.log({publishedPublication})
    const replyCid = publishedPublication.cid

    // fetch parent comment ipns until it has reply
    let parentCommentIpns
    let maxAttempt = 50
    while (maxAttempt--) {
      parentCommentIpns = await fetchJson(`${ipfsGatewayUrl}/ipns/${publishedCommentIpnsName}`)
      if (parentCommentIpns?.replyCount > 0) {
        break
      }
      await new Promise((r) => setTimeout(r, 100)) // sleep
    }
    console.log({parentCommentIpns})

    // validate parent comment ipns
    expect(parentCommentIpns).to.not.equal(undefined)
    expect(parentCommentIpns.replyCount).to.equal(1)
    expect(typeof parentCommentIpns.updatedAt).to.equal('number')

    // validate included replies
    expect(parentCommentIpns.replies.pages.topAll.comments.length).to.equal(1)
    expect(parentCommentIpns.replies.pages.topAll.comments[0].comment.cid).to.equal(replyCid)
    for (const propertyName in reply) {
      expect(parentCommentIpns.replies.pages.topAll.comments[0].comment[propertyName]).to.deep.equal(reply[propertyName])
    }
    expect(parentCommentIpns.replies.pages.topAll.comments[0].commentUpdate.cid).to.equal(replyCid)
    expect(typeof parentCommentIpns.replies.pages.topAll.comments[0].commentUpdate.updatedAt).to.equal('number')
    expect(parentCommentIpns.replies.pages.topAll.comments[0].commentUpdate.signature.publicKey).to.equal(subplebbitSigner.publicKey)

    // fetch replies page ipfs
    expect(typeof parentCommentIpns.replies.pageCids.new).to.equal('string')
    const repliesPageIpfs = await fetchJson(`${ipfsGatewayUrl}/ipfs/${parentCommentIpns.replies.pageCids.new}`)
    console.log({repliesPageIpfs})

    // validate replies page ipfs
    expect(repliesPageIpfs.comments.length).to.equal(1)
    expect(repliesPageIpfs.comments[0].comment.cid).to.equal(replyCid)
    for (const propertyName in reply) {
      expect(repliesPageIpfs.comments[0].comment[propertyName]).to.deep.equal(reply[propertyName])
    }
    expect(repliesPageIpfs.comments[0].commentUpdate.cid).to.equal(replyCid)
    expect(typeof repliesPageIpfs.comments[0].commentUpdate.updatedAt).to.equal('number')
    expect(repliesPageIpfs.comments[0].commentUpdate.signature.publicKey).to.equal(subplebbitSigner.publicKey)
  })

  it('create subplebbit and listen over pubsub', async () => {
    // change the subplebbit signer to a sub that isn't running in the test server
    const subplebbitSigner = signers[1]
    const authorSigner = signers[0]
    const commentIpnsSigner = signers[2]

    // create subplebbit ipns object
    const subplebbitIpns = {
      address: subplebbitSigner.address,
      title: 'title',
      description: 'description',
      createdAt: Math.round(Date.now() / 1000),
      updatedAt: Math.round(Date.now() / 1000),
      protocolVersion: '1.0.0',
      encryption: {
        type: 'ed25519-aes-gcm',
        publicKey: subplebbitSigner.publicKey,
      },
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
      'statsCid',
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
      type: 'ed25519',
      signedPropertyNames: subplebbitIpnsSignedPropertyNames,
    }
    console.log({subplebbitIpns})

    // publish ipns
    const subplebbitIpnsFile = await ipfsClient.add(JSON.stringify(subplebbitIpns))
    await ipfsClient.name.publish(subplebbitIpnsFile.path, {
      lifetime: '72h',
      key: subplebbitSigner.address, // ipfs key name imported in test server
      allowOffline: true,
    })

    // listen for comment over p2p
    const signer = await plebbit.createSigner({privateKey: authorSigner.privateKey, type: 'ed25519'})
    const createCommentOptions = {
      subplebbitAddress: subplebbitSigner.address,
      signer,
      title: 'title',
      content: 'content',
    }
    const comment = await plebbit.createComment({...createCommentOptions})
    comment.on('error', console.log)
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
      await decryptEd25519AesGcm(challengeRequestPubsubMessage.encryptedPublication, subplebbitSigner.privateKey, challengeRequestPubsubMessage.signature.publicKey)
    )
    console.log({challengeRequestPubsubMessage})

    // validate challenge request pubsub message
    expect(challengeRequestPubsubMessage.type).to.equal('CHALLENGEREQUEST')
    expect(challengeRequestPubsubMessage.encryptedPublication.type).to.equal('ed25519-aes-gcm')
    expect(typeof challengeRequestPubsubMessage.challengeRequestId).to.equal('string')

    // validate challenge request pubsub message signature
    expect(challengeRequestPubsubMessage.signature.type).to.equal('ed25519')
    expect(challengeRequestPubsubMessage.signature.publicKey).to.not.equal(authorSigner.publicKey)
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
    const encryptedChallenges = await encryptEd25519AesGcm(JSON.stringify(challenges), subplebbitSigner.privateKey, challengeRequestPubsubMessage.signature.publicKey)
    const challengePubsubMessage = {
      type: 'CHALLENGE',
      timestamp: Math.round(Date.now() / 1000),
      challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
      encryptedChallenges,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge message signature
    const challengePubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'encryptedChallenges'])
    const challengePubsubMessageSignature = await sign({
      objectToSign: challengePubsubMessage,
      signedPropertyNames: challengePubsubMessageSignedPropertyNames,
      privateKey: subplebbitSigner.privateKey,
    })
    challengePubsubMessage.signature = {
      signature: challengePubsubMessageSignature,
      publicKey: subplebbitSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengePubsubMessageSignedPropertyNames,
    }
    console.log({challengePubsubMessage})

    // publish challenge pubsub message
    const challengeAnswerPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengePubsubMessage)

    // decrypt challenge answers
    challengeAnswerPubsubMessage.challengeAnswers = JSON.parse(
      await decryptEd25519AesGcm(challengeAnswerPubsubMessage.encryptedChallengeAnswers, subplebbitSigner.privateKey, challengeRequestPubsubMessage.signature.publicKey)
    )
    console.log({challengeAnswerPubsubMessage})

    // validate challenge answer pubsub message
    expect(challengeAnswerPubsubMessage.type).to.equal('CHALLENGEANSWER')
    expect(challengeAnswerPubsubMessage.encryptedChallengeAnswers.type).to.equal('ed25519-aes-gcm')
    expect(challengeAnswerPubsubMessage.challengeRequestId).to.equal(challengeRequestPubsubMessage.challengeRequestId)
    expect(typeof challengeAnswerPubsubMessage.challengeAnswerId).to.equal('string')
    expect(challengeAnswerPubsubMessage.challengeAnswers).to.deep.equal(['2'])

    // validate challenge answer pubsub message signature
    expect(challengeAnswerPubsubMessage.signature.type).to.equal('ed25519')
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
      ipnsName: commentIpnsSigner.address,
    }
    const publicationIpfsFile = await ipfsClient.add(JSON.stringify(subplebbitIpns))
    const publishedPublication = {
      ...publicationIpfs,
      cid: publicationIpfsFile.path,
    }
    console.log({publishedPublication})
    const encryptedPublishedPublication = await encryptEd25519AesGcm(
      JSON.stringify(publishedPublication),
      subplebbitSigner.privateKey,
      challengeRequestPubsubMessage.signature.publicKey
    )

    // create challenge verification pubsub message
    const challengeVerificationPubsubMessage = {
      type: 'CHALLENGEVERIFICATION',
      timestamp: Math.round(Date.now() / 1000),
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
      type: 'ed25519',
      signedPropertyNames: challengeVerificationPubsubMessageSignedPropertyNames,
    }
    console.log({challengeVerificationPubsubMessage})

    // publish challenge verification pubsub message
    await publishPubsubMessage(subplebbitSigner.address, challengeVerificationPubsubMessage)
    const challengeVerificationEvent = await challengeVerificationPromise
    await pubsub.unsubscribe()
    console.log({challengeVerificationEvent})

    // validate challenge verification event
    expect(challengeVerificationEvent.challengeSuccess).to.equal(true)
    expect(challengeVerificationEvent.publication).to.deep.equal(publishedPublication)

    // create comment ipns object
    const commentIpns = {
      cid: publishedPublication.cid,
      // TODO: author should be optional, needs to be fixed in plebbit-js
      author: {},
      upvoteCount: 0,
      updatedAt: Math.round(Date.now() / 1000),
      protocolVersion: '1.0.0',
    }

    // create comment ipns signature
    const commentIpnsSignedPropertyNames = shuffleArray([
      'cid',
      'edit',
      'upvoteCount',
      'downvoteCount',
      'replies',
      'replyCount',
      'flair',
      'spoiler',
      'pinned',
      'locked',
      'removed',
      'reason',
      'updatedAt',
      'author',
    ])
    const commentIpnsSignature = await sign({
      objectToSign: commentIpns,
      signedPropertyNames: commentIpnsSignedPropertyNames,
      privateKey: subplebbitSigner.privateKey,
    })
    commentIpns.signature = {
      signature: commentIpnsSignature,
      publicKey: subplebbitSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: commentIpnsSignedPropertyNames,
    }
    console.log({commentIpns})

    // publish ipns
    const commentIpnsFile = await ipfsClient.add(JSON.stringify(commentIpns))
    await ipfsClient.name.publish(commentIpnsFile.path, {
      lifetime: '72h',
      key: commentIpnsSigner.address, // ipfs key name imported in test server
      allowOffline: true,
    })

    // validate comment update
    const commentUpdatePromise = new Promise((resolve) => {
      comment.on('update', (updatedComment) => {
        console.log('update event')
        resolve(updatedComment)
      })
    })
    comment.update().catch(console.error)
    const updatedComment = await commentUpdatePromise

    comment.stop()
    console.log({updatedComment})
    expect(updatedComment.upvoteCount).to.equal(commentIpns.upvoteCount)
    expect(updatedComment.downvoteCount).to.equal(commentIpns.downvoteCount)
    expect(typeof updatedComment.updatedAt).to.equal('number')
  })

  it('create vote and publish over pubsub', async () => {
    const subplebbitSigner = signers[0]
    const authorSigner = signers[2]
    const pubsubMessageSigner = signers[1]

    expect(publishedCommentCid).to.not.equal(undefined, 'publishedCommentCid gets defined in a previous test, cannot run in .only mode')

    // create vote
    const vote = {
      subplebbitAddress: subplebbitSigner.address,
      timestamp: Math.round(Date.now() / 1000),
      protocolVersion: '1.0.0',
      commentCid: publishedCommentCid,
      vote: 1,
      author: {address: authorSigner.address},
    }

    // create vote signature
    const voteSignedPropertyNames = shuffleArray(['subplebbitAddress', 'author', 'timestamp', 'vote', 'commentCid'])
    const voteSignature = await sign({
      objectToSign: vote,
      signedPropertyNames: voteSignedPropertyNames,
      privateKey: authorSigner.privateKey,
    })
    vote.signature = {
      signature: voteSignature,
      publicKey: authorSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: voteSignedPropertyNames,
    }
    console.log({vote})

    // encrypt publication
    const encryptedPublication = await encryptEd25519AesGcm(JSON.stringify(vote), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)

    // create pubsub challenge request message
    const challengeRequestPubsubMessage = {
      type: 'CHALLENGEREQUEST',
      timestamp: Math.round(Date.now() / 1000),
      challengeRequestId: getRandomString(),
      acceptedChallengeTypes: ['image/png'],
      encryptedPublication: encryptedPublication,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge request message signature
    const challengeRequestPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'encryptedPublication', 'acceptedChallengeTypes'])
    const challengeRequestPubsubMessageSignature = await sign({
      objectToSign: challengeRequestPubsubMessage,
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeRequestPubsubMessage.signature = {
      signature: challengeRequestPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
    }
    console.log({challengeRequestPubsubMessage})

    // publish pubsub challenge request message
    const challengePubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeRequestPubsubMessage)
    console.log({challengePubsubMessage})

    // decrypt challenges
    const challenges = JSON.parse(await decryptEd25519AesGcm(challengePubsubMessage.encryptedChallenges, pubsubMessageSigner.privateKey, subplebbitSigner.publicKey))
    console.log({challenges})

    // validate challenge pubsub message
    expect(challenges[0].challenge).to.equal('1+1=?')
    expect(challenges[0].type).to.equal('text')
    expect(challengePubsubMessage.type).to.equal('CHALLENGE')
    expect(challengePubsubMessage.encryptedChallenges.type).to.equal('ed25519-aes-gcm')
    expect(challengePubsubMessage.challengeRequestId).to.equal(challengeRequestPubsubMessage.challengeRequestId)

    // validate challenge pubsub message subplebbit owner signature
    expect(challengePubsubMessage.signature.type).to.equal('ed25519')
    expect(challengePubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(challengePubsubMessage.signature.signedPropertyNames).to.include.members(['type', 'timestamp', 'challengeRequestId', 'encryptedChallenges'])
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
    const encryptedChallengeAnswers = await encryptEd25519AesGcm(JSON.stringify(challengeAnswers), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)
    const challengeAnswerPubsubMessage = {
      type: 'CHALLENGEANSWER',
      timestamp: Math.round(Date.now() / 1000),
      challengeAnswerId: getRandomString(),
      challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
      encryptedChallengeAnswers,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge answer message signature
    const challengeAnswerPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'challengeAnswerId', 'encryptedChallengeAnswers'])
    const challengeAnswerPubsubMessageSignature = await sign({
      objectToSign: challengeAnswerPubsubMessage,
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeAnswerPubsubMessage.signature = {
      signature: challengeAnswerPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
    }
    console.log({challengeAnswerPubsubMessage})

    // publish pubsub challenge answer message
    const challengeVerificationPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeAnswerPubsubMessage)
    console.log({challengeVerificationPubsubMessage})

    // validate challenge verification pubsub message
    expect(challengeVerificationPubsubMessage.type).to.equal('CHALLENGEVERIFICATION')
    // no point in sending back encrypted vote in verification
    expect(challengeVerificationPubsubMessage.encryptedPublication).to.equal(undefined)
    expect(challengeVerificationPubsubMessage.challengeSuccess).to.equal(true)
    expect(challengeVerificationPubsubMessage.challengeRequestId).to.equal(challengeAnswerPubsubMessage.challengeRequestId)
    expect(challengeVerificationPubsubMessage.challengeAnswerId).to.equal(challengeAnswerPubsubMessage.challengeAnswerId)

    // validate challenge verification pubsub message subplebbit owner signature
    expect(challengeVerificationPubsubMessage.signature.type).to.equal('ed25519')
    expect(challengeVerificationPubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(challengeVerificationPubsubMessage.signature.signedPropertyNames).to.include.members([
      'type',
      'timestamp',
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
  })

  it('create author comment edit and publish over pubsub', async () => {
    const subplebbitSigner = signers[0]
    const authorSigner = signers[1]
    const pubsubMessageSigner = signers[2]

    expect(publishedCommentCid).to.not.equal(undefined, 'publishedCommentCid gets defined in a previous test, cannot run in .only mode')

    // create commend edit
    const commentEdit = {
      subplebbitAddress: subplebbitSigner.address,
      timestamp: Math.round(Date.now() / 1000),
      protocolVersion: '1.0.0',
      commentCid: publishedCommentCid,
      author: {address: authorSigner.address},
      content: 'edited content',
      reason: 'edited reason',
    }

    // create commend edit signature
    const commentEditSignedPropertyNames = shuffleArray([
      'subplebbitAddress',
      'author',
      'timestamp',
      'commentCid',
      'content',
      'deleted',
      'flair',
      'spoiler',
      'reason',
      'pinned',
      'locked',
      'removed',
      'reason',
      'commentAuthor',
    ])
    const commentEditSignature = await sign({
      objectToSign: commentEdit,
      signedPropertyNames: commentEditSignedPropertyNames,
      privateKey: authorSigner.privateKey,
    })
    commentEdit.signature = {
      signature: commentEditSignature,
      publicKey: authorSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: commentEditSignedPropertyNames,
    }
    console.log({commentEdit})

    // encrypt publication
    const encryptedPublication = await encryptEd25519AesGcm(JSON.stringify(commentEdit), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)

    // create pubsub challenge request message
    const challengeRequestPubsubMessage = {
      type: 'CHALLENGEREQUEST',
      timestamp: Math.round(Date.now() / 1000),
      challengeRequestId: getRandomString(),
      acceptedChallengeTypes: ['image/png'],
      encryptedPublication: encryptedPublication,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge request message signature
    const challengeRequestPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'encryptedPublication', 'acceptedChallengeTypes'])
    const challengeRequestPubsubMessageSignature = await sign({
      objectToSign: challengeRequestPubsubMessage,
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeRequestPubsubMessage.signature = {
      signature: challengeRequestPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeRequestPubsubMessageSignedPropertyNames,
    }
    console.log({challengeRequestPubsubMessage})

    // publish pubsub challenge request message
    const challengePubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeRequestPubsubMessage)
    console.log({challengePubsubMessage})

    // decrypt challenges
    const challenges = JSON.parse(await decryptEd25519AesGcm(challengePubsubMessage.encryptedChallenges, pubsubMessageSigner.privateKey, subplebbitSigner.publicKey))
    console.log({challenges})

    // validate challenge pubsub message
    expect(challenges[0].challenge).to.equal('1+1=?')
    expect(challenges[0].type).to.equal('text')
    expect(challengePubsubMessage.type).to.equal('CHALLENGE')
    expect(challengePubsubMessage.encryptedChallenges.type).to.equal('ed25519-aes-gcm')
    expect(challengePubsubMessage.challengeRequestId).to.equal(challengeRequestPubsubMessage.challengeRequestId)

    // validate challenge pubsub message subplebbit owner signature
    expect(challengePubsubMessage.signature.type).to.equal('ed25519')
    expect(challengePubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(challengePubsubMessage.signature.signedPropertyNames).to.include.members(['type', 'timestamp', 'challengeRequestId', 'encryptedChallenges'])
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
    const encryptedChallengeAnswers = await encryptEd25519AesGcm(JSON.stringify(challengeAnswers), pubsubMessageSigner.privateKey, subplebbitSigner.publicKey)
    const challengeAnswerPubsubMessage = {
      type: 'CHALLENGEANSWER',
      timestamp: Math.round(Date.now() / 1000),
      challengeAnswerId: getRandomString(),
      challengeRequestId: challengeRequestPubsubMessage.challengeRequestId,
      encryptedChallengeAnswers,
      protocolVersion: '1.0.0',
      userAgent: `/protocol-test:1.0.0/`,
    }

    // create pubsub challenge answer message signature
    const challengeAnswerPubsubMessageSignedPropertyNames = shuffleArray(['type', 'timestamp', 'challengeRequestId', 'challengeAnswerId', 'encryptedChallengeAnswers'])
    const challengeAnswerPubsubMessageSignature = await sign({
      objectToSign: challengeAnswerPubsubMessage,
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
      privateKey: pubsubMessageSigner.privateKey,
    })
    challengeAnswerPubsubMessage.signature = {
      signature: challengeAnswerPubsubMessageSignature,
      publicKey: pubsubMessageSigner.publicKey,
      type: 'ed25519',
      signedPropertyNames: challengeAnswerPubsubMessageSignedPropertyNames,
    }
    console.log({challengeAnswerPubsubMessage})

    // publish pubsub challenge answer message
    const challengeVerificationPubsubMessage = await publishPubsubMessage(subplebbitSigner.address, challengeAnswerPubsubMessage)
    console.log({challengeVerificationPubsubMessage})

    // validate challenge verification pubsub message
    expect(challengeVerificationPubsubMessage.type).to.equal('CHALLENGEVERIFICATION')
    // no point in sending back encrypted comment edit in verification
    expect(challengeVerificationPubsubMessage.encryptedPublication).to.equal(undefined)
    expect(challengeVerificationPubsubMessage.challengeSuccess).to.equal(true)
    expect(challengeVerificationPubsubMessage.challengeRequestId).to.equal(challengeAnswerPubsubMessage.challengeRequestId)
    expect(challengeVerificationPubsubMessage.challengeAnswerId).to.equal(challengeAnswerPubsubMessage.challengeAnswerId)

    // validate challenge verification pubsub message subplebbit owner signature
    expect(challengeVerificationPubsubMessage.signature.type).to.equal('ed25519')
    expect(challengeVerificationPubsubMessage.signature.publicKey).to.equal(subplebbitSigner.publicKey)
    expect(challengeVerificationPubsubMessage.signature.signedPropertyNames).to.include.members([
      'type',
      'timestamp',
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

    // fetch comment ipns
    const commentIpfs = await fetchJson(`${ipfsGatewayUrl}/ipfs/${publishedCommentCid}`)
    let commentIpns
    // wait until latest author edit is published (multiple tests use the same comment)
    while (!commentIpns?.edit || commentIpns.edit.timestamp !== commentEdit.timestamp) {
      commentIpns = await fetchJson(`${ipfsGatewayUrl}/ipns/${commentIpfs.ipnsName}`)
    }
    console.log({commentIpns})

    // validate author edit
    expect(commentIpns.edit.author).to.deep.equal(commentEdit.author)
    expect(commentIpns.edit.commentCid).to.equal(commentEdit.commentCid)
    expect(commentIpns.edit.reason).to.equal(commentEdit.reason)
    expect(commentIpns.edit.timestamp).to.equal(commentEdit.timestamp)
    expect(commentIpns.edit.subplebbitAddress).to.equal(commentEdit.subplebbitAddress)
    expect(commentIpns.edit.signature).to.deep.equal(commentEdit.signature)

    // validate author edit signature
    expect(commentIpns.edit.signature.type).to.equal('ed25519')
    expect(commentIpns.edit.signature.publicKey).to.equal(authorSigner.publicKey)
    expect(commentIpns.edit.signature.signedPropertyNames).to.include.members([
      'subplebbitAddress',
      'author',
      'timestamp',
      'commentCid',
      'content',
      'deleted',
      'flair',
      'spoiler',
      'reason',
      'pinned',
      'locked',
      'removed',
      'commentAuthor',
    ])
    expect(
      await verify({
        objectToSign: commentIpns.edit,
        signedPropertyNames: commentIpns.edit.signature.signedPropertyNames,
        signature: commentIpns.edit.signature.signature,
        publicKey: authorSigner.publicKey,
      })
    ).to.equal(true)
  })

  // TODO: it('subplebbit edit and publish over pubsub', async () => {})
})

const getBufferToSign = (objectToSign, signedPropertyNames) => {
  const propsToSign = {}
  for (const propertyName of signedPropertyNames) {
    if (objectToSign[propertyName] !== null && objectToSign[propertyName] !== undefined) {
      propsToSign[propertyName] = objectToSign[propertyName]
    }
  }
  // console.log({propsToSign})
  const bufferToSign = cborg.encode(propsToSign)
  return bufferToSign
}

const sign = async ({objectToSign, signedPropertyNames, privateKey}) => {
  const bufferToSign = getBufferToSign(objectToSign, signedPropertyNames)
  const signatureBuffer = await signBufferEd25519(bufferToSign, privateKey)
  const signatureBase64 = uint8ArrayToString(signatureBuffer, 'base64')
  return signatureBase64
}

const verify = async ({objectToSign, signedPropertyNames, signature, publicKey}) => {
  const bufferToSign = getBufferToSign(objectToSign, signedPropertyNames)
  const signatureAsBuffer = uint8ArrayFromString(signature, 'base64')
  const res = await verifyBufferEd25519(bufferToSign, signatureAsBuffer, publicKey)
  return res
}

const publishPubsubMessage = async (pubsubTopic, messageObject) => {
  let onMessageReceived
  messageReceivedPromise = new Promise((resolve) => {
    onMessageReceived = async (rawMessageReceived) => {
      const messageReceivedString = uint8ArrayToString(rawMessageReceived.data)
      // console.log('message received', messageReceivedString)
      const messageReceivedObject = JSON.parse(messageReceivedString)

      // not the message we're looking for
      if (messageObject.challengeRequestId !== messageReceivedObject.challengeRequestId) {
        return
      }

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
      cache: 'no-cache',
    }).then(async (res) => {
      const text = await res.text()
      try {
        const json = JSON.parse(text)
        return json
      } catch (e) {
        e.message += `: fetch response status '${res.status}' body '${text}'`
        throw e
      }
    })

  // retry because ipns takes some time to load
  let maxRetries = 20
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
