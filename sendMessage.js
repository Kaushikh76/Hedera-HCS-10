const dotenv = require('dotenv')
const getClient = require('./utils/client')
const { TopicMessageSubmitTransaction, Client } = require('@hashgraph/sdk')
const { getUserInput, closeReadline } = require('./utils/message')
dotenv.config()

const sendMessageToTopic = async (topicId) => {
  console.log('Initializing Hedera client...')
  const client = await getClient()

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
      
      const executeSubmitMessageTx = await submitMessageTx.execute(client)
      const submitMessageReceipt = await executeSubmitMessageTx.getReceipt(client)
      console.log(`Message "${message}" submitted successfully to topic`)
      console.log(`Transaction status: ${submitMessageReceipt.status}`)
    } catch (error) {
      console.error('Error submitting message:', error.message)
    }
  }

  // Close the readline interface
  closeReadline()
}

// Use the specific topic ID
const topicId = '0.0.5913602'
sendMessageToTopic(topicId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })