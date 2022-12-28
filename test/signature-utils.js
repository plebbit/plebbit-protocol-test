const {getKeyPairFromPrivateKeyPem} = require("./crypto-utils")

const isProbablyBuffer = (arg) => arg && typeof arg !== "string" && typeof arg !== "number";

const signBufferRsa = async (bufferToSign, privateKeyPem, privateKeyPemPassword = "") => {
  if (!isProbablyBuffer(bufferToSign)) throw Error(`signBufferRsa invalid bufferToSign '${bufferToSign}' not buffer`);
  const keyPair = await getKeyPairFromPrivateKeyPem(privateKeyPem, privateKeyPemPassword);
  // do not use libp2p keyPair.sign to sign strings, it doesn't encode properly in the browser
  return await keyPair.sign(bufferToSign);
};

module.exports = {signBufferRsa}
