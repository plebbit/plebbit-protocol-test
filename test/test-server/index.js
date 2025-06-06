// script to start IPFS and plebbit-js for testing

;(await import('util')).inspect.defaultOptions.depth = null
import Plebbit from '@plebbit/plebbit-js'
import {directory as getTmpFolderPath} from 'tempy'
import {startIpfs} from './start-ipfs.js'
import {offlineIpfs, pubsubIpfs} from './ipfs-config.js'
import signers from '../fixtures/signers.js'
import {ipfsKeyImport} from '../utils/ipfs.js'
import http from 'http'

// always use the same private key and subplebbit address when testing
const privateKey = signers[0].privateKey
const plebbitDataPath = getTmpFolderPath()

// set up a subplebbit for testing
;(async () => {
  await startIpfs(offlineIpfs)
  await startIpfs(pubsubIpfs)

  const plebbitOptions = {
    kuboRpcClientsOptions: [`http://localhost:${offlineIpfs.apiPort}/api/v0`],
    pubsubKuboRpcClientsOptions: [`http://localhost:${pubsubIpfs.apiPort}/api/v0`],
    httpRoutersOptions: [],
    // pubsubHttpClientOptions: `https://pubsubprovider.xyz/api/v0`,
    dataPath: plebbitDataPath,
    publishInterval: 1000,
    updateInterval: 1000,
  }

  // import all keys to ipfs here because the import key api is buggy
  for (const signer of signers) {
    await ipfsKeyImport({
      // use the signer address as the key name to use in the tests
      keyName: signer.address,
      privateKey: signer.privateKey,
      ipfsHttpUrl: plebbitOptions.kuboRpcClientsOptions[0],
    })
  }

  const plebbit = await Plebbit(plebbitOptions)
  plebbit.on('error', console.log)
  const remotePlebbit = await Plebbit({...plebbitOptions, dataPath: undefined})
  remotePlebbit.on('error', console.log)
  const signer = await plebbit.createSigner({privateKey, type: 'ed25519'})

  console.log(`creating subplebbit with address '${signer.address}'...`)
  const subplebbit = await plebbit.createSubplebbit({
    signer,
    title: 'subplebbit title',
  })
  subplebbit.on('challengerequest', console.log)
  subplebbit.on('challengeanswer', console.log)
  await subplebbit.edit({settings: {challenges: [{name: 'question', options: {question: '1+1=?', answer: '2'}}]}})
  console.log('subplebbit created')

  console.log('starting subplebbit...')
  await subplebbit.start()
  subplebbit.once('update', async () => {
    console.log(`subplebbit started with address ${signer.address}`)

    console.log('publish test comment')
    const comment = await remotePlebbit.createComment({
      title: 'comment title',
      content: 'comment content',
      subplebbitAddress: signer.address,
      signer,
      author: {address: signer.address},
    })
    comment.once('challenge', () => comment.publishChallengeAnswers(['2']))

    // uncomment to log an example of comment update
    // comment.once('challengeverification', async (challengeVerification) => {
    //   const commentCid = challengeVerification.publication.cid
    //   console.log({commentCid})
    //   const comment = await plebbit.getComment(commentCid)
    //   console.log({comment})
    //   comment.on('update', console.log)
    //   comment.update()
    // })

    await comment.publish()
    console.log('test comment published')
    console.log('test server ready')

    // create a test server to be able to use npm module 'wait-on'
    // to know when the test server is finished getting ready
    // and able to start the automated tests
    http
      .createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end('test server ready')
      })
      .listen(59281)
  })
})()
