const parallel = (fn, xs) => Promise.all(xs.map(fn))

module.exports = {
  parallel
}
