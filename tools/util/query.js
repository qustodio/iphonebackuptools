const queryAll = ({ database, sql }) => {
  return new Promise((resolve, reject) => {
    database.all(sql, (err, rows) => {
      (err) ? reject(err) : resolve(rows)
    })
  })
}

module.exports = {
  queryAll
}
