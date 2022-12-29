const {getKeyPairFromPrivateKeyPem, getPeerIdFromPublicKeyPem} = require("./crypto-utils")

const isProbablyBuffer = (arg) => arg && typeof arg !== "string" && typeof arg !== "number";

const signBufferRsa = async (bufferToSign, privateKeyPem, privateKeyPemPassword = "") => {
  if (!isProbablyBuffer(bufferToSign)) throw Error(`signBufferRsa invalid bufferToSign '${bufferToSign}' not buffer`);
  const keyPair = await getKeyPairFromPrivateKeyPem(privateKeyPem, privateKeyPemPassword);
  // do not use libp2p keyPair.sign to sign strings, it doesn't encode properly in the browser
  return await keyPair.sign(bufferToSign);
};

const verifyBufferRsa = async (bufferToSign, bufferSignature, publicKeyPem) => {
  if (!isProbablyBuffer(bufferToSign)) throw Error(`verifyBufferRsa invalid bufferSignature '${bufferToSign}' not buffer`);
  if (!isProbablyBuffer(bufferSignature)) throw Error(`verifyBufferRsa invalid bufferSignature '${bufferSignature}' not buffer`);
  const peerId = await getPeerIdFromPublicKeyPem(publicKeyPem);
  return await peerId.pubKey.verify(bufferToSign, bufferSignature);
};

module.exports = {signBufferRsa, verifyBufferRsa}
