const { secondsToMs, msToSeconds } = require('../../util/time')
const { queryAll, queryOne } = require("../../util/query");
const { parallel, fork } = require("../../util/async");
const {
  toIdentityMap,
  uniqueBy,
  mapObj,
  indexedMapBy,
  groupBy,
  memoize,
} = require("../../util/data");

/*
Relationship Between Messages and Groups in the Database
To understand how messages are linked to group information, it is essential to analyze the structure of the tables and their relationships.

1. ZMESSAGE Table
This table stores messages, and its most relevant attributes are:

ZCHAT: Identifier of the chat where the message was sent. It relates to the ZCHAT table, which determines whether it is an individual or group chat.
ZSENDER: Identifier of the user who sent the message. It links to the ZUSER table, which stores user information.
2. ZCHAT Table
This table contains information about chats. Its key fields include:

ZTYPE: Indicates the type of chat:
ZTYPE = 2: Group chat.
ZTYPE = 0: Private chat (between two users).
ZMID: Chat identifier that links to the dynamic table ZUNIFIEDGROUP through the ZID field. This field is only filled if the chat is a group.
Z_PK: Primary identifier of the chat, used to link with other dynamic tables.
3. ZUNIFIEDGROUP Table
Stores specific information about groups. Its key fields are:

Z_PK: Primary identifier of the group.
ZID: Unique identifier of the group.
ZNAME: Name of the group.
Other details related to group settings.
4. ZUNIFIEDGROUPUSER Table
Links users to groups. Its main columns include:

Z_1GROUPS: Group identifier.
Z_2MEMBERCHATUSERS: Identifier of the user who is a group member.
5. Process to Link Messages with Groups and Users
1. Linking the Message to the Chat
The ZMESSAGE table has the ZCHAT column, which points to the chat where the message was sent.

2. Verifying the Type of Chat
Query ZCHAT to determine if it is a private or group chat:

If ZTYPE = 1, the chat is a group.
If ZTYPE = 0, the chat is private.
3. Retrieving Group Information
If the chat is a group, a JOIN is performed between ZCHAT and ZUNIFIEDGROUP using ZCHAT.Z_PK = ZUNIFIEDGROUP.Z_PK.

4. Retrieving Group Members
To get the users belonging to the group, a JOIN is performed with ZUNIFIEDGROUPUSER, linking Z_1GROUPS with Z_2MEMBERCHATUSERS.

6. Relationship with Dynamic Tables
ZCHAT.Z_PK links with dynamic tables Z_<N>MEMBERUSERS through Z_<N>GROUPS.
These tables contain Z_<N>MEMBERCHATUSERS, which links to ZUSER.
Summary of the Process
To retrieve group messages, a JOIN is performed between ZMESSAGE and ZCHAT, filtering by ZTYPE = 1.
To obtain group information, ZUNIFIEDGROUP is queried.
To retrieve group members, ZUNIFIEDGROUPUSER is used.
*/

module.exports = {
  version: 4,
  name: "messages.line",
  description: `List Line messages`,
  requiresBackup: true,

  async run(lib, { backup, fromUnixTimestamp }) {
    /*
    IMPORTANT: Line database is not structured like other messaging providers.
    Line generates the names of the files dynamically, meaning that it adds a unique
    identifier to the file path. This requires inferring the information from the database
    instead of calculating the hash using the domain and relative path,
    unlike other services like WhatsApp. This is why support has been added to the decryptor class,
    so that not only the file's hash can be passed, but also a function that can infer it.

    Important: The LINE database stores timestamps in milliseconds, 
    but externally the API should expose them in seconds.
    */
    const [messagesDatabase, usersGroupDatabase] = await fork(
      backup.openDatabase(inferMessagesFileHash),
      backup.openDatabase(inferGroupsFileHash)
    );

    const [messages, users, groupChatIds] = await fork(
      findMessages(messagesDatabase, { fromUnixTimestamp }),
      findUsers(messagesDatabase),
      findGroupChatExternalIds(messagesDatabase).then(toIdentityMap)
    );

    const usersByChat = await parallel(
      (chatExternalId) =>
        findUsersByChat({ usersGroupDatabase, chatExternalId }),
      groupChatIds
    );

    const formattedMessages = format({
      database: messagesDatabase,
      messages,
      users,
      usersByChat,
    });

    return formattedMessages;
  },

  output: {
    id: (row) => row.MessageId,
    type: (row) => row.ChatType,
    chatID: (row) => row.ChatID,
    content: (row) => row.MessageText,
    sender: (row) => row.SenderName, // If it's null, it means it's the phone's owner
    receiver: (row) => row.ReceiverName, // If it's null, it means it's the phone's owner
    timestamp: (row) => row.UnixMessageTimestamp,
    interlocutor: (row) => null, // The other group or person the device is talking to
    interlocutorAlias: (row) => null, // The other group or person's alias
    participants: (row) => {
      return row.Participants.map((participant) => {
        return {
          chatID: row.ChatID,
          interlocutor: participant.UserName,
          interlocutorAlias: participant.UserName,
          participantID: participant.UserId,
          isSender: row.SenderName === participant.UserName,
        };
      });
    },
  },
};

const MESSAGE_TYPE_TEXT = 0;
const CHAT_TYPE_DIRECT_MESSAGE = 0;
const CHAT_TYPE_GROUP_MESSAGE = 2;

const inferMessagesFileHash = async (doQuery) => {
  const quey =
    'SELECT fileID FROM FILES WHERE domain= "AppDomainGroup-group.com.linecorp.line" AND relativePath LIKE "Library/Application Support/PrivateStore/P_%/Messages/Line.sqlite";';
  try {
    const { fileID } = await doQuery(quey);
    return fileID;
  } catch (e) {
    throw new Error(`Impossible to infer filID with query ${quey}`);
  }
};

const inferGroupsFileHash = async (doQuery) => {
  const quey =
    'SELECT fileID FROM FILES WHERE domain= "AppDomainGroup-group.com.linecorp.line" AND relativePath LIKE  "Library/Application Support/PrivateStore/P_%/Messages/UnifiedGroup.sqlite";';
  try {
    const { fileID } = await doQuery(quey);
    return fileID;
  } catch (e) {
    throw new Error(`Impossible to infer filID with query ${quey}`);
  }
};

const findMessages = (database, { fromUnixTimestamp }) => {
  const sql = `
    SELECT
      ZTEXT AS MessageText,
      ZSENDER AS SenderID,
      ZUSER.ZNAME AS SenderName,
      ZMESSAGE.ZCONTENTTYPE AS MessageType,
      ZCHAT.Z_PK AS ChatID,
      ZTIMESTAMP AS MessageTimestamp,
      ZID AS MessageId,
      ZUSER.ZMID AS UserExternlId,
      ZCHAT.ZMID AS ChatExternalId,
      ZCHAT.ZTYPE AS ChatType
    FROM
      ZMESSAGE
    LEFT JOIN 
      ZUSER 
      ON ZUSER.Z_PK = ZMESSAGE.ZSENDER
    LEFT JOIN 
      ZCHAT 
      ON ZCHAT.Z_PK = ZMESSAGE.ZCHAT
    WHERE
      ZMESSAGE.ZCONTENTTYPE = ${MESSAGE_TYPE_TEXT}
      AND ZCHAT.ZTYPE IN (${CHAT_TYPE_DIRECT_MESSAGE}, ${CHAT_TYPE_GROUP_MESSAGE})
      ${
        fromUnixTimestamp
          ? `AND ZMESSAGE.ZTIMESTAMP > ${secondsToMs(fromUnixTimestamp)}`
          : ""
      }
    ORDER BY
      ZMESSAGE.ZTIMESTAMP ASC;
  `

  return queryAll({
    database,
    sql,
  });
};

const findUsers = (database) => {
  return queryAll({
    database: database,
    sql: `SELECT  Z_PK as UserId, ZNAME as UserName FROM ZUSER;`,
  });
};

const findGroupChatExternalIds = async (database) => {
  const groupChats = await queryAll({
    database: database,
    sql: `
    SELECT  
      ZMID as chatExternalId, ZTYPE as ChatType 
    FROM
      ZCHAT 
    WHERE
      ZTYPE = ${CHAT_TYPE_GROUP_MESSAGE};
  `,
  });

  return groupChats.map((chat) => chat.chatExternalId);
};

/**
 * Find the receiver of the messages using a reflexive relationship. 
 * This case is useful when the other person starts the conversation.
 */
const findChatReceiver = memoize(
  ({ chatId }) => chatId,
  ({ database, chatId }) => {
    return queryOne({
      database: database,
      sql: `
      SELECT DISTINCT
        ZUSER.ZNAME AS SenderName,
        ZUSER.ZMID AS UserExternalId
      FROM
          ZMESSAGE
      LEFT JOIN 
          ZUSER 
          ON ZUSER.Z_PK = ZMESSAGE.ZSENDER
      LEFT JOIN 
          ZCHAT 
          ON ZCHAT.Z_PK = ZMESSAGE.ZCHAT
      WHERE 
          ZCHAT.Z_PK = ${chatId} 
          AND ZMESSAGE.ZSENDER IS NOT NULL;`
    })
  }
)

/**
 * Find the recipient of a message in direct messages; 
 * in this case, it is used when the conversation 
 * is started by someone other than the user or the device.
 */
const findMemberReceiver = memoize(
  ({ chatId }) => chatId,
  async ({ database, chatId }) => {
    const membersTableNames = await queryAll({
      database,
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'z_%members';`
    })

    const membersByTables = await parallel(
      async (table) => {
        const tableName = table?.name

        if(!tableName) return []

        const columns = await queryAll({
          database,
          sql: `PRAGMA table_info(${tableName});`,
        });

        const chatIdColum = columns.find(column => column?.name?.includes("CHATS"))?.name
        const userIdColum = columns.find(column => column?.name?.includes("MEMBERS"))?.name

        if(!chatIdColum || !userIdColum) return []

        return queryAll({
          database,
          sql: `
          SELECT 
            m.${chatIdColum} AS ChatId, 
            m.${userIdColum} AS ReceiverId, 
            u.zname AS ReceiverName 
          FROM 
            ${tableName} m
          JOIN 
            ZUSER u 
          ON 
            m.${userIdColum} = u.Z_PK
          WHERE 
            m.${chatIdColum} = ${chatId};
          `
        });

      }, membersTableNames
    )

    const receiver = membersByTables.flat().find(receiver => receiver.ChatId === chatId);
    return receiver
  }
)

const findUsersByChat = async ({ usersGroupDatabase, chatExternalId }) => {
  /*
  In Line, the information about groups and messages is fragmented across two different databases,
  which is why it is necessary to infer the relationship between
  the data through programming. Additionally, the problem with group databases is that they
  generate dynamic tables to create the groups. These tables add a numeric suffix,
  and it is necessary to infer the column names in order to retrieve them.
  It is very important to note that the database does not add the same user as part of a group.
  */
  const tables = await queryAll({
    database: usersGroupDatabase,
    sql: `SELECT name FROM sqlite_master WHERE type = 'table';`,
  });

  const membersChatUSersTables = tables
    .map(({ name }) => name)
    .filter((tabla) => tabla.endsWith("MEMBERCHATUSERS"));

  const members = await parallel(async (table) => {
    const columns = await queryAll({
      database: usersGroupDatabase,
      sql: `PRAGMA table_info(${table});`,
    });

    const groupsPkName = columns.find((column) =>
      column.name.endsWith("GROUPS")
    )?.name;
    const memberChatUsersPkName = columns.find((column) =>
      column.name.endsWith("MEMBERCHATUSERS")
    )?.name;

    return queryAll({
      database: usersGroupDatabase,
      sql: `
      SELECT
          ZUNIFIEDGROUP.ZNAME AS GroupName,
          ${table}.${memberChatUsersPkName} AS UserId,
          ZUNIFIEDGROUP.ZID AS ChatExternalId
      FROM
          ZUNIFIEDGROUP
      JOIN
          ${table}
          ON ZUNIFIEDGROUP.Z_PK = ${table}.${groupsPkName}
      WHERE
          ZUNIFIEDGROUP.ZID = '${chatExternalId}';`,
    });
  }, membersChatUSersTables);

  return uniqueBy((member) => member.UserId, members.flat());
};

const format = async ({ database, messages, users, usersByChat }) => {
  const normalizedUsersById = indexedMapBy((user) => user.UserId, users);

  const usersByChatGroup = mapObj(
    (users) =>
      users.map((user) => ({
        ...user,
        ...normalizedUsersById[user.UserId],
      })),
    usersByChat
  );

  return parallel(async (message) => {
    const isChatGroupMessage = message.ChatType === CHAT_TYPE_GROUP_MESSAGE;
    const type = isChatGroupMessage ? "GROUP" : "DIRECT";
    const participants = isChatGroupMessage
      ? usersByChatGroup[message.ChatExternalId]
      : [];

    const ReceiverName = await getReceiverName({
      database,
      message,
      isChatGroupMessage,
      usersByChatGroup
    });

    return {
      ...message,
      ChatType: type,
      ReceiverName,
      UnixMessageTimestamp: msToSeconds(message.MessageTimestamp),
      Participants: participants,
    };
  }, messages);
};

/**
 * 
 * The case of obtaining the other person is somewhat complex because it has some very specific use cases. 
 * The first one is that if the person starts the conversation, 
 * it is stored in zmessages, meaning a reflexive relationship is used. 
 * In the case where the user is the one who starts the conversation, it is stored in dynamic tables called z_<N>MEMBER.
 * To obtain who the message was sent to in direct conversations,
 * 
 * This method will be called many times, 
 * which is why it is memoized.
 */
const getReceiverName = async ({
  database,
  message,
  isChatGroupMessage,
  usersByChatGroup
}) => {
  // ReceiverName is GroupName
  if (isChatGroupMessage) {
    const groupName = usersByChatGroup[message.ChatExternalId]?.[0]?.GroupName;
    return groupName;
  }

  // ReceiverName is Iphone User
  if (message.SenderName !== null) {
    return null;
  }

  // Receiver from chat (when receiver start conversation)
  const chatReceiver = await findChatReceiver({
    database, 
    chatId: message.ChatID
  })

  if(chatReceiver?.SenderName) {
    return chatReceiver?.SenderName
  }

  // Receiver from members (when phone user start conversation)
  const receiver = await findMemberReceiver({ 
    database, 
    chatId: message.ChatID 
  })

  if(receiver?.ReceiverName) {
    return receiver?.ReceiverName
  }

  return 'UNKNOWN'
  
};
