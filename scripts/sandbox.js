const bt = require('../tools/index')
const env = require('dotenv')
const { join } = require('path')

const main = async ({ BACKUP_PATH, APPLE_UDID, PASSWORD_BACKUP }) => {
  await bt.configure({
    base: BACKUP_PATH,
    id: APPLE_UDID,
    password: PASSWORD_BACKUP
  })

  const [report, messages, calls, addressBook, whatsappMessages] = await Promise.all([
    bt.run('backups.list', {}),
    bt.run('messages.all', { backup: APPLE_UDID }),
    bt.run('phone.calls', { backup: APPLE_UDID }),
    bt.run('phone.address_book', { backup: APPLE_UDID }),
    bt.run('messages.whatsapp', { backup: APPLE_UDID })
  ])

  console.log(JSON.stringify({ report, messages, calls, addressBook, whatsappMessages }, null, 2))
}

env.config({ path: join(__dirname, '.env') })

main({
  BACKUP_PATH: process.env.BACKUPS_PATH,
  APPLE_UDID: process.env.APPLE_UDID,
  PASSWORD_BACKUP: process.env.BACKUP_PASSWORD
})
