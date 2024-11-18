# Contributing

This project is designed to be able to support new kinds of reporting easily without modifying it's core. This project relies on contributions to make give it as many features as possible! If you're able to, 

## Pull requests
If you've built a new reporting type or added a feature, feel free to open a pull request, and request a review. This way, it's easier to review potential additions.

## Issues
If you're encountering an issue getting a report to work, it's possible that it has't been tested against the specific iOS version that created the backup. 

When adding an issue for a bug report, be sure to include the iOS version that causes it.

## Creating a Reporter

To facilitate the creation of reports, two commands are available:

1. **`inspect`**  
   This command allows you to investigate the contents of the database. It queries the `pragma` of the tables and displays all the data.

2. **`sandbox`**  
   This command enables you to test the reports. It simply executes the methods contained in this module to preview the available commands.

**Important:**  
Ensure that the `.env` file is correctly configured. You can refer to an example configuration in the `example.env` file.

**Understanding the Basics**

A **reporter** is a process that extracts data from an iPhone backup using **SQLite**. Here are the key steps and considerations for creating a reporter:

## Key Concepts
1. **Encrypted Manifest.db**: 
   - The backup's `Manifest.db` file is encrypted by default. 
   - This module handles decrypting the database to access its contents.

2. **Target Table - FILES**:
   - For creating a reporter, the primary focus is on the `FILES` table in the `Manifest.db`.

## Steps to Analyze the Backup

### 1. Install an SQLite Client
   - It is recommended to use a tool such as **DB Browser for SQLite** for inspecting the database.

### 2. Open the decrypted Database
   - Identify the backup directory.
   - Open SQL lite client.
   - Go to `File > Open Database` in the SQLite client.
   - Locate and select the `Manifest.db-un` file. 

`Note:` This file is created in the backup directory specified by the module. It will only be generated after running the module for the first time.

### 3. Query the `FILES` Table
   - Execute queries to inspect the contents of the `FILES` table.
   - Identify the specific file or files required for your reporter.

## Example Query
```sql
SELECT * FROM FILES;
```
The `FILES` table includes the following fields:

- **`fileID`**
- **`domain`**
- **`relativePath`**
- **`flags`**
- **`file`**

### Key Fields
The most critical fields for locating and decrypting a file are:

1. **`domain`**:
   - Specifies the app or system context where the file is used (e.g., WhatsApp messages, system settings, etc.).
   - Acts as part of the unique identifier for the file.

2. **`relativePath`**:
   - Represents the **path of the file** within the backup.
   - Combined with the `domain` field, it forms the **hash** used to identify and retrieve the file from the backup directory.

### Hash Creation
The combination of **`domain`** and **`relativePath`** generates the hash required to locate the physical file in the backup. This hash is used to decrypt the file and access its data.

By leveraging these fields, you can identify and process the specific files needed from the iPhone backup.

To obtain the database file (encrypted), simply use the method provided within the reports module.

```js
const fileHash = require('ibackuptool/tools/util/backup_filehash')

const WHATSAPP_DB = fileHash('ChatStorage.sqlite', 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared')
```

The decrypted file obtained is passed to the backup.openDatabase method, which decrypts the file and allows running queries on it. If the structure of the target table is unknown, it is recommended to log the decrypted file's path and explore it using an SQL client.

To find the name of the decrypted file, it is recommended to check the log message:

`The database is located in the file: FILE`

This log message can be found in the tools/backup-encrypted.js file, which will provide the path to the decrypted file.

```js
// In some reporter implementation
const fileHash = require('ibackuptool/tools/util/backup_filehash')
const log = require('ibackuptool/tools/util/log')

const WHATSAPP_DB = fileHash('ChatStorage.sqlite', 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared')
                     
module.exports = {
  run (lib, { backup }) {
    return backup.openDatabase(WHATSAPP_DB).then(db => db.all('SELECT A, B, C FROM TABLE'))
  },
}
```

## Reporter creation

### 1. Define Reporter
Once you've identified the table and columns that interest you, simply create the reporter in the corresponding category in folder `tools/reports` within the appropriate folder. This allows you to organize the reporter based on the data it will analyze, making the structure more manageable and easier to maintain. Ensure that the reporter is placed in the correct category to adhere to the project's organization conventions.

In this example, we are going to create a reporter for WhatsApp. To do so, follow these steps:

1. Create the file tools/reports/messages/whatsapp.js
2. Adds the reporter template:


```js
const fileHash = require('ibackuptool/tools/util/backup_filehash')
const log = require('ibackuptool/tools/util/log')
const appleTimestamp = require('ibackuptool/tools/util/apple_timestamp')

const WHATSAPP_DB = fileHash('ChatStorage.sqlite', 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared')

module.exports = {
  version: 4,
  name: 'messages.whatsapp', // It is very important that the first part of the folder name contains "messages," as this allows for automating the search for reporters.
  description: `List WhatsApp messages`,
  requiresBackup: true,

  run (lib, { backup }) {
    return new Promise((resolve, reject) => {
      backup.openDatabase(WHATSAPP_DB)
      .then(db => {
        db.all(`SELECT Z_PK, ZTEXT, ZFROMJID, ZMESSAGEDATE, ZCHATSESSION FROM ZWAMESSAGE`, (err, rows) => {
          //            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Identify the columns with the important data
          if (err) reject(err)
          resolve(rows)
        })
      })
    })
  },

 // Format the extracted data; this allows defining an API.
  output: {
    id: el => el.Z_PK,
    sender: el => el.ZFROMJID,
    content: el => el.ZTEXT,
    timestamp: el => appleTimestamp.toUnixTimeStamp(el.ZMESSAGEDATE),
    chatID: el => el.ZCHATSESSION
  }
}
```

### 2. Register the reporter

Add the new reporter to the file: tools/reports.js

```js
module.exports = {
  ...
  messages: new Group({
    all: require('./reports/messages/all'),
    conversations: require('./reports/messages/conversations'),
    messages: require('./reports/messages/messages'),
    conversations_full: require('./reports/messages/conversations_full'),
    whatsapp: require('ibackuptool/tools/reports/messages/whatsapp') // <-- Add the new reporter here
  }),
}
```

### 3. Add the types for TypeScript

Add the types in the file: index.d.ts.

```ts 
export interface WhatsAppMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  chatID: string;
}

declare function run(command: "messages.whatsapp", options: { backup: string }): Promise<WhatsAppMessage[]>;

```
### 4. Run the reporter

```js
const bt = require('ibackuptool')

const run = async () => {
  await bt.configure({
    base: BACKUP_PATH,
    id: DEVICE_ID,
    password: PASSWORD_BACKUP
  })

  const whatsappMessages = await bt.run('messages.whatsapp', { backup: DEVICE_ID })

  console.log(whatsappMessages)
}

run()
```

### Summary of the Process:

1. **Encrypted Database**:  
   - The database is initially stored in an encrypted file called `Manifest.db` (in each backup folder).
   - Upon running the module for the first time, it decrypts the file and creates a new one named `Manifest.db-un`.

2. **Access Database with MySQL Client**:  
   - Open the `Manifest.db-un` file using a MySQL client (e.g., DB Browser for SQLite).
   - Execute the query `SELECT * FROM FILES` to explore the available files for extraction.

3. **Extract Hash Information**:  
   - From the query result, focus on the `relativePath` and `domain` columns.
   - These two columns together provide the hash of the encrypted file, which contains the specific information you need.

4. **Obtain the Path of the Encrypted File**:  
   - Using the extracted hash, obtain the path to the encrypted file containing the data.

5. **Decryption and Analysis**:  
   - Identify and decrypt the target file.
   - Once decrypted, analyze the file with an SQLite client to access the contents.

This process allows you to extract and analyze data from encrypted backup files systematically.

To analyze the database of a file, it is recommended to use the command:

```bash
npm run inspect
```






