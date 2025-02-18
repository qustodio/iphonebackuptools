const bt = require('../tools/index')
const env = require('dotenv')
const { join } = require('path')
const log = require('../tools/util/log')

const unixTSFromToday = () => {
  const currentDate = new Date()
  const startOfDay = new Date(currentDate)
  startOfDay.setHours(0, 0, 0, 0)
  const unixTimestampStartOfDay = Math.floor(startOfDay.getTime() / 1000)
  return unixTimestampStartOfDay
}

const main = async ({ BACKUP_PATH, APPLE_UDID, PASSWORD_BACKUP }) => {
  log.setVerbose(2)

  await bt.configure({
    base: BACKUP_PATH,
    id: APPLE_UDID,
    password: PASSWORD_BACKUP
  })

  const [report, messages, calls, addressBook, whatsappMessages, lineMessages] = await Promise.all([
    bt.run('backups.list', {}),
    bt.run('messages.all', { backup: APPLE_UDID }),
    bt.run('phone.calls', { backup: APPLE_UDID }),
    bt.run('phone.address_book', { backup: APPLE_UDID }),
    bt.run('messages.whatsapp', { backup: APPLE_UDID, fromUnixTimestamp: unixTSFromToday() }),
    bt.run('messages.line', { backup: APPLE_UDID, fromUnixTimestamp: unixTSFromToday() })
  ])

  console.log(JSON.stringify({ report, messages, calls, addressBook, whatsappMessages, lineMessages }, null, 2))
}

env.config({ path: join(__dirname, '.env') })

main({
  BACKUP_PATH: process.env.BACKUPS_PATH,
  APPLE_UDID: process.env.APPLE_UDID,
  PASSWORD_BACKUP: process.env.BACKUP_PASSWORD
})
