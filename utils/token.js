const { TokenCreateTransaction, TokenType } = require('@hashgraph/sdk');

/**
 * Initialize a platform token for the DeSci platform
 * @param {Object} client - Hedera client
 * @param {string} name - Token name
 * @param {string} symbol - Token symbol
 * @param {number} initialSupply - Initial token supply
 * @returns {Promise<string>} - Token ID
 */
const initializePlatformToken = async (client, name, symbol, initialSupply) => {
  try {
    console.log(`Creating platform token: ${name} (${symbol})`);
    
    // Create token transaction
    const transaction = new TokenCreateTransaction()
      .setTokenName(name)
      .setTokenSymbol(symbol)
      .setDecimals(2)
      .setInitialSupply(initialSupply)
      .setTreasuryAccountId(client.operatorAccountId)
      .setAdminKey(client.operatorPublicKey)
      .setSupplyKey(client.operatorPublicKey)
      .setFreezeKey(client.operatorPublicKey)
      .setWipeKey(client.operatorPublicKey)
      .setMaxTransactionFee(100);
      
    // Submit transaction and get receipt
    const submitTx = await transaction.execute(client);
    const receipt = await submitTx.getReceipt(client);
    
    // Return token ID
    return receipt.tokenId.toString();
  } catch (error) {
    console.error(`Error creating platform token: ${error.message}`);
    throw error;
  }
};

module.exports = {
  initializePlatformToken
};
