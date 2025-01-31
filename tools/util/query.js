const queryAll = ({ database, sql }) => {
  return new Promise((resolve, reject) => {
    database.all(sql, (err, rows) => {
      return (err) ? reject(err) : resolve(rows)
    })
  })
}

module.exports = {
  queryAll
}
