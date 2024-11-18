/* eslint-disable camelcase */
const sqlite3 = require('sqlite3').verbose()
const Backup = require('../tools/backup-encrypted')
const { join } = require('path')
const backupFilehash = require('../tools/util/backup_filehash')
const env = require('dotenv')
const { queryAll } = require('../tools/util/query')
const { parallel } = require('../tools/util/async')

/*
This script is used to analyze the different databases found in each file.
*/

const serialize = (db, fn) => db.serialize(() => { fn() })

const getTables = async (db) => {
  const tables = await queryAll({
    sql: "SELECT name FROM sqlite_master WHERE type='table';",
    database: db
  })

  return tables.map(table => table.name)
}

const getTablesDefinition = async (db, tables) => {
  return parallel(async (table) => {
    const numRows = await queryAll({
      sql: `SELECT count(*) as length FROM "${table}";`,
      database: db
    })

    const columns = await queryAll({
      sql: `PRAGMA table_info("${table}");`,
      database: db
    })

    return {
      table,
      length: numRows[0].length,
      columns: columns.map(column => column.name) }
  }, tables)
}

const showTablesContent = async (db, definitions) => {
  const data = await parallel(async ({ table }) => {
    const rows = await queryAll({
      sql: `SELECT * FROM "${table}";`,
      database: db
    })

    return { rows, table }
  }, definitions)

  data
    .filter(data => data.rows.length > 0)
    .forEach(results => {
      console.group(`------------------------------${results.table}----------------`)
      console.log(results.rows)
      console.groupEnd()
    })
}

const inspectDatabase = (file) => {
  const db = new sqlite3.Database(file)

  return serialize(db, async () => {
    const tables = await getTables(db)
    const definition = await getTablesDefinition(db, tables)
    console.log(definition)
    await showTablesContent(db, definition)
  })
}

const getDatabaseFiles = async ({ backup, backupsPath, appleUdid }) => {
  const deviceBackupDir = join(backupsPath, appleUdid)
  const decryptedManifestFile = join(deviceBackupDir, 'Manifest.db-un')

  await backup.load() // create Manifest.db-un

  const filesDB = new sqlite3.Database(decryptedManifestFile)

  const files = await queryAll({
    sql: `SELECT * FROM "FILES";`,
    database: filesDB
  }).then(files => files.map(({ fileID, domain, relativePath, flags }) => ({ fileID, domain, relativePath, flags })))
  return files
}

const inspectDB = async ({ domain, file, backupsPath, appleUdid, backupPassword }) => {
  const backup = new Backup(backupsPath, appleUdid, backupPassword)
  const files = await getDatabaseFiles({ backup, backupsPath, appleUdid })

  console.log('Files to get Data')
  console.log(files)

  const dbFileIDInDatabase = backupFilehash(file, domain)
  const decryptedDBFile = await backup.getDatabaseDecryptedFile(dbFileIDInDatabase)
  inspectDatabase(decryptedDBFile)
}

env.config({ path: join(__dirname, '.env') })

inspectDB({
  domain: process.env.DOMAIN,
  file: process.env.FILE,
  backupsPath: process.env.BACKUPS_PATH,
  appleUdid: process.env.APPLE_UDID,
  backupPassword: process.env.BACKUP_PASSWORD
})
