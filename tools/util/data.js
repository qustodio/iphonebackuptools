module.exports = {
  prop: (k, x) => x[k],
  groupBy: (fkey, xs) => {
    return xs.reduce((groups, x) => {
      const key = fkey(x)
      return {
        ...groups,
        [key]: (groups[key] || []).concat(x)
      }
    }, {})
  },
  uniqueBy: (keyFn, xs) =>
    xs.reduce((acc, item) => {
      const key = keyFn(item)
      return acc.some(existing => keyFn(existing) === key) ? acc : [...acc, item]
    }, []),
  toIdentityMap: (arr) => Object.fromEntries(arr.map((val) => [val, val])),
  mapObj: (fn, obj) => {
    return Object.keys(obj).reduce((newObj, key) => {
      newObj[key] = fn(obj[key], key, obj)
      return newObj
    }, {})
  },
  indexedMapBy: (fn, xs) => {
    return xs.reduce((acc, item) => {
      const k = fn(item)
      return {
        ...acc,
        [k]: item
      }
    }, {})
  },
  memoize: (keyFn, fn) => {
    const cache = new Map()

    return (...args) => {
      const key = keyFn(...args)
      if (cache.has(key)) {
        return cache.get(key)
      }

      const result = fn(...args)
      cache.set(key, result)
      return result
    }
  }
}
