const dotenv = require('dotenv')
const getClient = require('./utils/client')
const { TopicCreateTransaction, CustomFixedFee, Client, TopicMessageSubmitTransaction } = require('@hashgraph/sdk')
const { createMockUSDC, transferTokens } = require('./utils/token')
const createAccount = require('./utils/account')
const { getUserInput, closeReadline } = require('./utils/message')
dotenv.config()

const main = async () => {
  console.log('Initializing Hedera client...')
  const client = await getClient()

  console.log('Creating new account for fee payer...')
  const newAccount = await createAccount(client)
  console.log(`Created new fee payer account with ID: ${newAccount.accountId}`)

  console.log('Creating mock USDC token...')
  const mockUSDC = await createMockUSDC(client)
  console.log(`Mock USDC token created with ID: ${mockUSDC}`)

  // Transfer some tokens to the fee payer account
  console.log('Transferring tokens to fee payer account...')
  await transferTokens(client, mockUSDC, client.operatorAccountId, newAccount.accountId, 100)
  console.log('Transferred 100 tokens to fee payer account')

  console.log('Setting up custom fee configuration...')
  const customFee = new CustomFixedFee()
    .setDenominatingTokenId(mockUSDC)
    .setAmount(5)
    .setFeeCollectorAccountId(client.operatorAccountId)
  console.log(`Custom fee configured: 5 ${mockUSDC} tokens per message`)

  console.log('Creating new topic with custom fee...')
  const topicCreateTx = new TopicCreateTransaction()
    .setCustomFees([customFee])

  const executeTopicCreateTx = await topicCreateTx.execute(client)
  const topicCreateReceipt = await executeTopicCreateTx.getReceipt(client)
  const topicId = topicCreateReceipt.topicId
  console.log(`Topic created successfully with ID: ${topicId}`)

  console.log('\nMessage submission loop started. Type "exit" to quit.')
  console.log('----------------------------------------')

  while (true) {
    const message = await getUserInput('Enter your message (or "exit" to quit): ')

    if (message.toLowerCase() === 'exit') {
      console.log('Exiting message submission loop...')
      break
    }

    if (message.trim() === '') {
      console.log('Message cannot be empty. Please try again.')
      continue
    }

    try {
      const submitMessageTx = new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(message)
      const newClient = Client.forTestnet().setOperator(newAccount.accountId, newAccount.privateKey)
      const executeSubmitMessageTx = await submitMessageTx.execute(newClient)
      const submitMessageReceipt = await executeSubmitMessageTx.getReceipt(newClient)
      console.log(`Message "${message}" submitted successfully to topic`)
      console.log(`Transaction status: ${submitMessageReceipt.status}`)
    } catch (error) {
      console.error('Error submitting message:', error.message)
    }
  }

  // Close the readline interface
  closeReadline()
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })

  // Test