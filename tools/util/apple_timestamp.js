const MAC_TO_UNIX_EPOCH_DIFF = 978307200 // Difference between Mac Absolute Time and UNIX epoch

module.exports = {
  parse: (fieldName) => {
    return `CASE WHEN (${fieldName} > 1000000000) THEN datetime(${fieldName} / 1000000000 + 978307200, 'unixepoch') 
                 WHEN ${fieldName} <> 0 THEN datetime((${fieldName} + 978307200), 'unixepoch') 
                 ELSE ${fieldName} END`
  }, /**
   * Apple stores timestamps in Mac Absolute Time format,
   * which uses January 1, 2001, as its reference point. To convert this format to a UNIX timestamp,
   * add 978307200 seconds, representing the difference between the UNIX epoch (January 1, 1970)
   * and the Mac Absolute Time epoch (January 1, 2001).
   *
   * Conversion example:
   *   Mac Absolute Time: 753610656.267363
   *   UNIX Timestamp: 753610656.267363 + 978307200 = 1731917856.267363
   *
   * Practical usage:
   * - The UNIX timestamp can then be converted to a human-readable date using standard time conversion functions.
   */
  toUnixTimeStamp: (macTime) => {
    const unixTimestamp = macTime + MAC_TO_UNIX_EPOCH_DIFF // Convert to UNIX timestamp
    return unixTimestamp
  },
  /**
   * Converts a UNIX timestamp to Mac Absolute Time.
   * The Mac Absolute Time epoch starts on January 1, 2001.
   * UNIX epoch starts on January 1, 1970.
   * The difference between these epochs is 978307200 seconds.
   *
   * @param {number} unixTimestamp - The UNIX timestamp to convert.
   * @returns {number} The Mac Absolute Time.
   */
  toMacAbsoluteTime: (unixTimestamp) => {
    const macTime = unixTimestamp - MAC_TO_UNIX_EPOCH_DIFF // Convert to Mac Absolute Time
    return macTime
  }
}
