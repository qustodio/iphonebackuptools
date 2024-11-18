const fileHash = require('../../util/backup_filehash')
const appleTimestamp = require('../../util/apple_timestamp')
const { queryAll } = require('../../util/query')
const { parallel } = require('../../util/async')

const WHATSAPP_DB = fileHash(
  'ChatStorage.sqlite',
  'AppDomainGroup-group.net.whatsapp.WhatsApp.shared'
)

module.exports = {
  version: 4,
  name: 'messages.whatsapp',
  description: `List WhatsApp messages`,
  requiresBackup: true,

  async run (lib, { backup }) {
    const database = await backup.openDatabase(WHATSAPP_DB)

    const whatsappTextMessages = await getWhatsappTextMessages(database)

    return parallel(
      (row) => includesParticipants(database, row),
      whatsappTextMessages
    )
  },

  output: {
    id: (row) => row.Z_PK,
    type: (row) => getType(row),
    chatID: (row) => row.ZCHATSESSION,
    content: (row) => row.ZTEXT,
    sender: (row) => row.ZFROMJID, // If it's null, it means it's the phone's owner
    receiver: (row) => row.ZTOJID, // If it's null, it means it's the phone's owner
    timestamp: (row) => appleTimestamp.toUnixTimeStamp(row.ZMESSAGEDATE),
    interlocutor: (row) => row.ZPARTNERNAME, // The other group or person the device is talking to
    interlocutorAlias: (row) => row.PROFILE_PUSHNAME, // The other group or person's alias
    participants: (row) => row.PARTICIPANTS.map((participant) => ({
      chatID: participant.ZCHATSESSION,
      interlocutor: participant.ZPARTNERNAME,
      interlocutorAlias: participant.ZPUSHNAME,
      participantID: participant.ZMEMBERJID,
      isSender: row.ZMEMBERJID === participant.ZMEMBERJID
    }))
  }
}

const getType = (el) => (el.PROFILE_PUSHNAME === null ? 'GROUP' : 'DIRECT')

const isTypeGroup = (el) => getType(el) === 'GROUP'

const getWhatsappTextMessages = (database) => {
  return queryAll({
    database,
    sql: `
      SELECT
          ZWACHATSESSION.Z_PK AS Z_PK,
          ZWAMESSAGE.ZCHATSESSION AS ZCHATSESSION,
          ZWAMESSAGE.ZTEXT AS ZTEXT,
          ZWACHATSESSION.ZCONTACTIDENTIFIER AS ZCONTACTIDENTIFIER, -- Referencia desde ZWACHATSESSION
          ZWACHATSESSION.ZPARTNERNAME AS ZPARTNERNAME,
          ZWAMESSAGE.ZFROMJID AS ZFROMJID,
          ZWAMESSAGE.ZTOJID AS ZTOJID,
          ZWAMESSAGE.ZMESSAGEDATE AS ZMESSAGEDATE,
          ZWAMESSAGE.ZGROUPMEMBER AS ZGROUPMEMBER,
          ZWAPROFILEPUSHNAME.ZJID AS PROFILE_JID,
          ZWAPROFILEPUSHNAME.ZPUSHNAME AS PROFILE_PUSHNAME,
          ZWAGROUPMEMBER.ZMEMBERJID AS ZMEMBERJID
      FROM
          ZWACHATSESSION
      INNER JOIN
          ZWAMESSAGE
      ON
          ZWACHATSESSION.Z_PK = ZWAMESSAGE.ZCHATSESSION
      LEFT JOIN
          ZWAPROFILEPUSHNAME
      ON
          ZWAPROFILEPUSHNAME.ZJID = ZWAMESSAGE.ZFROMJID
          OR ZWAPROFILEPUSHNAME.ZJID = ZWAMESSAGE.ZTOJID
      LEFT JOIN
          ZWAGROUPMEMBER
      ON
          ZWAGROUPMEMBER.Z_PK = ZWAMESSAGE.ZGROUPMEMBER 
      WHERE
          ZWAMESSAGE.ZMESSAGETYPE = 0;`
  })
}

const includesParticipants = async (database, row) => {
  if (!isTypeGroup(row)) return { ...row, PARTICIPANTS: [] }

  return {
    ...row,
    PARTICIPANTS: await queryAll({
      database,
      sql: `
        SELECT DISTINCT
          ZWAGROUPMEMBER.ZCHATSESSION,
          ZWAGROUPMEMBER.ZMEMBERJID,
          ZWACHATSESSION.ZPARTNERNAME,
          ZWAPROFILEPUSHNAME.ZPUSHNAME
        FROM 
          ZWAGROUPMEMBER
        INNER JOIN 
          ZWACHATSESSION
        ON 
          ZWAGROUPMEMBER.ZMEMBERJID = ZWACHATSESSION.ZCONTACTJID
        INNER JOIN 
          ZWAPROFILEPUSHNAME
        ON 
          ZWAGROUPMEMBER.ZMEMBERJID = ZWAPROFILEPUSHNAME.ZJID
        WHERE 
          ZWAGROUPMEMBER.ZCHATSESSION = ${row.ZCHATSESSION};
      `
    })
  }
}
