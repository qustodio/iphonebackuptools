const path = require('path')
const log = require('./util/log')
const report = require('./reports')
const matcher = require('./util/matcher')
const Group = report.Group
const Backup = require('./backup-encrypted')
const os = require('os')

// Backup source directory (macos)
var backupDirectory = path.join(os.homedir(), '/Library/Application Support/MobileSync/Backup/')

// This flag is used to validate whether the use of encrypted backups has been configured.
var __isBackupEncryptedConfigured__ = false

const osType = process.platform

// Set windows backup directory
if (osType === 'win32') {
  backupDirectory = path.join(require('os').homedir(), '\\Apple\\MobileSync\\Backup')
}

// Object containing all report modules
var moduleCache = report.types

// Array of plugin modules
var plugins = []

/**
 * Add an array of plugins to the plugins list.
 * @param {Array<Object>} array contains array of plugin objects.
 */
function registerModule (array) {
  if (!(array instanceof Array)) {
    array = [ array ]
  }

  plugins.push(...array)
  moduleCache = getCompleteModuleList()
}

/**
 * Remove all non-default plugins.
 */
function clearModules () {
  plugins = []
  moduleCache = getCompleteModuleList()
}

/**
 * Get all modules in a top-down manner.
 */
function getCompleteModuleList () {
  let allModules = {}

  // Add all of the require()'d modules into the plugins list.
  plugins.forEach(function (plugin) {
    allModules = { ...allModules, ...plugin }
  })

  // Add all of the modules to a single object.
  // JS's behavior dictates that the items are added sequentially
  // So, the default reports overwrite any third party plugin.
  let result = {
    ...allModules,
    ...report.types
  }

  moduleCache = result

  return result
}

/**
 * Try to find a single report.
 * @param {string} query name to find.
 */
function findReport (query) {
  return new Promise((resolve, reject) => {
    // Check there is no wildcard in the query.
    if (query.indexOf('*') > -1) {
      return reject(new Error('Cannot run a wildcard match here.'))
    }

    // Run matches.
    let matches = matcher(moduleCache, query, (el) => !(el instanceof Group))

    // If no report found, fail.
    if (matches.length === 0) {
      return reject(new Error(`No report found with name "${query}"`))
    }

    // If multiple matches, fail.
    if (matches.length > 1) {
      return reject(new Error(`Multiple report matches for name "${query}", not allowed.`))
    }

    // Resolve match
    resolve(matches[0])
  })
}

/**
 * Translate the raw output of a report to the correct result, based on the "raw" parameter.
 * @param {Object} report The report module
 * @param {Object} result Raw data output from the aforementioned report
 * @param {Object} params parameters object.
 */
function compileReport (report, result, { raw }) {
  return new Promise((resolve, reject) => {
    if (!raw && report.output) {
      if (result instanceof Array) {
        log.verbose('compiling report (array)...')
        // if it's an array, translate each item.
        result = result.map(item => {
          // For each item, run the functions on the entry.
          let editedResult = {}
          for (let [key, value] of Object.entries(report.output)) {
            editedResult[key] = value(item)
          }

          return editedResult
        })

        resolve(result)
      } else {
        log.verbose('compiling report (single)...')
        // Otherwise, translate the object returned.
        let editedResult = {}
        for (let [key, value] of Object.entries(report.output)) {
          editedResult[key] = value(result)
        }

        resolve(editedResult)
      }
    } else {
      resolve(result)
    }
  })
}

/**
 * Run a named report and resolve to it's output.
 * The output is formatted based on the `report.output` key, if the params.raw option is NOT set to true.
 * @param {string} query report name
 * @param {Object=} params parameters.
 */
function run (query, params) {
  if (!__isBackupEncryptedConfigured__) {
    return Promise.reject(new Error('Backup encryption is not configured. Please configure it using the configure method.'))
  }
  params = params || {}
  return new Promise(async (resolve, reject) => {
    try {
      let report = await findReport(query)
      let result = await runReport(report, params)
      let compiled = await compileReport(report, result, params)

      resolve(compiled)
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * Run a report
 * @param {object} report report module
 * @param {object=} params parameters
 */
function runReport (report, params) {
  params = params || {}

  return new Promise((resolve, reject) => {
    var backup

    // Cannot run < v3 backups in this manner.
    if (!report.version || report.version < 3) {
      return reject(new Error(`Cannot call ${report.name} as a module, it is not updated to the v3 api`))
    }

    // If it requires a backup and none is provided, reject.
    if (report.requiresBackup) {
      if (!params.backup) {
        return reject(new Error('Please specify the `backup` parameter to run this report.'))
      }

      backup = new Backup(backupDirectory, params.backup, params.password)
    }

    // Input params to func
    let inputParams = {
      ...params,
      backup
    }

    report.run(module.exports, inputParams)
      .then(resolve)
      .catch(reject)
  })
}

/**
 * Configures the backup by setting the backup directory and initializing
 * the `Backup` instance. This function also loads the backup and marks
 * that encrypted backup configuration has been set.
 *
 * @param {Object} params - The configuration parameters.
 * @param {string} params.base - The base directory for the backup.
 * @param {string} params.id - The identifier for the backup.
 * @param {string} params.password - The password for the backup.
 *
 * @returns {Promise<void>} A promise that resolves when the configuration
 * is complete.
 *
 * @throws {Error} Throws an error if the `Backup` instance cannot be loaded.
 *
 * @async
 */
async function configure ({ base, id, password }) {
  backupDirectory = base
  const backup = new Backup(base, id, password)
  await backup.load()
  __isBackupEncryptedConfigured__ = true
}

/**
 * Releases all open database connections associated with the backup.
 *
 * It is essential to release the connections because, in some operating systems
 * (like Windows), deleting the backup folder without releasing the connection
 * can cause errors due to database files still being in use.
 *
 * @async
 * @function
 * @param {Object} params - Parameters required to initialize the backup connection.
 * @param {string} params.base - The base path of the backup.
 * @param {string} params.id - The identifier of the database.
 * @param {string} params.password - The password to access the database.
 *
 * @returns {Promise<void>} A promise that resolves when all connections have been released.
 */
async function releaseConnections ({ base, id, password }) {
  const backup = new Backup(base, id, password)
  await backup.closeAllOpenDBs()
  Backup.destroy()
}

module.exports = {
  // Exported Libraries
  Backup,
  Group,

  // Module management
  registerModule,
  clearModules,
  get modules () {
    return moduleCache
  },

  // Source directory
  set base (value) {
    backupDirectory = value
  },
  get base () {
    return backupDirectory
  },

  // Runners
  run,
  findReport,
  runReport,
  compileReport,

  // misc
  setLogLevel (lvl) {
    log.setVerbose(lvl)
  },

  // mode management
  configure,
  releaseConnections
}
