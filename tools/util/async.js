const parallel = (fn, xs) => {
  // Object
  if (typeof xs === 'object' && !Array.isArray(xs)) {
    return Promise.all(
      Object.entries(xs).map(([key, value]) =>
        fn(value, key).then(result => [key, result])
      )
    ).then(entries => Object.fromEntries(entries))
  }

  // Array
  return Promise.all(xs.map(fn))
}

const fork = (...promises) => Promise.all(promises)

module.exports = {
  parallel,
  fork
}
