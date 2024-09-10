// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs')
const path = require('path')
const bplist = require('bplist')
const aesjs = require('aes-js')
const jspack = require('jspack').jspack
const unpack = require('qunpack').unpack
const bigInt = require('big-integer')
const pbkdf2Hmac = require('pbkdf2-hmac')
const bigintConversion = require('bigint-conversion')
const sqlite3 = require('sqlite3').verbose()
const filehash = require('ibackuptool/tools/util/backup_filehash')
const { remove } = require('fs-extra')

function aesDecrypt (keyString, input) {
  // eslint-disable-next-line new-cap
  const escEcb = new aesjs.ModeOfOperation.ecb(keyString)
  return escEcb.decrypt(input)
}

function aesDecryptCBC (keyString, input) {
  // eslint-disable-next-line new-cap
  const escCbc = new aesjs.ModeOfOperation.cbc(keyString)
  return escCbc.decrypt(input)
}

const closeDBConnection = (db) => {
  return new Promise((resolve, reject) => db.close((e) => (e ? reject(e) : resolve())))
}

class BackupEncrypted {
  constructor (base, id, password, backupPath) {
    /*
     For encrypted backups, it is necessary to always use the same instance, which is why we make this class a singleton.
     */
    if (BackupEncrypted.instance) {
      return BackupEncrypted.instance
    }

    this.base = base || ''
    this.id = id || ''
    this.password = password
    this.backupPath = backupPath
    this.openDBs = {}

    // Very weird, but unwrap from existing backup instance.
    if (this.id instanceof BackupEncrypted) {
      this.id = this.id['id']
    }

    this.id = id
    this.base = base

    // Get the path of the folder.
    if (this.base) {
      this.path = path.join(this.base, this.id)
    } else {
      this.path = path.join(backupPath, this.id)
    }

    BackupEncrypted.instance = this
  }

  async load () {
    this.manifest = await this.readManifest()
    const backupKeyBag = this.manifest['BackupKeyBag']
    const tlvBlocks = BackupEncrypted.parseTLVBlocks(backupKeyBag)
    this.keys = BackupEncrypted.getKeys(tlvBlocks)
    const derivedKey = await BackupEncrypted.deriveKeyFromPassword(this.password, this.keys)
    BackupEncrypted.unlockKeys(derivedKey, this.keys)
    this.db = await this.openManifestDB()
    this.openDBs['manifest'] = this.db
  }

  readManifest () {
    const manifestPlist = path.join(this.path, 'Manifest.plist')
    return new Promise((resolve, reject) => {
      bplist.parseFile(manifestPlist, (err, object) => {
        if (err) {
          return reject(err)
        }
        return resolve(object[0])
      })
    })
  }

  getManifestClassKey () {
    const manifestClass = jspack.Unpack('<l', this.manifest['ManifestKey'].slice(0, 5))[0]
    const manifestKey = this.manifest['ManifestKey'].slice(4)
    return [manifestClass, manifestKey]
  }

  async openManifestDB () {
    const [manifestClass, manifestKey] = this.getManifestClassKey()
    const manifestClassKey = this.keys.class[manifestClass]['KEY']
    const key = await BackupEncrypted.unwrapKeyForClass(manifestClassKey, manifestKey)
    const encryptedData = fs.readFileSync(path.join(this.path, 'Manifest.db'))
    const decryptedData = aesDecryptCBC(key, encryptedData)
    fs.writeFileSync(path.join(this.path, 'Manifest.db-un'), decryptedData)
    const db = new sqlite3.Database(path.join(this.path, 'Manifest.db-un'))
    return db
  }

  async getEncryptionKey (plistFileManifest) {
    return new Promise((resolve, reject) => {
      bplist.parseBuffer(plistFileManifest, async (err, fileManifestArr) => {
        if (err) {
          reject(err)
        }
        if (fileManifestArr == null) {
          reject(new Error('could not parse file'))
        }
        try {
          const fileManifest = fileManifestArr[0]
          const fileData = fileManifest['$objects'][fileManifest['$top']['root']]
          const wrappedEncryptionKey = fileManifest['$objects'][fileData['EncryptionKey']]['NS.data'].slice(4)
          const classKey = this.keys.class[fileData['ProtectionClass']]['KEY']

          const encryptionKey = await BackupEncrypted.unwrapKeyForClass(classKey, wrappedEncryptionKey)

          resolve(encryptionKey)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  getFileName (fileID, isAbsolute) {
    // Default to non-absolute paths.
    isAbsolute = isAbsolute || false

    // Possible file locations for an ID
    let possibilities

    if (isAbsolute) {
      // We must only check in the root folder of the backup.
      possibilities = [path.join(this.path, fileID)]
    } else {
      // Check in both /abcdefghi and /ab/abcdefghi
      possibilities = [path.join(this.path, fileID), path.join(this.path, fileID.substr(0, 2), fileID)]
    }

    // Return first path that works.
    for (const p of possibilities) {
      // Check if the path exists
      if (fs.existsSync(p)) {
        // If it does, return it.
        return p
      }
    }

    // Throw an error.
    throw new Error(
      `Could not find a file needed for this report. It may not be compatible with this specific backup or iOS Version.`
    )
  }

  static parseTLVBlocks (blob) {
    let i = 0
    const result = []
    while (i + 8 <= blob.length) {
      const tag = blob.slice(i, i + 4).toString()
      const length = jspack.Unpack('>L', blob.slice(i + 4, i + 8))[0]
      const data = blob.slice(i + 8, i + 8 + length)
      result.push([tag, data])
      i += 8 + length
    }
    return result
  }

  static async deriveKeyFromPassword (cleartextpassword, keys) {
    const dpsl = keys.attrs['DPSL']
    const dpic = keys.attrs['DPIC']
    const temp = await pbkdf2Hmac(cleartextpassword, dpsl, dpic, 32, 'SHA-256')
    const salt = keys.attrs['SALT']
    const iter = keys.attrs['ITER']
    const decryptionKey = await pbkdf2Hmac(temp, salt, iter, 32, 'SHA-1')
    return decryptionKey
  }

  static unlockKeys (derivedKey, keys) {
    for (const idx in keys.class) {
      const classkey = keys.class[idx]
      if (!classkey['WPKY']) {
        continue
      }

      if (classkey['WRAP'] & 2) {
        const k = this.AESUnwrap(derivedKey, classkey['WPKY'])
        if (!k) {
          continue
        }
        classkey['KEY'] = k
      }
    }
  }

  static getKeys (tlvBlocks) {
    let currentClassKey = null
    const CLASSKEY_TAGS = ['CLAS', 'WRAP', 'WPKY', 'KTYP', 'PBKY']

    const keys = {
      class: {},
      uuid: null,
      type: null,
      wrap: null,
      attrs: {}
    }

    for (let [tag, data] of tlvBlocks) {
      if (data.length === 4) {
        data = jspack.Unpack('>L', data)[0]
      }
      if (tag === 'TYPE') {
        keys.type = data
        // if (keys.type.type > 3) {
        // }
      } else if (tag === 'UUID' && keys.uuid === null) {
        keys.uuid = data
      } else if (tag === 'WRAP' && keys.wrap === null) {
        keys.wrap = data
      } else if (tag === 'UUID') {
        if (currentClassKey) {
          keys.class[currentClassKey['CLAS']] = currentClassKey
        }
        currentClassKey = { UUID: data }
      } else if (CLASSKEY_TAGS.includes(tag)) {
        currentClassKey[tag] = data
      } else {
        keys.attrs[tag] = data
      }
    }
    if (currentClassKey) {
      keys.class[currentClassKey['CLAS']] = currentClassKey
    }

    return keys
  }

  static async unwrapKeyForClass (classKey, persistentKey) {
    if (persistentKey.length !== 0x28) {
      throw new Error('Invalid key length')
    }
    return this.AESUnwrap(classKey, persistentKey)
  }

  static unpack64bit (s) {
    return unpack('>Q', s)[0]
  }

  static pack64bit (s) {
    let buf = bigintConversion.bigintToBuf(s)
    for (let i = 0; i < 8 - buf.length; i++) {
      buf = Buffer.concat([Buffer.from([0]), buf])
    }
    return buf
  }

  static AESUnwrap (key, wrapped) {
    const C = []

    for (let i = 0; i < Math.floor(wrapped.length / 8); i++) {
      const chunk = wrapped.slice(i * 8, i * 8 + 8)
      C.push(bigintConversion.bufToBigint(chunk))
    }

    const n = C.length - 1
    const R = Array(n + 1).fill(0)
    let A = C[0]

    for (let i = 1; i < n + 1; i++) {
      R[i] = C[i]
    }

    for (let j = 5; j >= 0; j--) {
      for (let i = n; i >= 1; i--) {
        const todecBigInt = bigInt(A).xor(n * j + i)
        // eslint-disable-next-line no-undef
        let todec = this.pack64bit(BigInt(todecBigInt.toString()))
        todec = Buffer.concat([todec, this.pack64bit(R[i])])

        const B = aesDecrypt(Buffer.from(key), todec)
        A = bigintConversion.bufToBigint(B.slice(0, 8))
        R[i] = bigintConversion.bufToBigint(B.slice(8))
      }
    }

    // eslint-disable-next-line no-undef
    if (BigInt(A) !== BigInt('0xa6a6a6a6a6a6a6a6')) {
      return null
    }

    let res = Buffer.from([])
    for (let i = 1; i < R.length; i++) {
      res = Buffer.concat([res, this.pack64bit(R[i])])
    }

    return res
  }

  async openDatabaseDecrypted (filename) {
    return new Promise((resolve, reject) => {
      try {
        // Open as read only
        const db = new sqlite3.Database(filename, sqlite3.OPEN_READONLY, (err) => {
          if (err) {
            return reject(err)
          }

          if (db != null) {
            resolve(db)
          } else {
            reject(new Error('did not get a database instance.'))
          }
        })
      } catch (e) {
        return reject(e)
      }
    })
  }

  async openDatabase (fileID) {
    if (this.openDBs[fileID]) {
      return new Promise((resolve) => {
        resolve(this.openDBs[fileID])
      })
    }

    return new Promise((resolve, reject) => {
      try {
        this.db.get(`SELECT * FROM Files WHERE fileID='${fileID}'`, async (err, fileMetadata) => {
          if (err) {
            reject(err)
          }
          if (fileMetadata == null) {
            reject(new Error(`${fileID} file does not exist`))
          } else {
            try {
              const key = await this.getEncryptionKey(fileMetadata.file)
              const filename = path.join(this.path, fileMetadata.fileID.slice(0, 2), fileMetadata.fileID)
              const encryptedData = fs.readFileSync(filename)
              const decryptedData = aesDecryptCBC(key, encryptedData)
              fs.writeFileSync(filename + '-decrypted', decryptedData)
              resolve(filename + '-decrypted')
            } catch (e) {
              reject(e)
            }
          }
        })
      } catch (e) {
        reject(e)
      }
    }).then(async (filename) => {
      const decryptedDB = await this.openDatabaseDecrypted(filename)
      this.openDBs[fileID] = decryptedDB
      return decryptedDB
    })
  }

  /**
   * Derive a file's ID from its filename and domain.
   * @param path - the path to the file in the domain
   * @param domain - (optional) the file's domain. Default: HomeDomain
   */
  getFileID (path, domain) {
    return BackupEncrypted.getFileID(path, domain)
  }

  /**
   * Derive a file's ID from its filename and domain.
   * @param path - the path to the file in the domain
   * @param domain - (optional) the file's domain. Default: HomeDomain
   */
  static getFileID (path, domain) {
    return filehash(path, domain)
  }

  async closeAllOpenDBs () {
    const dbs = Object.values(this.openDBs)
    await Promise.all(dbs.map((db) => closeDBConnection(db)))
    this.openDBs = {}
    await remove(this.path)
  }
}

module.exports = BackupEncrypted
