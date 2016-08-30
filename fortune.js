/*!
 * Fortune.js
 * Version 4.2.0
 * MIT License
 * http://fortune.js.org
 */
(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (Buffer){
'use strict'

var deepEqual = require('../../common/deep_equal')
var message = require('../../common/message')
var find = require('../../common/array/find')

var errors = require('../../common/errors')
var BadRequestError = errors.BadRequestError

var keys = require('../../common/keys')
var primaryKey = keys.primary
var typeKey = keys.type
var isArrayKey = keys.isArray

// For complex types.
var matchCheck = [
  [ Date, function (a, b) { return a.getTime() === b.getTime() } ],
  [ Buffer, function (a, b) { return a.equals(b) } ],
  [ Object, function (a, b) { return deepEqual(a, b) } ]
]

// For comparing sort order.
var comparisons = [
  [ Number, function (a, b) { return a - b } ],
  [ String, function (a, b) { return a < b ? -1 : a > b ? 1 : 0 } ],
  [ Boolean, function (a, b) { return a === b ? 0 : a ? 1 : -1 } ],
  [ Date, function (a, b) { return a.getTime() - b.getTime() } ],
  [ Buffer, Buffer.compare ],

  // There is no comparison here that makes sense.
  [ Object, function (a, b) {
    return Object.keys(a).length - Object.keys(b).length
  } ]
]


// Browser-safe ID generation.
exports.generateId = function () {
  return Date.now() + '-' +
    ('00000000' + Math.floor(Math.random() * Math.pow(2, 32)).toString(16))
    .slice(-8)
}


exports.applyOptions = function (fields, records, options, meta) {
  var count, record, field, isInclude, isExclude, language, memoizedRecords,
    range, match, exists
  var i, j

  if (!options) options = {}
  if (!meta) meta = {}

  language = meta.language
  range = options.range
  match = options.match
  exists = options.exists

  // Apply filters.
  if (range || match || exists) {
    memoizedRecords = records
    records = []
    for (i = 0, j = memoizedRecords.length; i < j; i++) {
      record = memoizedRecords[i]
      if (range && !matchByRange(fields, range, record)) continue
      if (match && !matchByField(fields, match, record)) continue
      if (exists && !matchByExistence(fields, exists, record)) continue
      records.push(record)
    }
  }

  count = records.length

  if ('fields' in options) {
    isInclude = !find(Object.keys(options.fields),
      function (field) { return !options.fields[field] })
    isExclude = !find(Object.keys(options.fields),
      function (field) { return options.fields[field] })

    if (!isInclude && !isExclude)
      throw new BadRequestError(message('FieldsFormat', language))

    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]
      for (field in record) {
        if (field === primaryKey) continue
        if ((isInclude && !(field in options.fields)) ||
          (isExclude && field in options.fields))
          delete record[field]
      }
    }
  }

  if ('sort' in options)
    records = records.sort(compare(fields, options.sort))

  if ('limit' in options || 'offset' in options)
    records = records.slice(options.offset, options.limit ?
      (options.offset || 0) + options.limit : records.length)

  records.count = count

  return records
}


function check (type, a, b) {
  var matcher

  if (b === null) return a === null
  if (!type) return a === b
  if (type.compare) return type.compare(a, b) === 0

  matcher = find(matchCheck, function (pair) {
    return pair[0] === type.prototype.constructor
  })
  if (matcher) return matcher[1](a, b)

  return a === b
}


function checkValue (fieldDefinition, a) {
  return function (b) {
    return fieldDefinition[isArrayKey] ?
      find(a, function (a) {
        return check(fieldDefinition[typeKey], b, a)
      }) : check(fieldDefinition[typeKey], b, a)
  }
}


function matchByField (fields, match, record) {
  var field, matches

  for (field in match) {
    matches = match[field]
    if (!Array.isArray(matches)) matches = [ matches ]
    if (find(matches, checkValue(fields[field], record[field])) === void 0)
      return false
  }

  return true
}


function matchByExistence (fields, exists, record) {
  var field, value, isArray

  for (field in exists) {
    value = record[field]
    isArray = fields[field][isArrayKey]
    if (exists[field]) {
      if (!value) return false
      if (isArray && !value.length) return false
    }
    else {
      if (value && !isArray) return false
      if (isArray && value.length) return false
    }
  }

  return true
}


function matchByRange (fields, ranges, record) {
  var compare = {}
  var field, fieldDefinition, fieldType, fieldIsArray, range, value

  for (field in ranges) {
    fieldDefinition = fields[field]
    fieldType = fieldDefinition[typeKey]
    fieldIsArray = fieldDefinition[isArrayKey]

    // Skip for singular link fields.
    if (!fieldType && !fieldIsArray) continue

    range = ranges[field]
    value = record[field]

    if (value == null) return false
    if (fieldIsArray) value = value ? value.length : 0

    if (!compare[field])
      compare[field] = !fieldIsArray ? fieldType.compare ||
        find(comparisons, findByType(fieldType))[1] :
        find(comparisons, findByType(Number))[1]

    if (range[0] !== null && compare[field](value, range[0]) < 0)
      return false

    if (range[1] !== null && compare[field](range[1], value) < 0)
      return false
  }

  return true
}


function findByType (type) {
  return function (pair) {
    return pair[0] === type.prototype.constructor
  }
}


function compare (fields, sort) {
  var field, compare, a, b, isAscending,
    fieldDefinition, fieldIsArray, fieldType, result

  return function (x, y) {
    for (field in sort) {
      a = x[field]
      b = y[field]
      isAscending = sort[field]
      fieldDefinition = fields[field]
      fieldIsArray = fieldDefinition[isArrayKey]
      fieldType = fieldDefinition[typeKey]

      if (a === null) return 1
      if (b === null) return -1

      result = 0

      if (fieldIsArray) result = a.length - b.length
      else if (fieldType) {
        compare = fieldType.compare ||
          find(comparisons, findByType(fieldType))[1]
        if (!compare) throw new Error('Missing "compare" function.')
        result = compare(a, b)
      }

      if (result === 0) continue

      return isAscending ? result : -result
    }

    return 0
  }
}

}).call(this,require("buffer").Buffer)
},{"../../common/array/find":11,"../../common/deep_equal":20,"../../common/errors":21,"../../common/keys":23,"../../common/message":24,"buffer":47}],2:[function(require,module,exports){
'use strict'

var common = require('../common')
var generateId = common.generateId

// This is for ensuring that type/ID combination is unique.
// https://stackoverflow.com/questions/26019147
var delimiter = '__'


// Unfortunately, IndexedDB implementations are pretty buggy. This adapter
// tries to work around the incomplete and buggy implementations of IE10+ and
// iOS 8+.
// http://www.raymondcamden.com/2014/09/25/IndexedDB-on-iOS-8-Broken-Bad


exports.delimiter = delimiter


exports.inputRecord = function (type, record) {
  var recordTypes = this.recordTypes
  var primaryKey = this.keys.primary
  var isArrayKey = this.keys.isArray
  var fields = recordTypes[type]
  var fieldsArray = Object.getOwnPropertyNames(fields)
  var result = {}
  var i, j, field, fieldIsArray

  // ID business.
  result[primaryKey] = type + delimiter + (primaryKey in record ?
    record[primaryKey] : generateId())

  for (i = 0, j = fieldsArray.length; i < j; i++) {
    field = fieldsArray[i]
    fieldIsArray = fields[field][isArrayKey]

    if (!(field in record)) {
      result[field] = fieldIsArray ? [] : null
      continue
    }

    result[field] = record[field]
  }

  return result
}


exports.outputRecord = function (type, record) {
  var recordTypes = this.recordTypes
  var primaryKey = this.keys.primary
  var isArrayKey = this.keys.isArray
  var denormalizedInverseKey = this.keys.denormalizedInverse
  var fields = recordTypes[type]
  var fieldsArray = Object.getOwnPropertyNames(fields)
  var result = {}
  var i, j, field, fieldIsArray, fieldIsDenormalized, value

  // ID business.
  var id = record[primaryKey].split(delimiter)[1]
  var float = Number.parseFloat(id)
  result[primaryKey] = id - float + 1 >= 0 ? float : id

  for (i = 0, j = fieldsArray.length; i < j; i++) {
    field = fieldsArray[i]
    fieldIsArray = fields[field][isArrayKey]
    value = field in record ? record[field] : fieldIsArray ? [] : null
    fieldIsDenormalized = fields[field][denormalizedInverseKey]

    // Do not enumerate denormalized fields.
    if (fieldIsDenormalized) {
      Object.defineProperty(result, field, {
        configurable: true, writable: true, value: value
      })
      continue
    }

    if (field in record) result[field] = value
  }

  return result
}

},{"../common":1}],3:[function(require,module,exports){
'use strict'

var msgpack = require('msgpack-lite')
var reduce = require('../../../common/array/reduce')
var assign = require('../../../common/assign')
var memoryAdapter = require('../memory')

var common = require('../common')
var generateId = common.generateId

var constants = require('../../../common/constants')
var primaryKey = constants.primary

var worker = require('./worker')
var helpers = require('./helpers')
var inputRecord = helpers.inputRecord
var outputRecord = helpers.outputRecord
var delimiter = helpers.delimiter


/**
 * IndexedDB adapter. Available options:
 *
 * - `name`: Name of the database to connect to. Default: `fortune`.
 */
module.exports = function (Adapter) {
  var MemoryAdapter = memoryAdapter(Adapter)

  function IndexedDBAdapter (properties) {
    MemoryAdapter.call(this, properties)
    if (!this.options.name) this.options.name = 'fortune'
  }

  IndexedDBAdapter.prototype = Object.create(MemoryAdapter.prototype)


  IndexedDBAdapter.prototype.connect = function () {
    var self = this
    var Promise = self.Promise
    var typesArray = Object.keys(self.recordTypes)
    var name = self.options.name
    var id = generateId()

    return MemoryAdapter.prototype.connect.call(self)
    .then(function () {
      return new Promise(function (resolve, reject) {
        var hasIndexedDB = 'indexedDB' in window
        var hasWebWorker = 'Worker' in window
        var hasBlob = 'Blob' in window
        var hasCreateObjectURL = 'URL' in window && 'createObjectURL' in URL
        var blob, objectURL, worker

        if (hasIndexedDB && hasWebWorker && hasBlob && hasCreateObjectURL)
          // Now that we're in here, need to check for private browsing modes.
          try {
            // This will fail synchronously if it's not supported.
            indexedDB.open('').onsuccess = function (event) {
              event.target.result.close() // Close unused connection.
            }
          }
          catch (error) {
            return reject(new Error('IndexedDB capabilities detected, but a ' +
              'connection could not be opened due to browser security.'))
          }
        else return reject(new Error('IndexedDB pre-requisites not met.'))

        // Need to check for IndexedDB support within Web Worker.
        blob = new Blob([
          'self.postMessage(Boolean(self.indexedDB))'
        ], { type: 'text/javascript' })
        objectURL = URL.createObjectURL(blob)
        worker = new Worker(objectURL)

        worker.onmessage = function (message) {
          return message.data ? resolve() :
            reject(new Error('No IndexedDB support in Web Worker.'))
        }

        return null
      })
      // After this point, no more checks.
      .then(function () {
        return new Promise(function (resolve, reject) {
          var script, blob, objectURL

          script = [
            'var primaryKey = "' + primaryKey + '"',
            'var delimiter = "' + delimiter + '"',
            'var dataKey = "__data"',
            '(' + worker.toString() + ')()'
          ].join(';')
          blob = new Blob([ script ], { type: 'text/javascript' })
          objectURL = URL.createObjectURL(blob)

          self.worker = new Worker(objectURL)
          self.worker.addEventListener('message', listener)
          self.worker.postMessage({
            id: id, method: 'connect',
            name: name, typesArray: typesArray
          })

          function listener (event) {
            var data = event.data
            var result = data.result
            var type

            if (data.id !== id) return null
            if (data.error) return reject(new Error(data.error))

            self.worker.removeEventListener('message', listener)

            for (type in result)
              self.db[type] = reducer(type, result[type])

            return resolve()
          }
        })
      })
      // Warning and fallback to memory adapter.
      .catch(function (error) {
        console.warn(error.message) // eslint-disable-line no-console

        // Assign instance methods of the memory adapter.
        assign(self, MemoryAdapter.prototype)
      })
    })

    // Populating memory database with results from IndexedDB.
    function reducer (type, records) {
      return reduce(records, function (hash, record) {
        record = outputRecord.call(self, type, msgpack.decode(record))
        hash[record[primaryKey]] = record
        return hash
      }, {})
    }
  }


  IndexedDBAdapter.prototype.disconnect = function () {
    this.worker.postMessage({ method: 'disconnect' })
    return MemoryAdapter.prototype.disconnect.call(this)
  }


  IndexedDBAdapter.prototype.create = function (type, records) {
    var self = this
    var Promise = self.Promise

    return MemoryAdapter.prototype.create.call(self, type, records)
    .then(function (records) {
      return records.length ? new Promise(function (resolve, reject) {
        var id = generateId()
        var transfer = []

        self.worker.addEventListener('message', listener)
        self.worker.postMessage({
          id: id, method: 'create', type: type,
          records: reduce(records, function (hash, record) {
            var data = msgpack.encode(inputRecord.call(self, type, record))
            transfer.push(data.buffer)
            hash[record[primaryKey]] = data
            return hash
          }, {})
        }, transfer)

        function listener (event) {
          var data = event.data

          if (data.id !== id) return null
          if (data.error) return reject(new Error(data.error))

          self.worker.removeEventListener('message', listener)
          return resolve(records)
        }
      }) : records
    })
  }


  IndexedDBAdapter.prototype.find = function (type, ids, options) {
    return MemoryAdapter.prototype.find.call(this, type, ids, options)
  }


  IndexedDBAdapter.prototype.update = function (type, updates) {
    var self = this
    var Promise = self.Promise
    var db = self.db
    var id = generateId()

    return MemoryAdapter.prototype.update.call(self, type, updates)
    .then(function (count) {
      return count ? new Promise(function (resolve, reject) {
        var i, j, record, records = [], transfer = []

        for (i = 0, j = updates.length; i < j; i++) {
          record = db[type][updates[i][primaryKey]]
          if (!record) continue
          records.push(record)
        }

        self.worker.addEventListener('message', listener)
        self.worker.postMessage({
          id: id, method: 'update', type: type,
          records: reduce(records, function (hash, record) {
            var data = msgpack.encode(inputRecord.call(self, type, record))
            transfer.push(data.buffer)
            hash[record[primaryKey]] = data
            return hash
          }, {})
        }, transfer)

        function listener (event) {
          var data = event.data

          if (data.id !== id) return null
          if (data.error) return reject(new Error(data.error))

          self.worker.removeEventListener('message', listener)

          return resolve(count)
        }
      }) : count
    })
  }


  IndexedDBAdapter.prototype.delete = function (type, ids) {
    var self = this
    var Promise = self.Promise
    var id = generateId()

    return MemoryAdapter.prototype.delete.call(self, type, ids)
    .then(function (count) {
      return count ? new Promise(function (resolve, reject) {
        self.worker.addEventListener('message', listener)
        self.worker.postMessage({
          id: id, method: ids ? 'delete' : 'deleteAll',
          type: type, ids: ids
        })

        function listener (event) {
          var data = event.data

          if (data.id !== id) return null
          if (data.error) return reject(new Error(data.error))

          self.worker.removeEventListener('message', listener)

          return resolve(count)
        }
      }) : count
    })
  }

  return IndexedDBAdapter
}

},{"../../../common/array/reduce":15,"../../../common/assign":17,"../../../common/constants":19,"../common":1,"../memory":6,"./helpers":2,"./worker":4,"msgpack-lite":54}],4:[function(require,module,exports){
'use strict'

module.exports = worker


// This function is somewhat special, it is run within a worker context.
function worker () {
  var indexedDB = self.indexedDB
  var db
  var methodMap = {
    connect: connect,
    disconnect: disconnect,
    create: create,
    update: update,
    delete: remove,
    deleteAll: removeAll
  }

  self.addEventListener('message', function (event) {
    var data = event.data
    var id = data.id
    var method = data.method

    methodMap[method](data, function (error, result, transfer) {
      if (error) {
        self.postMessage({
          id: id, error: error.toString()
        })
        return
      }

      self.postMessage({
        id: id, result: result
      }, transfer)
    })
  })


  function connect (data, callback) {
    var request = indexedDB.open(data.name)
    var typesArray = data.typesArray

    request.onerror = errorConnection
    request.onupgradeneeded = handleUpgrade
    request.onsuccess = handleSuccess

    function handleSuccess (event) {
      var i, j

      db = event.target.result

      for (i = 0, j = typesArray.length; i < j; i++)
        if (!~Array.prototype.indexOf.call(
          db.objectStoreNames, typesArray[i])) {
          reconnect()
          return
        }

      loadRecords()
    }

    function handleUpgrade (event) {
      var i, j, type

      db = event.target.result

      for (i = 0, j = typesArray.length; i < j; i++) {
        type = typesArray[i]
        if (!~Array.prototype.indexOf.call(db.objectStoreNames, type))
          db.createObjectStore(type, { keyPath: primaryKey })
      }

      for (i = 0, j = db.objectStoreNames.length; i < j; i++) {
        type = db.objectStoreNames[i]
        if (!~Array.prototype.indexOf.call(typesArray, type))
          db.deleteObjectStore(type)
      }
    }

    function reconnect () {
      var version = (db.version || 1) + 1

      db.close()
      request = indexedDB.open(data.name, version)
      request.onerror = errorReconnection
      request.onupgradeneeded = handleUpgrade
      request.onsuccess = function (event) {
        db = event.target.result
        loadRecords(db)
      }
    }

    function loadRecords () {
      var counter = 0
      var payload = {}
      var transfer = []
      var i, j

      for (i = 0, j = typesArray.length; i < j; i++)
        loadType(typesArray[i])

      function loadType (type) {
        var transaction = db.transaction(type, 'readonly')
        var objectStore = transaction.objectStore(type)
        var cursor = objectStore.openCursor()

        payload[type] = []
        cursor.onsuccess = function (event) {
          var iterator = event.target.result
          if (iterator) {
            payload[type].push(iterator.value[dataKey])
            transfer.push(iterator.value[dataKey].buffer)
            iterator.continue()
            return
          }
          counter++
          if (counter === typesArray.length)
            callback(null, payload, transfer)
        }
        cursor.onerror = errorIteration
      }
    }

    function errorConnection () {
      callback('The database connection could not be established.')
    }

    function errorReconnection () {
      callback('An attempt to reconnect failed.')
    }

    function errorIteration () {
      callback('Failed to read record.')
    }
  }


  function disconnect () {
    db.close()
  }


  function create (data, callback) {
    var recordsLength = Object.keys(data.records).length
    var type = data.type
    var transaction = db.transaction(type, 'readwrite')
    var objectStore = transaction.objectStore(type)
    var id, record, object, request, counter = 0

    for (id in data.records) {
      record = data.records[id]
      object = {}
      object[primaryKey] = type + delimiter + id
      object[dataKey] = record
      request = objectStore.add(object)
      request.onsuccess = check
      request.onerror = error
    }

    function check () {
      counter++
      if (counter === recordsLength) callback()
    }

    function error () {
      callback('A record could not be created.')
    }
  }


  function update (data, callback) {
    var recordsLength = Object.keys(data.records).length
    var type = data.type
    var transaction = db.transaction(type, 'readwrite')
    var objectStore = transaction.objectStore(type)
    var id, record, object, request, counter = 0

    for (id in data.records) {
      record = data.records[id]
      object = {}
      object[primaryKey] = type + delimiter + id
      object[dataKey] = record
      request = objectStore.put(object)
      request.onsuccess = check
      request.onerror = error
    }

    function check () {
      counter++
      if (counter === recordsLength) callback()
    }

    function error () {
      callback('A record could not be updated.')
    }
  }


  function remove (data, callback) {
    var type = data.type
    var ids = data.ids
    var transaction = db.transaction(type, 'readwrite')
    var objectStore = transaction.objectStore(type)
    var i, j, id, request, counter = 0

    for (i = 0, j = ids.length; i < j; i++) {
      id = ids[i]
      request = objectStore.delete(type + delimiter + id)
      request.onsuccess = check
      request.onerror = error
    }

    function check () {
      counter++
      if (counter === ids.length) callback()
    }

    function error () {
      callback('A record could not be deleted.')
    }
  }


  function removeAll (data, callback) {
    var type = data.type
    var transaction = db.transaction(type, 'readwrite')
    var objectStore = transaction.objectStore(type)
    var request = objectStore.clear()
    request.onsuccess = function () { callback() }
    request.onerror = error

    function error () {
      callback('Not all records could be deleted.')
    }
  }
}

},{}],5:[function(require,module,exports){
'use strict'

var common = require('../common')
var generateId = common.generateId


exports.inputRecord = function (type, record) {
  var recordTypes = this.recordTypes
  var primaryKey = this.keys.primary
  var isArrayKey = this.keys.isArray
  var fields = recordTypes[type]
  var fieldsArray = Object.getOwnPropertyNames(fields)
  var result = {}
  var i, j, field

  // ID business.
  result[primaryKey] = primaryKey in record ?
    record[primaryKey] : generateId()

  for (i = 0, j = fieldsArray.length; i < j; i++) {
    field = fieldsArray[i]
    if (!(field in record)) {
      result[field] = fields[field][isArrayKey] ? [] : null
      continue
    }

    result[field] = record[field]
  }

  return result
}


exports.outputRecord = function (type, record) {
  var recordTypes = this.recordTypes
  var primaryKey = this.keys.primary
  var isArrayKey = this.keys.isArray
  var denormalizedInverseKey = this.keys.denormalizedInverse
  var fields = recordTypes[type]
  var fieldsArray = Object.getOwnPropertyNames(fields)
  var result = {}
  var i, j, field, value

  // ID business.
  result[primaryKey] = record[primaryKey]

  for (i = 0, j = fieldsArray.length; i < j; i++) {
    field = fieldsArray[i]
    value = field in record ? record[field] :
      fields[field][isArrayKey] ? [] : null

    // Do not enumerate denormalized fields.
    if (fields[field][denormalizedInverseKey]) {
      Object.defineProperty(result, field, {
        configurable: true, writable: true, value: value
      })
      continue
    }

    if (field in record) result[field] = value
  }

  return result
}

},{"../common":1}],6:[function(require,module,exports){
'use strict'

var applyUpdate = require('../../../common/apply_update')
var map = require('../../../common/array/map')

var common = require('../common')
var applyOptions = common.applyOptions

var helpers = require('./helpers')
var inputRecord = helpers.inputRecord
var outputRecord = helpers.outputRecord


/**
 * Memory adapter.
 */
module.exports = function (Adapter) {
  function MemoryAdapter (properties) {
    Adapter.call(this, properties)
    if (!this.options) this.options = {}
    if (!('recordsPerType' in this.options))
      this.options.recordsPerType = 1000
  }

  MemoryAdapter.prototype = Object.create(Adapter.prototype)

  MemoryAdapter.prototype.connect = function () {
    var Promise = this.Promise
    var recordTypes = this.recordTypes
    var type

    this.db = {}

    for (type in recordTypes)
      this.db[type] = {}

    return Promise.resolve()
  }


  MemoryAdapter.prototype.disconnect = function () {
    var Promise = this.Promise
    delete this.db
    return Promise.resolve()
  }


  MemoryAdapter.prototype.find = function (type, ids, options, meta) {
    var self = this
    var Promise = self.Promise
    var db = self.db
    var recordTypes = self.recordTypes
    var fields = recordTypes[type]
    var collection = db[type]
    var records = []
    var i, j, id, record

    if (ids && !ids.length) return Adapter.prototype.find.call(self)

    if (ids) for (i = 0, j = ids.length; i < j; i++) {
      id = ids[i]
      if (id in collection) {
        record = collection[id]

        // LRU update.
        delete collection[id]
        collection[id] = record

        records.push(outputRecord.call(self, type, record))
      }
    }

    else for (id in collection)
      records.push(outputRecord.call(self, type, collection[id]))

    return Promise.resolve(applyOptions(fields, records, options, meta))
  }


  MemoryAdapter.prototype.create = function (type, records, meta) {
    var self = this
    var message = self.message
    var Promise = self.Promise
    var db = self.db
    var recordsPerType = self.options.recordsPerType
    var primaryKey = self.keys.primary
    var ConflictError = self.errors.ConflictError
    var collection = db[type]
    var i, j, record, id, ids, language

    if (!meta) meta = {}
    language = meta.language

    records = map(records, function (record) {
      return inputRecord.call(self, type, record)
    })

    // First check for collisions.
    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]
      id = record[primaryKey]

      if (collection[id])
        return Promise.reject(new ConflictError(
          message('RecordExists', language, { id: id })))
    }

    // Then save it to memory.
    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]
      collection[record[primaryKey]] = record
    }

    // Clear least recently used records.
    if (recordsPerType) {
      ids = Object.keys(collection)

      if (ids.length > recordsPerType) {
        ids = ids.slice(0, ids.length - recordsPerType)

        for (i = 0, j = ids.length; i < j; i++)
          delete collection[ids[i]]
      }
    }

    return Promise.resolve(map(records, function (record) {
      return outputRecord.call(self, type, record)
    }))
  }


  MemoryAdapter.prototype.update = function (type, updates) {
    var self = this
    var Promise = self.Promise
    var db = self.db
    var primaryKey = self.keys.primary
    var collection = db[type]
    var count = 0
    var i, j, update, id, record

    if (!updates.length) return Adapter.prototype.update.call(self)

    for (i = 0, j = updates.length; i < j; i++) {
      update = updates[i]
      id = update[primaryKey]
      record = collection[id]

      if (!record) continue

      count++
      record = outputRecord.call(self, type, record)

      applyUpdate(record, update)

      // LRU update.
      delete collection[id]

      collection[id] = inputRecord.call(self, type, record)
    }

    return Promise.resolve(count)
  }


  MemoryAdapter.prototype.delete = function (type, ids) {
    var Promise = this.Promise
    var db = this.db
    var collection = db[type]
    var count = 0
    var i, j, id

    if (ids && !ids.length) return Adapter.prototype.delete.call(this)

    if (ids) for (i = 0, j = ids.length; i < j; i++) {
      id = ids[i]
      if (collection[id]) {
        delete collection[id]
        count++
      }
    }

    else for (id in collection) {
      delete collection[id]
      count++
    }

    return Promise.resolve(count)
  }

  return MemoryAdapter
}

},{"../../../common/apply_update":10,"../../../common/array/map":13,"../common":1,"./helpers":5}],7:[function(require,module,exports){
'use strict'

var assign = require('../common/assign')


/**
 * Adapter is an abstract base class containing methods to be implemented. All
 * records returned by the adapter must have the primary key `id`. The primary
 * key **MUST** be a string or a number.
 */
function Adapter (properties) {
  assign(this, properties)
}


/**
 * The Adapter should not be instantiated directly, since the constructor
 * function accepts dependencies. The keys which are injected are:
 *
 * - `methods`: same as static property on Fortune class.
 * - `errors`: same as static property on Fortune class.
 * - `keys`: an object which enumerates reserved constants for record type
 * definitions.
 * - `recordTypes`: an object which enumerates record types and their
 * definitions.
 * - `options`: the options passed to the adapter.
 * - `message`: a function with the signature (`id`, `language`, `data`).
 * - `Promise`: the Promise implementation.
 *
 * These keys are accessible on the instance (`this`).
 */
Adapter.prototype.constructor = function () {
  // This exists here only for documentation purposes.
}

delete Adapter.prototype.constructor


/**
 * The responsibility of this method is to ensure that the record types
 * defined are consistent with the backing data store. If there is any
 * mismatch it should either try to reconcile differences or fail.
 * This method **SHOULD NOT** be called manually, and it should not accept
 * any parameters. This is the time to do setup tasks like create tables,
 * ensure indexes, etc. On successful completion, it should resolve to no
 * value.
 *
 * @return {Promise}
 */
Adapter.prototype.connect = function () {
  return Promise.resolve()
}


/**
 * Close the database connection.
 *
 * @return {Promise}
 */
Adapter.prototype.disconnect = function () {
  return Promise.resolve()
}


/**
 * Create records. A successful response resolves to the newly created
 * records.
 *
 * **IMPORTANT**: the record must have initial values for each field defined
 * in the record type. For non-array fields, it should be `null`, and for
 * array fields it should be `[]` (empty array). Note that not all fields in
 * the record type may be enumerable, such as denormalized inverse fields, so
 * it may be necessary to iterate over fields using
 * `Object.getOwnPropertyNames`.
 *
 * @param {String} type
 * @param {Object[]} records
 * @param {Object} [meta]
 * @return {Promise}
 */
Adapter.prototype.create = function () {
  return Promise.resolve([])
}


/**
 * Find records by IDs and options. If IDs is undefined, it should try to
 * return all records. However, if IDs is an empty array, it should be a
 * no-op. The format of the options may be as follows:
 *
 * ```js
 * {
 *   sort: { ... },
 *   fields: { ... },
 *   exists: { ... },
 *   match: { ... },
 *   range: { ... },
 *
 *   // Limit results to this number. Zero means no limit.
 *   limit: 0,
 *
 *   // Offset results by this much from the beginning.
 *   offset: 0,
 *
 *   // Reserved field for custom querying.
 *   query: null
 * }
 * ```
 *
 * For the fields `exists`, `match`, and `range`, the logical operator should
 * be "and". The `query` field may be used on a per adapter basis to provide
 * custom querying functionality.
 *
 * The syntax of the `sort` object is as follows:
 *
 * ```js
 * {
 *   age: false, // descending
 *   name: true // ascending
 * }
 * ```
 *
 * Fields can be specified to be either included or omitted, but not both.
 * Use the values `true` to include, or `false` to omit. The syntax of the
 * `fields` object is as follows:
 *
 * ```js
 * {
 *   name: true, // include this field
 *   age: true // also include this field
 * }
 * ```
 *
 * The `exists` object specifies if a field should exist or not (`true` or
 * `false`). For array fields, it should check for non-zero length.
 *
 * ```js
 * {
 *   name: true, // check if this fields exists
 *   age: false // check if this field doesn't exist
 * }
 * ```
 *
 * The syntax of the `match` object is straightforward:
 *
 * ```js
 * {
 *   name: 'value', // exact match or containment if array
 *   friends: [ 'joe', 'bob' ] // match any one of these values
 * }
 * ```
 *
 * The `range` object is used to filter between lower and upper bounds. It
 * should take precedence over `match`. For array fields, it should apply on
 * the length of the array. For singular link fields, it should not apply.
 *
 * ```js
 * {
 *   range: { // Ranges should be inclusive.
 *     age: [ 18, null ], // From 18 and above.
 *     name: [ 'a', 'd' ], // Starting with letters A through C.
 *     createdAt: [ null, new Date(2016, 0) ] // Dates until 2016.
 *   }
 * }
 * ```
 *
 * The return value of the promise should be an array, and the array **MUST**
 * have a `count` property that is the total number of records without limit
 * and offset.
 *
 * @param {String} type
 * @param {String[]|Number[]} [ids]
 * @param {Object} [options]
 * @param {Object} [meta]
 * @return {Promise}
 */
Adapter.prototype.find = function () {
  var results = []
  results.count = 0
  return Promise.resolve(results)
}


/**
 * Update records by IDs. Success should resolve to the number of records
 * updated. The `updates` parameter should be an array of objects that
 * correspond to updates by IDs. Each update object must be as follows:
 *
 * ```js
 * {
 *   // ID to update. Required.
 *   id: 1,
 *
 *   // Replace a value of a field. Use a `null` value to unset a field.
 *   replace: { name: 'Bob' },
 *
 *   // Append values to an array field. If the value is an array, all of
 *   // the values should be pushed.
 *   push: { pets: 1 },
 *
 *   // Remove values from an array field. If the value is an array, all of
 *   // the values should be removed.
 *   pull: { friends: [ 2, 3 ] },
 *
 *   // The `operate` field is specific to the adapter. This should take
 *   // precedence over all of the above. Warning: using this may bypass
 *   // field definitions and referential integrity. Use at your own risk.
 *   operate: null
 * }
 * ```
 *
 * Things to consider:
 *
 * - `push` and `pull` can not be applied to non-arrays.
 * - The same value in the same field should not exist in both `push` and
 * `pull`.
 *
 * @param {String} type
 * @param {Object[]} updates
 * @param {Object} [meta]
 * @return {Promise}
 */
Adapter.prototype.update = function () {
  return Promise.resolve(0)
}


/**
 * Delete records by IDs, or delete the entire collection if IDs are
 * undefined or empty. Success should resolve to the number of records
 * deleted.
 *
 * @param {String} type
 * @param {String[]|Number[]} [ids]
 * @param {Object} [meta]
 * @return {Promise}
 */
Adapter.prototype.delete = function () {
  return Promise.resolve(0)
}


/**
 * Begin a transaction to write to the data store. This method is optional
 * to implement, but useful for ACID. It should resolve to an object
 * containing all of the adapter methods.
 *
 * @return {Promise}
 */
Adapter.prototype.beginTransaction = function () {
  return Promise.resolve(this)
}


/**
 * End a transaction. This method is optional to implement.
 * It should return a Promise with no value if the transaction is
 * completed successfully, or reject the promise if it failed.
 *
 * @param {Error} [error] - If an error is passed, roll back the transaction.
 * @return {Promise}
 */
Adapter.prototype.endTransaction = function () {
  return Promise.resolve()
}


/**
 * Apply operators on a record, then return the record. If you make use of
 * update operators, you should implement this method so that the internal
 * implementation of update requests get records in the correct state. This
 * method is optional to implement.
 *
 * @param {Object} record
 * @param {Object} operators - The `operate` field on an `update` object.
 * @return {Object}
 */
Adapter.prototype.applyOperators = function (record) {
  return record
}


module.exports = Adapter

},{"../common/assign":17}],8:[function(require,module,exports){
'use strict'

var Adapter = require('./')
var errors = require('../common/errors')
var keys = require('../common/keys')
var message = require('../common/message')
var promise = require('../common/promise')


/**
 * A singleton for the adapter. For internal use.
 */
function AdapterSingleton (properties) {
  var CustomAdapter, input

  input = Array.isArray(properties.adapter) ?
    properties.adapter : [ properties.adapter ]

  if (typeof input[0] !== 'function')
    throw new TypeError('The adapter must be a function.')

  CustomAdapter = Adapter.prototype
    .isPrototypeOf(input[0].prototype) ? input[0] : input[0](Adapter)

  if (!Adapter.prototype.isPrototypeOf(CustomAdapter.prototype))
    throw new TypeError('The adapter must inherit the Adapter class.')

  return new CustomAdapter({
    options: input[1] || {},
    recordTypes: properties.recordTypes,
    errors: errors,
    keys: keys,
    message: message,
    Promise: promise.Promise
  })
}


module.exports = AdapterSingleton

},{"../common/errors":21,"../common/keys":23,"../common/message":24,"../common/promise":26,"./":7}],9:[function(require,module,exports){
'use strict'

// Local modules.
var Core = require('./core')
var promise = require('./common/promise')
var assign = require('./common/assign')

// Static exports.
var memory = require('./adapter/adapters/memory')
var indexedDB = require('./adapter/adapters/indexeddb')
var request = require('./net/websocket_request')
var client = require('./net/websocket_client')
var sync = require('./net/websocket_sync')

var adapters = {
  memory: memory,
  indexedDB: indexedDB
}

var net = {
  request: request,
  client: client,
  sync: sync
}


/**
 * This class just extends Core with some default serializers and static
 * properties.
 */
function Fortune (recordTypes, options) {
  if (!(this instanceof Fortune)) return new Fortune(recordTypes, options)

  if (options === void 0) options = {}

  // Try to use IndexedDB first, fall back to memory adapter.
  if (!('adapter' in options))
    options.adapter = [ indexedDB ]

  if (!('settings' in options))
    options.settings = {}

  if (!('enforceLinks' in options.settings))
    options.settings.enforceLinks = false

  return this.constructor(recordTypes, options)
}


Fortune.prototype = Object.create(Core.prototype)

assign(Fortune, Core)


// Assigning the Promise implementation.
Object.defineProperty(Fortune, 'Promise', {
  enumerable: true,
  get: function () {
    return promise.Promise
  },
  set: function (x) {
    promise.Promise = x
  }
})


// Assign useful static properties to the default export.
assign(Fortune, {
  adapters: adapters,
  net: net
})


module.exports = Fortune

},{"./adapter/adapters/indexeddb":3,"./adapter/adapters/memory":6,"./common/assign":17,"./common/promise":26,"./core":28,"./net/websocket_client":40,"./net/websocket_request":41,"./net/websocket_sync":42}],10:[function(require,module,exports){
'use strict'

var pull = require('./array/pull')


/**
 * Given a record and an update object, apply the update on the record. Note
 * that the `operate` object is unapplied here.
 *
 * @param {Object} record
 * @param {Object} update
 */
module.exports = function applyUpdate (record, update) {
  var field

  for (field in update.replace)
    record[field] = update.replace[field]

  for (field in update.push)
    record[field] = record[field] ?
      record[field].concat(update.push[field]) :
      [].concat(update.push[field])

  for (field in update.pull)
    record[field] = record[field] ?
      pull(record[field], update.pull[field]) : []
}

},{"./array/pull":14}],11:[function(require,module,exports){
'use strict'

/**
 * A more performant `Array.prototype.find`.
 *
 * @param {*[]} array
 * @param {Function} fn
 * @return {*}
 */
module.exports = function find (array, fn) {
  var i, j, value, result

  for (i = 0, j = array.length; i < j; i++) {
    value = array[i]
    result = fn(value)
    if (result) return value
  }

  return void 0
}

},{}],12:[function(require,module,exports){
'use strict'

/**
 * A more performant `Array.prototype.includes`.
 *
 * @param {*[]} array
 * @param {*} value
 * @return {Boolean}
 */
module.exports = function includes (array, value) {
  var i, j

  for (i = 0, j = array.length; i < j; i++)
    if (array[i] === value) return true

  return false
}

},{}],13:[function(require,module,exports){
'use strict'

/**
 * A more performant `Array.prototype.map`.
 *
 * @param {*[]} array
 * @param {Function} fn
 * @return {Boolean}
 */
module.exports = function map (array, fn) {
  var i, j, k = [], l = 0

  for (i = 0, j = array.length; i < j; i++)
    k[l++] = fn(array[i], i, array)

  return k
}

},{}],14:[function(require,module,exports){
'use strict'


/**
 * Pull primitive values from an array.
 *
 * @param {*[]} array
 * @param {*|*[]} values
 * @return {*[]}
 */
module.exports = function pull (array, values) {
  var hash = {}, clone = [], value
  var i, j

  if (Array.isArray(values))
    for (i = 0, j = values.length; i < j; i++)
      hash[values[i]] = true
  else hash[values] = true

  // Need to iterate backwards.
  for (i = array.length; i--;) {
    value = array[i]
    if (!(value in hash)) clone.push(value)
  }

  return clone
}

},{}],15:[function(require,module,exports){
'use strict'

/**
 * A more performant `Array.prototype.reduce`.
 *
 * @param {*[]} array
 * @param {Function} fn
 * @param {*} [initialValue]
 * @return {Boolean}
 */
module.exports = function reduce (array, fn, initialValue) {
  var i, j, k = initialValue

  for (i = 0, j = array.length; i < j; i++)
    k = fn(k, array[i], i, array)

  return k
}

},{}],16:[function(require,module,exports){
'use strict'

/**
 * Return an array with unique values. Values must be primitive, and the array
 * may not be sparse.
 *
 * @param {Array}
 * @return {Array}
 */
module.exports = function unique (a) {
  var seen = {}
  var result = []
  var i, j, k

  for (i = 0, j = a.length; i < j; i++) {
    k = a[i]
    if (k in seen) continue
    result.push(k)
    seen[k] = true
  }

  return result
}

},{}],17:[function(require,module,exports){
'use strict'

/**
 * Like `Object.assign`, but faster and more restricted in what it does.
 *
 * @param {Object} target
 * @return {Object}
 */
module.exports = function assign (target) {
  var i, j, key, source

  for (i = 1, j = arguments.length; i < j; i++) {
    source = arguments[i]

    if (source == null) continue

    for (key in source)
      target[key] = source[key]
  }

  return target
}

},{}],18:[function(require,module,exports){
'use strict'

/**
 * A fast deep clone function, which covers mostly serializable objects.
 *
 * @param {*}
 * @return {*}
 */
module.exports = function clone (input) {
  var output, key, value, isArray

  if (Array.isArray(input)) isArray = true
  else if (input == null || Object.getPrototypeOf(input) !== Object.prototype)
    return input

  output = isArray ? [] : {}

  for (key in input) {
    value = input[key]
    output[key] = value != null &&
      Object.getPrototypeOf(value) === Object.prototype ||
      Array.isArray(value) ? clone(value) : value
  }

  return output
}

},{}],19:[function(require,module,exports){
'use strict'

// The primary key that must exist per record, can not be user defined.
exports.primary = 'id'

// The names of certain reserved keys per field definition.
exports.type = 'type'
exports.link = 'link'
exports.inverse = 'inverse'
exports.isArray = 'isArray'

// Should be reserved for private use.
exports.denormalizedInverse = '__denormalizedInverse__'

// Events.
exports.change = 'change'
exports.sync = 'sync'
exports.connect = 'connect'
exports.disconnect = 'disconnect'
exports.failure = 'failure'

// Methods.
exports.find = 'find'
exports.create = 'create'
exports.update = 'update'
exports.delete = 'delete'

},{}],20:[function(require,module,exports){
(function (Buffer){
'use strict'

/**
 * A fast recursive equality check, which covers limited use cases.
 *
 * @param {Object}
 * @param {Object}
 * @return {Boolean}
 */
function deepEqual (a, b) {
  var key, value, compare, aLength = 0, bLength = 0

  // If they are the same object, don't need to go further.
  if (a === b) return true

  // Both objects must be defined.
  if (!a || !b) return false

  // Objects must be of the same type.
  if (a.prototype !== b.prototype) return false

  for (key in a) {
    aLength++
    value = a[key]
    compare = b[key]

    if (typeof value === 'object') {
      if (typeof compare !== 'object' || !deepEqual(value, compare))
        return false
      continue
    }

    if (Buffer.isBuffer(value)) {
      if (!Buffer.isBuffer(compare) || !value.equals(compare))
        return false
      continue
    }

    if (value && typeof value.getTime === 'function') {
      if (!compare || typeof compare.getTime !== 'function' ||
        value.getTime() !== compare.getTime())
        return false
      continue
    }

    if (value !== compare) return false
  }

  for (key in b) bLength++

  // Keys must be of same length.
  return aLength === bLength
}


module.exports = deepEqual

}).call(this,{"isBuffer":require("../../node_modules/is-buffer/index.js")})
},{"../../node_modules/is-buffer/index.js":53}],21:[function(require,module,exports){
'use strict'

var responseClass = require('./response_classes')

exports.BadRequestError = responseClass.BadRequestError
exports.UnauthorizedError = responseClass.UnauthorizedError
exports.ForbiddenError = responseClass.ForbiddenError
exports.NotFoundError = responseClass.NotFoundError
exports.MethodError = responseClass.MethodError
exports.NotAcceptableError = responseClass.NotAcceptableError
exports.ConflictError = responseClass.ConflictError
exports.UnsupportedError = responseClass.UnsupportedError
exports.nativeErrors = responseClass.nativeErrors

},{"./response_classes":27}],22:[function(require,module,exports){
'use strict'

var constants = require('./constants')

exports.change = constants.change
exports.sync = constants.sync
exports.connect = constants.connect
exports.disconnect = constants.disconnect
exports.failure = constants.failure

},{"./constants":19}],23:[function(require,module,exports){
'use strict'

var constants = require('./constants')

exports.primary = constants.primary
exports.type = constants.type
exports.link = constants.link
exports.isArray = constants.isArray
exports.inverse = constants.inverse
exports.denormalizedInverse = constants.denormalizedInverse

},{"./constants":19}],24:[function(require,module,exports){
'use strict'

var genericMessage = 'GenericError'

module.exports = message


/**
 * Message function for i18n.
 *
 * @param {String} id
 * @param {String} language
 * @param {Object} [data]
 * @return {String}
 */
function message (id, language, data) {
  var str, key

  if (!language || !(language in message))
    language = message.defaultLanguage

  if (!(id in message[language]))
    return message[language][genericMessage] || message.en[genericMessage]

  str = message[language][id]

  for (key in data) str = str.replace('{' + key + '}', data[key])

  return str
}

// Assign fallback language to "en".
Object.defineProperty(message, 'defaultLanguage', {
  value: 'en', writable: true
})

// Default language messages.
/* eslint-disable max-len */
message.en = {
  'GenericError': 'An internal error occurred.',

   // Various errors.
  'MalformedRequest': 'The request was malformed.',
  'InvalidBody': 'The request body is invalid.',
  'SerializerNotFound': 'The serializer for "{id}" does not exist.',
  'InputOnly': 'Input only.',
  'InvalidID': 'An ID is invalid.',
  'DateISO8601': 'Date string must be an ISO 8601 formatted string.',
  'DateInvalid': 'Date value is invalid.',
  'BufferEncoding': 'Buffer value must be a {bufferEncoding}-encoded string.',
  'JSONParse': 'Could not parse value as JSON.',
  'MissingPayload': 'Payload is missing.',
  'SpecifiedIDs': 'IDs should not be specified.',
  'InvalidURL': 'Invalid URL.',
  'RelatedRecordNotFound': 'A related record for the field "{field}" was not found.',
  'CreateRecordsInvalid': 'There are no valid records to be created.',
  'CreateRecordsFail': 'Records could not be created.',
  'CreateRecordMissingID': 'An ID on a created record is missing.',
  'DeleteRecordsInvalid': 'There are no records to be deleted.',
  'UnspecifiedType': 'The type is unspecified.',
  'InvalidType': 'The requested type "{type}" is not a valid type.',
  'InvalidMethod': 'The method "{method}" is unrecognized.',
  'CollisionToOne': 'Multiple records can not have the same to-one link value on the field "{field}".',
  'CollisionDuplicate': 'Duplicate ID "{id}" in the field "{field}".',
  'UpdateRecordMissing': 'The record to be updated could not be found.',
  'UpdateRecordsInvalid': 'There are no valid updates.',
  'UpdateRecordMissingID': 'An ID on an update is missing.',
  'EnforceArrayType': 'The value of "{key}" is invalid, it must be an array with values of type "{type}".',
  'EnforceArray': 'The value of "{key}" is invalid, it must be an array.',
  'EnforceSameID': 'An ID of "{key}" is invalid, it cannot be the same ID of the record.',
  'EnforceSingular': 'The value of "{key}" can not be an array, it must be a singular value.',
  'EnforceValue': 'The value of "{key}" is invalid, it must be a "{type}".',
  'EnforceValueArray': 'A value in the array of "{key}" is invalid, it must be a "{type}".',
  'FieldsFormat': 'Fields format is invalid. It may either be inclusive or exclusive, but not both.',
  'RecordExists': 'A record with ID "{id}" already exists.',

  // Used for HTML serializer.
  'Index': 'Index',
  'Class': 'Class',
  'Properties': 'Properties',
  'Include': 'Include',
  'QueryOptions': 'Query Options',
  'IncludedLabel': 'included',
  'NoResults': 'No results.',
  'Create': 'Create',
  'Update': 'Update',
  'Delete': 'Delete',
  'True': 'True',
  'False': 'False',
  'IncludePath': 'Path (dot-separated)',
  'Query': 'Query',
  'Fields': 'Fields',
  'Match': 'Match',
  'Sort': 'Sort',
  'Field': 'Field',
  'Pagination': 'Pagination',
  'Limit': 'Limit',
  'Offset': 'Offset'
}
/* eslint-enable max-len */

},{}],25:[function(require,module,exports){
'use strict'

var constants = require('./constants')

exports.find = constants.find
exports.create = constants.create
exports.update = constants.update
exports.delete = constants.delete

},{"./constants":19}],26:[function(require,module,exports){
'use strict'

// This object exists as a container for the Promise implementation. By
// default, it's the native one.
exports.Promise = Promise

},{}],27:[function(require,module,exports){
'use strict'

var errorClass = require('error-class')
var assign = require('./assign')


// Successes.
exports.OK = successClass('OK')
exports.Created = successClass('Created')
exports.Empty = successClass('Empty')


// Errors.
exports.BadRequestError = errorClass('BadRequestError')
exports.UnauthorizedError = errorClass('UnauthorizedError')
exports.ForbiddenError = errorClass('ForbiddenError')
exports.NotFoundError = errorClass('NotFoundError')
exports.MethodError = errorClass('MethodError')
exports.NotAcceptableError = errorClass('NotAcceptableError')
exports.ConflictError = errorClass('ConflictError')
exports.UnsupportedError = errorClass('UnsupportedError')


// White-list native error types. The list is gathered from here:
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/
// Reference/Global_Objects/Error
exports.nativeErrors = [
  Error, TypeError, ReferenceError, RangeError,
  SyntaxError, EvalError, URIError
]


function successClass (name) {
  return Function('assign', // eslint-disable-line
    'return function ' + name + ' (x) { ' +
    'assign(this, x) }')(assign)
}

},{"./assign":17,"error-class":49}],28:[function(require,module,exports){
'use strict'

var EventLite = require('event-lite')

// Local modules.
var memoryAdapter = require('./adapter/adapters/memory')
var AdapterSingleton = require('./adapter/singleton')
var assign = require('./common/assign')
var validate = require('./record_type/validate')
var ensureTypes = require('./record_type/ensure_types')
var dispatch = require('./dispatch')
var promise = require('./common/promise')
var middlewares = dispatch.middlewares

// Static re-exports.
var Adapter = require('./adapter')
var errors = require('./common/errors')
var methods = require('./common/methods')
var events = require('./common/events')
var message = require('./common/message')


/**
 * This is the default export of the `fortune` package. It implements a
 * [subset of `EventEmitter`](https://www.npmjs.com/package/event-lite), and it
 * has a few static properties attached to it that may be useful to access:
 *
 * - `Adapter`: abstract base class for the Adapter.
 * - `adapters`: included adapters, defaults to memory adapter. Note that the
 * browser build also includes `indexedDB` and `webStorage` adapters.
 * - `net`: network protocol helpers, varies based on client or server build.
 * - `errors`: custom typed errors, useful for throwing errors in I/O hook
 * functions.
 * - `methods`: a hash that maps to string constants. Available are: `find`,
 * `create`, `update`, and `delete`.
 * - `events`: names for events on the Fortune instance.
 * - `message`: a function which accepts the arguments (`id`, `language`,
 * `data`). It has properties keyed by two-letter language codes, which by
 * default includes only `en`.
 * - `Promise`: by default, the native Promise implementation is used in the
 * browser, or [Bluebird](https://github.com/petkaantonov/bluebird/) in
 * Node.js. If an alternative is desired, simply assign this property with the
 * new Promise class. This will affect all instances of Fortune.
 */
function Fortune (options) {
  this.constructor(options)
}


// Inherit from EventLite class.
Fortune.prototype = Object.create(EventLite.prototype)


/**
 * Create a new instance, the only required input is record type definitions.
 * The first argument must be an object keyed by name, valued by definition
 * objects.
 *
 * Here are some example field definitions:
 *
 * ```js
 * {
 *   // Top level keys are names of record types.
 *   person: {
 *     // Data types may be singular or plural.
 *     name: String, // Singular string value.
 *     luckyNumbers: Array(Number), // Array of numbers.
 *
 *     // Relationships may be singular or plural. They must specify which
 *     // record type it refers to, and may also specify an inverse field
 *     // which is optional but recommended.
 *     pets: [ Array('animal'), 'owner' ], // Has many.
 *     employer: [ 'organization', 'employees' ], // Belongs to.
 *     likes: Array('thing'), // Has many (no inverse).
 *     doing: 'activity', // Belongs to (no inverse).
 *
 *     // Reflexive relationships are relationships in which the record type,
 *     // the first position, is of the same type.
 *     following: [ Array('person'), 'followers' ],
 *     followers: [ Array('person'), 'following' ],
 *
 *     // Mutual relationships are relationships in which the inverse,
 *     // the second position, is defined to be the same field on the same
 *     // record type.
 *     friends: [ Array('person'), 'friends' ],
 *     spouse: [ 'person', 'spouse' ]
 *   }
 * }
 * ```
 *
 * The above shows the shorthand which will be transformed internally to a
 * more verbose data structure. The internal structure is as follows:
 *
 * ```js
 * {
 *   person: {
 *     // A singular value.
 *     name: { type: String },
 *
 *     // An array containing values of a single type.
 *     luckyNumbers: { type: Number, isArray: true },
 *
 *     // Creates a to-many link to `animal` record type. If the field `owner`
 *     // on the `animal` record type is not an array, this is a many-to-one
 *     // relationship, otherwise it is many-to-many.
 *     pets: { link: 'animal', isArray: true, inverse: 'owner' },
 *
 *     // The `min` and `max` keys are open to interpretation by the specific
 *     // adapter, which may introspect the field definition.
 *     thing: { type: Number, min: 0, max: 100 },
 *
 *     // Nested field definitions are invalid. Use `Object` type instead.
 *     nested: { thing: { ... } } // Will throw an error.
 *   }
 * }
 * ```
 *
 * The allowed native types are `String`, `Number`, `Boolean`, `Date`,
 * `Object`, and `Buffer`. Note that the `Object` type should be a JSON
 * serializable object that may be persisted. The only other allowed type is
 * a `Function`, which may be used to define custom types.
 *
 * A custom type function should accept one argument, the value, and return a
 * boolean based on whether the value is valid for the type or not. It may
 * optionally have a method `compare`, used for sorting in the built-in
 * adapters. The `compare` method should have the same signature as the native
 * `Array.prototype.sort`.
 *
 * A custom type function must inherit one of the allowed native types. For
 * example:
 *
 * ```js
 * function Integer (x) { return (x | 0) === x }
 * Integer.prototype = Object.create(Number.prototype)
 * ```
 *
 * The options object may contain the following keys:
 *
 * - `adapter`: configuration array for the adapter. The default type is the
 *   memory adapter. If the value is not an array, its settings will be
 *   considered omitted.
 *
 *   ```js
 *   {
 *     adapter: [
 *       // Must be a class that extends `Fortune.Adapter`, or a function
 *       // that accepts the Adapter class and returns a subclass. Required.
 *       Adapter => { ... },
 *
 *       // An options object that is specific to the adapter. Optional.
 *       { ... }
 *     ]
 *   }
 *   ```
 *
 * - `hooks`: keyed by type name, valued by an array containing an `input`
 *   and/or `output` function at indices `0` and `1` respectively.
 *
 *   A hook function takes at least two arguments, the internal `context`
 *   object and a single `record`. A special case is the `update` argument for
 *   the `update` method.
 *
 *   There are only two kinds of hooks, before a record is written (input),
 *   and after a record is read (output), both are optional. If an error occurs
 *   within a hook function, it will be forwarded to the response. Use typed
 *   errors to provide the appropriate feedback.
 *
 *   For a create request, the input hook may return the second argument
 *   `record` either synchronously, or asynchronously as a Promise. The return
 *   value of a delete request is inconsequential, but it may return a value or
 *   a Promise. The `update` method accepts a `update` object as a third
 *   parameter, which may be returned synchronously or as a Promise.
 *
 *   An example hook to apply a timestamp on a record before creation, and
 *   displaying the timestamp in the server's locale:
 *
 *   ```js
 *   {
 *     recordType: [
 *       (context, record, update) => {
 *         switch (context.request.method) {
 *           case 'create':
 *             record.timestamp = new Date()
 *             return record
 *           case 'update': return update
 *           case 'delete': return null
 *         }
 *       },
 *       (context, record) => {
 *         record.timestamp = record.timestamp.toLocaleString()
 *         return record
 *       }
 *     ]
 *   }
 *   ```
 *
 *   Requests to update a record will **NOT** have the updates already applied
 *   to the record.
 *
 *   Another feature of the input hook is that it will have access to a
 *   temporary field `context.transaction`. This is useful for ensuring that
 *   bulk write operations are all or nothing. Each request is treated as a
 *   single transaction.
 *
 * - `documentation`: an object mapping names to descriptions. Note that there
 *   is only one namepspace, so field names can only have one description.
 *   This is optional, but useful for the HTML serializer, which also emits
 *   this information as micro-data.
 *
 *   ```js
 *   {
 *     documentation: {
 *       recordType: 'Description of a type.',
 *       fieldName: 'Description of a field.',
 *       anotherFieldName: {
 *         en: 'Two letter language code indicates localized description.'
 *       }
 *     }
 *   }
 *   ```
 *
 * - `settings`: internal settings to configure.
 *
 *   ```js
 *   {
 *     settings: {
 *       // Whether or not to enforce referential integrity. Default: `true`
 *       // for server, `false` for browser.
 *       enforceLinks: true,
 *
 *       // Name of the application used for display purposes.
 *       name: 'My Awesome Application',
 *
 *       // Description of the application used for display purposes.
 *       description: 'media type "application/vnd.micro+json"'
 *     }
 *   }
 *   ```
 *
 * The return value of the constructor is the instance itself.
 *
 * @param {Object} recordTypes
 * @param {Object} [options]
 * @return {Fortune}
 */
Fortune.prototype.constructor = function (recordTypes, options) {
  var self = this
  var adapter, method, stack, flows, type, hooks, i, j

  if (typeof recordTypes !== 'object')
    throw new TypeError('First argument must be an object.')

  if (!Object.keys(recordTypes).length)
    throw new Error('At least one type must be specified.')

  // DEPRECATION: "transforms" has been deprecated in favor of "hooks".
  if ('transforms' in options) options.hooks = options.transforms

  if (!('adapter' in options)) options.adapter = [ memoryAdapter ]
  if (!('settings' in options)) options.settings = {}
  if (!('hooks' in options)) options.hooks = {}
  if (!('enforceLinks' in options.settings))
    options.settings.enforceLinks = true

  // Bind middleware methods to instance.
  flows = {}
  for (method in methods) {
    stack = [ middlewares[method], middlewares.include, middlewares.end ]

    for (i = 0, j = stack.length; i < j; i++)
      stack[i] = bindMiddleware(self, stack[i])

    flows[methods[method]] = stack
  }

  hooks = options.hooks

  // Validate hooks.
  for (type in hooks) {
    if (!(type in recordTypes)) throw new Error(
      'Attempted to define hook on "' + type + '" type ' +
      'which does not exist.')
    if (!Array.isArray(hooks[type]))
      throw new TypeError('Hook value for "' + type + '" type ' +
        'must be an array.')
  }

  // Validate record types.
  for (type in recordTypes) {
    validate(recordTypes[type])
    if (!(type in hooks)) hooks[type] = []
  }

  /*!
   * Adapter singleton that is coupled to the Fortune instance.
   *
   * @type {Adapter}
   */
  adapter = new AdapterSingleton({
    adapter: options.adapter,
    recordTypes: recordTypes,
    hooks: hooks
  })

  // Internal properties.
  Object.defineProperties(self, {
    // 0 = not started, 1 = started, 2 = done.
    connectionStatus: { value: 0, writable: true },

    // Configuration settings.
    options: { value: options },
    hooks: { value: hooks },
    recordTypes: { value: recordTypes, enumerable: true },

    // Singleton instances.
    adapter: { value: adapter, enumerable: true, configurable: true },

    // Dispatch.
    flows: { value: flows }
  })
}


/**
 * This is the primary method for initiating a request. The options object
 * may contain the following keys:
 *
 * - `method`: The method is a either a function or a constant, which is keyed
 *   under `Fortune.methods` and may be one of `find`, `create`, `update`,  or
 *   `delete`. Default: `find`.
 *
 * - `type`: Name of a type. **Required**.
 *
 * - `ids`: An array of IDs. Used for `find` and `delete` methods only. This is
 *   optional for the `find` method.
 *
 * - `include`: A 2-dimensional array specifying links to include. The first
 *   dimension is a list, the second dimension is depth. For example:
 *   `[['comments'], ['comments', 'author', { ... }]]`. The last item within
 *   the list may be an `options` object, useful for specifying how the
 *   included records should appear. Optional.
 *
 * - `options`: Exactly the same as the [`find` method](#adapter-find)
 *   options in the adapter. These options do not apply on methods other than
 *   `find`, and do not affect the records returned from `include`. Optional.
 *
 * - `meta`: Meta-information object of the request. Optional.
 *
 * - `payload`: Payload of the request. **Required** for `create` and `update`
 *   methods only, and must be an array of objects. The objects must be the
 *   records to create, or update objects as expected by the Adapter.
 *
 * The response object may contain the following keys:
 *
 * - `meta`: Meta-info of the response.
 *
 * - `payload`: An object containing the following keys:
 *   - `records`: An array of records returned.
 *   - `count`: Total number of records without options applied (only for
 *     responses to the `find` method).
 *   - `include`: An object keyed by type, valued by arrays of included
 *     records.
 *
 * The resolved response object should always be an instance of a response
 * type.
 *
 * @param {Object} options
 * @return {Promise}
 */
Fortune.prototype.request = function (options) {
  var self = this
  var Promise = promise.Promise
  var connectionStatus = self.connectionStatus

  if (connectionStatus === 0)
    return self.connect()
    .then(function () { return dispatch(self, options) })

  else if (connectionStatus === 1)
    return new Promise(function (resolve, reject) {
      // Wait for changes to connection status.
      self.once(events.failure, function () {
        reject(new Error('Connection failed.'))
      })
      self.once(events.connect, function () {
        resolve(dispatch(self, options))
      })
    })

  return dispatch(self, options)
}


/**
 * The `find` method retrieves record by type given IDs, querying options,
 * or both. It wraps around the `request` method, see the `request` method for
 * documentation on its arguments.
 *
 * @param {String} type
 * @param {*|*[]} [ids]
 * @param {Object} [options]
 * @param {Array[]} [include]
 * @param {Object} [meta]
 * @return {Promise}
 */
Fortune.prototype.find = function () {
  var options = { method: methods.find, type: arguments[0] }

  if (arguments[1] != null) options.ids = Array.isArray(arguments[1]) ?
    arguments[1] : [ arguments[1] ]
  if (arguments[2] != null) options.options = arguments[2]
  if (arguments[3] != null) options.include = arguments[3]
  if (arguments[4] != null) options.meta = arguments[4]

  return this.request(options)
}


/**
 * The `create` method creates records by type given records to create. It
 * wraps around the `request` method, see the request `method` for
 * documentation on its arguments.
 *
 * @param {String} type
 * @param {Object|Object[]} records
 * @param {Array[]} [include]
 * @param {Object} [meta]
 * @return {Promise}
 */
Fortune.prototype.create = function () {
  var options = { method: methods.create, type: arguments[0],
    payload: Array.isArray(arguments[1]) ? arguments[1] : [ arguments[1] ] }

  if (arguments[2] != null) options.include = arguments[2]
  if (arguments[3] != null) options.meta = arguments[3]

  return this.request(options)
}


/**
 * The `update` method updates records by type given update objects. It wraps
 * around the `request` method, see the `request` method for documentation on
 * its arguments.
 *
 * @param {String} type
 * @param {Object|Object[]} updates
 * @param {Array[]} [include]
 * @param {Object} [meta]
 * @return {Promise}
 */
Fortune.prototype.update = function () {
  var options = { method: methods.update, type: arguments[0],
    payload: Array.isArray(arguments[1]) ? arguments[1] : [ arguments[1] ] }

  if (arguments[2] != null) options.include = arguments[2]
  if (arguments[3] != null) options.meta = arguments[3]

  return this.request(options)
}


/**
 * The `delete` method deletes records by type given IDs (optional). It wraps
 * around the `request` method, see the `request` method for documentation on
 * its arguments.
 *
 * @param {String} type
 * @param {*|*[]} [ids]
 * @param {Array[]} [include]
 * @param {Object} [meta]
 * @return {Promise}
 */
Fortune.prototype.delete = function () {
  var options = { method: methods.delete, type: arguments[0] }

  if (arguments[1] != null) options.ids = Array.isArray(arguments[1]) ?
    arguments[1] : [ arguments[1] ]
  if (arguments[2] != null) options.include = arguments[2]
  if (arguments[3] != null) options.meta = arguments[3]

  return this.request(options)
}


/**
 * This method does not need to be called manually, it is automatically called
 * upon the first request if it is not connected already. However, it may be
 * useful if manually reconnect is needed. The resolved value is the instance
 * itself.
 *
 * @return {Promise}
 */
Fortune.prototype.connect = function () {
  var self = this
  var Promise = promise.Promise

  if (self.connectionStatus === 1)
    return Promise.reject(new Error('Connection is in progress.'))

  else if (self.connectionStatus === 2)
    return Promise.reject(new Error('Connection is already done.'))

  self.connectionStatus = 1

  return new Promise(function (resolve, reject) {
    ensureTypes(self.recordTypes)

    self.adapter.connect().then(function () {
      self.connectionStatus = 2
      self.emit(events.connect)
      return resolve(self)
    }, function (error) {
      self.connectionStatus = 0
      self.emit(events.failure)
      return reject(error)
    })
  })
}


/**
 * Close adapter connection, and reset connection state. The resolved value is
 * the instance itself.
 *
 * @return {Promise}
 */
Fortune.prototype.disconnect = function () {
  var self = this
  var Promise = promise.Promise

  if (self.connectionStatus !== 2)
    return Promise.reject(new Error('Instance has not been connected.'))

  self.connectionStatus = 1

  return new Promise(function (resolve, reject) {
    return self.adapter.disconnect().then(function () {
      self.connectionStatus = 0
      self.emit(events.disconnect)
      return resolve(self)
    }, function (error) {
      self.connectionStatus = 2
      self.emit(events.failure)
      return reject(error)
    })
  })
}


// Assign useful static properties to the default export.
assign(Fortune, {
  Adapter: Adapter,
  errors: errors,
  methods: methods,
  message: message,
  events: events
})


// Internal helper function.
function bindMiddleware (scope, method) {
  return function (x) {
    return method.call(scope, x)
  }
}


module.exports = Fortune

},{"./adapter":7,"./adapter/adapters/memory":6,"./adapter/singleton":8,"./common/assign":17,"./common/errors":21,"./common/events":22,"./common/message":24,"./common/methods":25,"./common/promise":26,"./dispatch":35,"./record_type/ensure_types":44,"./record_type/validate":45,"event-lite":50}],29:[function(require,module,exports){
'use strict'

var message = require('../common/message')
var promise = require('../common/promise')
var unique = require('../common/array/unique')
var map = require('../common/array/map')
var includes = require('../common/array/includes')

var errors = require('../common/errors')
var BadRequestError = errors.BadRequestError

var keys = require('../common/keys')
var primaryKey = keys.primary
var linkKey = keys.link
var isArrayKey = keys.isArray
var inverseKey = keys.inverse


/**
 * Ensure referential integrity by checking if related records exist.
 *
 * @param {Object} record
 * @param {Object} fields
 * @param {String[]} links - An array of strings indicating which fields are
 * links. Need to pass this so that it doesn't get computed each time.
 * @param {Object} [meta]
 * @return {Promise}
 */
module.exports = function checkLinks (record, fields, links, meta) {
  var Promise = promise.Promise
  var adapter = this.adapter
  var enforceLinks = this.options.settings.enforceLinks

  return Promise.all(map(links, function (field) {
    var ids = Array.isArray(record[field]) ? record[field] :
      !(field in record) || record[field] === null ? [] : [ record[field] ]
    var fieldLink = fields[field][linkKey]
    var fieldInverse = fields[field][inverseKey]
    var findOptions = { fields: {} }

    // Don't need the entire records.
    findOptions.fields[fieldInverse] = true

    return new Promise(function (resolve, reject) {
      if (!ids.length) return resolve()

      return adapter.find(fieldLink, ids, findOptions, meta)

      .then(function (records) {
        var recordIds, i, j

        if (enforceLinks) {
          recordIds = unique(map(records, function (record) {
            return record[primaryKey]
          }))

          for (i = 0, j = ids.length; i < j; i++)
            if (!includes(recordIds, ids[i]))
              return reject(new BadRequestError(
                message('RelatedRecordNotFound', meta.language,
                  { field: field })
              ))
        }

        return resolve(records)
      })
    })
  }))

  .then(function (partialRecords) {
    var object = {}, records, i, j

    for (i = 0, j = partialRecords.length; i < j; i++) {
      records = partialRecords[i]

      if (records) object[links[i]] =
        fields[links[i]][isArrayKey] ? records : records[0]
    }

    return object
  })
}

},{"../common/array/includes":12,"../common/array/map":13,"../common/array/unique":16,"../common/errors":21,"../common/keys":23,"../common/message":24,"../common/promise":26}],30:[function(require,module,exports){
'use strict'

var validateRecords = require('./validate_records')
var checkLinks = require('./check_links')
var enforce = require('../record_type/enforce')
var message = require('../common/message')
var promise = require('../common/promise')
var map = require('../common/array/map')

var errors = require('../common/errors')
var BadRequestError = errors.BadRequestError

var updateHelpers = require('./update_helpers')
var getUpdate = updateHelpers.getUpdate
var addId = updateHelpers.addId

var constants = require('../common/constants')
var changeEvent = constants.change
var createMethod = constants.create
var updateMethod = constants.update
var primaryKey = constants.primary
var linkKey = constants.link
var inverseKey = constants.inverse
var isArrayKey = constants.isArray
var denormalizedInverseKey = constants.denormalizedInverse


/**
 * Extend context so that it includes the parsed records and create them.
 * This mutates the response object.
 *
 * @return {Promise}
 */
module.exports = function (context) {
  var self = this
  var Promise = promise.Promise
  var adapter = self.adapter
  var recordTypes = self.recordTypes
  var hooks = self.hooks
  var updates = {}
  var links = []
  var transaction, records, type, meta, hook, fields, language

  // Start a promise chain.
  return Promise.resolve(context.request.payload)

  .then(function (payload) {
    var i, j, field

    records = payload

    if (!records || !records.length)
      throw new BadRequestError(message('CreateRecordsInvalid', language))

    type = context.request.type
    meta = context.request.meta
    language = meta.language

    hook = hooks[type]
    fields = recordTypes[type]

    for (field in fields) {
      if (linkKey in fields[field])
        links.push(field)

      // Delete denormalized inverse fields.
      if (denormalizedInverseKey in fields[field])
        for (i = 0, j = records.length; i < j; i++)
          delete records[i][field]
    }

    return adapter.beginTransaction()
  })

  .then(function (result) {
    context.transaction = transaction = result

    return typeof hook[0] === 'function' ?
      Promise.all(map(records, function (record) {
        return hook[0](context, record)
      })) : records
  })

  .then(function (results) {
    return Promise.all(map(results, function (record, i) {
      if (record) records[i] = record
      else record = records[i]

      // Enforce the fields.
      enforce(type, record, fields, meta)

      // Ensure referential integrity.
      return checkLinks.call(self, record, fields, links, meta)
    }))
  })

  .then(function () {
    validateRecords.call(self, records, fields, links, meta)
    return transaction.create(type, records, meta)
  })

  .then(function (createdRecords) {
    var i, j, k, l, m, n, record, field, inverseField,
      linkedType, linkedIsArray, linkedIds, id

    // Update inversely linked records on created records.
    // Trying to batch updates to be as few as possible.
    var idCache = {}

    // Adapter must return something.
    if (!createdRecords.length)
      throw new BadRequestError(message('CreateRecordsFail', language))

    records = createdRecords

    Object.defineProperty(context.response, 'records', {
      configurable: true,
      value: records
    })

    // Iterate over each record to generate updates object.
    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]

      // Each created record must have an ID.
      if (!(primaryKey in record))
        throw new Error(message('CreateRecordMissingID', language))

      for (k = 0, l = links.length; k < l; k++) {
        field = links[k]
        inverseField = fields[field][inverseKey]

        if (!(field in record) || !inverseField) continue

        linkedType = fields[field][linkKey]
        linkedIsArray =
          recordTypes[linkedType][inverseField][isArrayKey]
        linkedIds = Array.isArray(record[field]) ?
          record[field] : [ record[field] ]

        // Do some initialization.
        if (!updates[linkedType]) updates[linkedType] = []
        if (!idCache[linkedType]) idCache[linkedType] = {}

        for (m = 0, n = linkedIds.length; m < n; m++) {
          id = linkedIds[m]
          if (id !== null)
            addId(record[primaryKey],
              getUpdate(linkedType, id, updates, idCache),
              inverseField, linkedIsArray)
        }
      }
    }

    return Promise.all(map(Object.keys(updates), function (type) {
      return updates[type].length ?
        transaction.update(type, updates[type], meta) :
        null
    }))
  })

  .then(function () {
    return transaction.endTransaction()
  })

  // This makes sure to call `endTransaction` before re-throwing the error.
  .catch(function (error) {
    if (transaction) transaction.endTransaction(error)
    throw error
  })

  .then(function () {
    var eventData = {}, currentType

    eventData[createMethod] = {}
    eventData[createMethod][type] = records

    for (currentType in updates) {
      if (!updates[currentType].length) continue
      if (!(updateMethod in eventData)) eventData[updateMethod] = {}
      eventData[updateMethod][currentType] = updates[currentType]
    }

    // Summarize changes during the lifecycle of the request.
    self.emit(changeEvent, eventData)

    return context
  })
}

},{"../common/array/map":13,"../common/constants":19,"../common/errors":21,"../common/message":24,"../common/promise":26,"../record_type/enforce":43,"./check_links":29,"./update_helpers":37,"./validate_records":38}],31:[function(require,module,exports){
'use strict'

var message = require('../common/message')
var promise = require('../common/promise')
var map = require('../common/array/map')

var errors = require('../common/errors')
var NotFoundError = errors.NotFoundError

var updateHelpers = require('./update_helpers')
var getUpdate = updateHelpers.getUpdate
var removeId = updateHelpers.removeId

var constants = require('../common/constants')
var changeEvent = constants.change
var deleteMethod = constants.delete
var updateMethod = constants.update
var primaryKey = constants.primary
var linkKey = constants.link
var inverseKey = constants.inverse
var isArrayKey = constants.isArray


/**
 * Delete records. This does not mutate context.
 *
 * @return {Promise}
 */
module.exports = function (context) {
  var self = this
  var Promise = promise.Promise
  var request = context.request
  var type = request.type
  var ids = request.ids
  var meta = request.meta
  var language = meta.language
  var adapter = self.adapter
  var recordTypes = self.recordTypes
  var hooks = self.hooks
  var updates = {}
  var fields = recordTypes[type]
  var hook = hooks[type]
  var links = []
  var transaction, field, records

  for (field in fields)
    if (linkKey in fields[field]) links.push(field)

  return (ids ? adapter.find(type, ids, null, meta) : Promise.resolve())

  .then(function (foundRecords) {
    records = foundRecords

    if (ids) {
      if (!records.length)
        throw new NotFoundError(message('DeleteRecordsInvalid', language))

      Object.defineProperty(context.response, 'records', {
        configurable: true,
        value: records
      })
    }

    return adapter.beginTransaction()
  })

  .then(function (result) {
    context.transaction = transaction = result

    return typeof hook[0] === 'function' ?
      Promise.all(map(records, function (record) {
        return hook[0](context, record)
      })) : records
  })

  .then(function () {
    return transaction.delete(type, ids, meta)
  })

  .then(function (count) {
    var i, j, k, l, m, n, record, field, id, inverseField,
      linkedType, linkedIsArray, linkedIds

    // Remove all instances of the deleted IDs in all records.
    var idCache = {}

    // If IDs were not specified, show the count of records deleted.
    if (!ids) {
      records = []
      records.count = count
      Object.defineProperty(context.response, 'records', {
        configurable: true,
        value: records
      })
    }

    // Loop over each record to generate updates object.
    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]
      for (k = 0, l = links.length; k < l; k++) {
        field = links[k]
        inverseField = fields[field][inverseKey]

        if (!(field in record) || !inverseField) continue

        linkedType = fields[field][linkKey]
        linkedIsArray = recordTypes[linkedType][inverseField][isArrayKey]
        linkedIds = Array.isArray(record[field]) ?
          record[field] : [ record[field] ]

        // Do some initialization.
        if (!updates[linkedType]) updates[linkedType] = []
        if (!idCache[linkedType]) idCache[linkedType] = {}

        for (m = 0, n = linkedIds.length; m < n; m++) {
          id = linkedIds[m]
          if (id !== null)
            removeId(record[primaryKey],
              getUpdate(linkedType, id, updates, idCache),
              inverseField, linkedIsArray)
        }
      }
    }

    return Promise.all(map(Object.keys(updates), function (type) {
      return updates[type].length ?
        transaction.update(type, updates[type], meta) :
        null
    }))
  })

  .then(function () {
    return transaction.endTransaction()
  })

  // This makes sure to call `endTransaction` before re-throwing the error.
  .catch(function (error) {
    if (transaction) transaction.endTransaction(error)
    throw error
  })

  .then(function () {
    var eventData = {}, currentType

    eventData[deleteMethod] = {}
    eventData[deleteMethod][type] = ids

    for (currentType in updates) {
      if (!updates[currentType].length) continue
      if (!(updateMethod in eventData)) eventData[updateMethod] = {}
      eventData[updateMethod][currentType] = updates[currentType]
    }

    // Summarize changes during the lifecycle of the request.
    self.emit(changeEvent, eventData)

    return context
  })
}

},{"../common/array/map":13,"../common/constants":19,"../common/errors":21,"../common/message":24,"../common/promise":26,"./update_helpers":37}],32:[function(require,module,exports){
'use strict'

var map = require('../common/array/map')
var promise = require('../common/promise')


/**
 * Apply `output` hook per record, this mutates `context.response`.
 *
 * @return {Promise}
 */
module.exports = function (context) {
  var Promise = promise.Promise
  var hooks = this.hooks
  var request = context.request
  var response = context.response
  var type = request.type
  var hook = hooks[type]
  var records = response.records
  var include = response.include

  // Delete temporary keys.
  delete response.records
  delete response.include

  // Delete this key as well, since the transaction should already be ended
  // at this point.
  delete context.transaction

  // Run hooks on primary type.
  return (records ? Promise.all(map(records, function (record) {
    return Promise.resolve(typeof hook[1] === 'function' ?
      hook[1](context, record) : record)
  }))

  .then(function (updatedRecords) {
    var includeTypes
    var i, j

    for (i = 0, j = updatedRecords.length; i < j; i++)
      if (updatedRecords[i]) records[i] = updatedRecords[i]

    if (!include) return void 0

    // The order of the keys and their corresponding indices matter.
    includeTypes = Object.keys(include)

    // Run output hooks per include type.
    return Promise.all(map(includeTypes, function (includeType) {
      return Promise.all(map(include[includeType], function (record) {
        return Promise.resolve(
          typeof hooks[includeType][1] === 'function' ?
            hooks[includeType][1](context, record) : record)
      }))
    }))

    .then(function (types) {
      var i, j, k, l

      // Assign results of output hooks on includes.
      for (i = 0, j = types.length; i < j; i++)
        for (k = 0, l = types[i].length; k < l; k++)
          if (types[i][k]) include[includeTypes[i]][k] = types[i][k]
    })
  }) : Promise.resolve())

  .then(function () {
    context.response.payload = {
      records: records
    }

    if (include) context.response.payload.include = include

    // Expose the "count" property so that it is serializable.
    if (records && 'count' in records)
      context.response.payload.count = records.count

    return context
  })
}

},{"../common/array/map":13,"../common/promise":26}],33:[function(require,module,exports){
'use strict'

/**
 * Fetch the primary records. This mutates `context.response`
 * for the next method.
 *
 * @return {Promise}
 */
module.exports = function (context) {
  var adapter = this.adapter
  var request = context.request
  var type = request.type
  var ids = request.ids
  var options = request.options
  var meta = request.meta

  if (!type) return context

  return adapter.find(type, ids, options, meta)
  .then(function (records) {
    Object.defineProperty(context.response, 'records', {
      configurable: true,
      value: records
    })

    return context
  })
}

},{}],34:[function(require,module,exports){
'use strict'

var promise = require('../common/promise')
var map = require('../common/array/map')
var find = require('../common/array/find')
var reduce = require('../common/array/reduce')

var errors = require('../common/errors')
var BadRequestError = errors.BadRequestError

var keys = require('../common/keys')
var primaryKey = keys.primary
var linkKey = keys.link


/**
 * Fetch included records. This mutates `context`.response`
 * for the next method.
 *
 * @return {Promise}
 */
module.exports = function include (context) {
  var Promise = promise.Promise
  var request = context.request
  var type = request.type
  var ids = request.ids || []
  var include = request.include
  var meta = request.meta
  var response = context.response
  var records = response.records
  var recordTypes = this.recordTypes
  var adapter = this.adapter
  var i, j, record, id

  // This cache is used to keep unique IDs per type.
  var idCache = {}
  idCache[type] = {}
  for (i = 0, j = ids.length; i < j; i++)
    idCache[type][ids[i]] = true

  if (!type || !include || !records) return context

  // It's necessary to iterate over primary records if no IDs were
  // provided initially.
  if (ids && !ids.length)
    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]
      id = record[primaryKey]
      if (!idCache[type][id]) idCache[type][id] = true
    }

  return Promise.all(map(include, function (fields) {
    return new Promise(function (resolve, reject) {
      var currentType = type
      var currentIds = []
      var currentCache, currentOptions, currentField, includeOptions

      if (typeof fields[fields.length - 1] === 'object') {
        includeOptions = fields[fields.length - 1]

        // Clone the fields array without options.
        fields = fields.slice(0, -1)
      }

      // Ensure that the first level field is in the record.
      return Promise.all(map(records, function (record) {
        var options

        if (!(fields[0] in record)) {
          options = { fields: {} }
          options.fields[fields[0]] = true

          return adapter.find(type, [ record[primaryKey] ], options, meta)
          .then(function (records) { return records[0] })
        }

        return record
      }))

      .then(function (records) {
        // `cursor` refers to the current collection of records.
        return reduce(fields, function (records, field, index) {
          return records.then(function (cursor) {
            currentField = recordTypes[currentType][field]

            if (!currentType || !currentField) return []
            if (!(linkKey in currentField)) throw new BadRequestError(
              'The field "' + field + '" does not define a link.')

            currentCache = {}
            currentType = currentField[linkKey]
            currentIds = reduce(cursor, function (ids, record) {
              var linkedIds = Array.isArray(record[field]) ?
                record[field] : [ record[field] ]
              var i, j, id

              for (i = 0, j = linkedIds.length; i < j; i++) {
                id = linkedIds[i]
                if (id && !currentCache[id]) {
                  currentCache[id] = true
                  ids.push(id)
                }
              }

              return ids
            }, [])

            if (index === fields.length - 1)
              currentOptions = includeOptions
            else {
              currentOptions = { fields: {} }
              currentOptions.fields[fields[index + 1]] = true
            }

            return currentIds.length ?
              adapter.find(currentType, currentIds, currentOptions, meta) :
              []
          })
        }, Promise.resolve(records))
      })

      .then(function (records) {
        return resolve({
          type: currentType,
          ids: currentIds,
          records: records
        })
      }, function (error) {
        return reject(error)
      })
    })
  }))

  .then(function (containers) {
    var include = reduce(containers, function (include, container) {
      var i, j, id, record

      if (!container.ids.length) return include

      if (!include[container.type])
        include[container.type] = []

      // Only include unique IDs per type.
      if (!idCache[container.type])
        idCache[container.type] = {}

      for (i = 0, j = container.ids.length; i < j; i++) {
        id = container.ids[i]

        if (idCache[container.type][id]) continue

        record = find(container.records, matchId(id))

        if (record) {
          idCache[container.type][id] = true
          include[container.type].push(record)
        }
      }

      // If nothing so far, delete the type from include.
      if (!include[container.type].length)
        delete include[container.type]

      return include
    }, {})

    if (Object.keys(include).length)
      Object.defineProperty(context.response, 'include', {
        configurable: true,
        value: include
      })

    return context
  })
}


function matchId (id) {
  return function (record) {
    return record[primaryKey] === id
  }
}

},{"../common/array/find":11,"../common/array/map":13,"../common/array/reduce":15,"../common/errors":21,"../common/keys":23,"../common/promise":26}],35:[function(require,module,exports){
'use strict'

var promise = require('../common/promise')
var assign = require('../common/assign')
var unique = require('../common/array/unique')
var message = require('../common/message')

var responseClass = require('../common/response_classes')
var BadRequestError = responseClass.BadRequestError
var NotFoundError = responseClass.NotFoundError
var MethodError = responseClass.MethodError
var OK = responseClass.OK
var Empty = responseClass.Empty
var Created = responseClass.Created

var methods = require('../common/methods')
var findMethod = methods.find
var createMethod = methods.create


/*!
 * Internal function to dispatch a request.
 *
 * @param {Object} scope
 * @param {Object} options
 * @return {Promise}
 */
function dispatch (scope, options) {
  var flows = scope.flows
  var recordTypes = scope.recordTypes
  var Promise = promise.Promise
  var context = setDefaults(options)

  // Start a promise chain.
  return Promise.resolve(context)

  .then(function (context) {
    var method = context.request.method
    var type = context.request.type
    var ids = context.request.ids
    var language = context.request.meta.language
    var chain, flow, error, i, j

    // Set the language.
    language = context.request.meta.language

    // Make sure that IDs are an array of unique values.
    if (ids) context.request.ids = unique(ids)

    // If a type is unspecified, block the request.
    if (type === null) {
      error = new BadRequestError(message('UnspecifiedType', language))
      error.isTypeUnspecified = true
      throw error
    }

    // If a type is specified and it doesn't exist, block the request.
    if (!(type in recordTypes))
      throw new NotFoundError(
        message('InvalidType', language, { type: type }))

    // Block invalid method.
    if (!(method in flows))
      throw new MethodError(
        message('InvalidMethod', language, { method: method }))

    chain = Promise.resolve(context)
    flow = flows[method]

    for (i = 0, j = flow.length; i < j; i++)
      chain = chain.then(flow[i])

    return chain
  })

  .then(function (context) {
    var method = context.request.method
    var response = context.response
    var payload = response.payload

    if (!payload) return new Empty(response)
    if (method === createMethod) return new Created(response)

    return new OK(response)
  })

  .catch(function (error) {
    throw assign(error, context.response)
  })
}


// Re-exporting internal middlewares.
dispatch.middlewares = {
  create: require('./create'),
  'delete': require('./delete'),
  update: require('./update'),
  find: require('./find'),
  include: require('./include'),
  end: require('./end')
}


/*!
 * Set default options on a context's request. For internal use.
 *
 * @param {Object} [options]
 * @return {Object}
 */
function setDefaults (options) {
  var context = {
    request: {
      method: findMethod,
      type: null,
      ids: null,
      options: {},
      include: [],
      meta: {},
      payload: null
    },
    response: {
      meta: {},
      payload: null
    }
  }

  assign(context.request, options)

  return context
}


module.exports = dispatch

},{"../common/array/unique":16,"../common/assign":17,"../common/message":24,"../common/methods":25,"../common/promise":26,"../common/response_classes":27,"./create":30,"./delete":31,"./end":32,"./find":33,"./include":34,"./update":36}],36:[function(require,module,exports){
'use strict'

var deepEqual = require('../common/deep_equal')
var assign = require('../common/assign')
var clone = require('../common/clone')
var validateRecords = require('./validate_records')
var checkLinks = require('./check_links')
var enforce = require('../record_type/enforce')
var message = require('../common/message')
var promise = require('../common/promise')
var applyUpdate = require('../common/apply_update')

var updateHelpers = require('./update_helpers')
var getUpdate = updateHelpers.getUpdate
var addId = updateHelpers.addId
var removeId = updateHelpers.removeId

var errors = require('../common/errors')
var NotFoundError = errors.NotFoundError
var BadRequestError = errors.BadRequestError

var find = require('../common/array/find')
var includes = require('../common/array/includes')
var map = require('../common/array/map')

var constants = require('../common/constants')
var changeEvent = constants.change
var updateMethod = constants.update
var primaryKey = constants.primary
var linkKey = constants.link
var inverseKey = constants.inverse
var isArrayKey = constants.isArray
var denormalizedInverseKey = constants.denormalizedInverse


/**
 * Do updates. First, it must find the records to update, then run hooks
 * and validation, then apply the update as well as links on related records.
 *
 * @return {Promise}
 */
module.exports = function (context) {
  var self = this
  var Promise = promise.Promise
  var adapter = self.adapter
  var recordTypes = self.recordTypes
  var hooks = self.hooks

  // Keyed by update, valued by record.
  var updateMap = new WeakMap()

  // Keyed by update, valued by hash of linked records.
  var linkedMap = new WeakMap()

  var relatedUpdates = {}
  var hookedUpdates = []

  var links = []
  var transaction, updates, fields, hook, type, meta, language

  // Start a promise chain.
  return Promise.resolve(context.request.payload)

  .then(function (payload) {
    var i, j, update, field

    updates = payload
    validateUpdates(updates, context.request.meta)

    type = context.request.type
    meta = context.request.meta
    language = meta.language

    fields = recordTypes[type]
    hook = hooks[type]

    // Delete denormalized inverse fields, can't be updated.
    for (field in fields) {
      if (linkKey in fields[field]) links.push(field)
      if (denormalizedInverseKey in fields[field])
        for (i = 0, j = updates.length; i < j; i++) {
          update = updates[i]
          if (update.replace) delete update.replace[field]
          if (update.pull) delete update.pull[field]
          if (update.push) delete update.push[field]
        }
    }

    return adapter.beginTransaction()
  })

  .then(function (result) {
    context.transaction = transaction = result

    return adapter.find(type, map(updates, function (update) {
      return update[primaryKey]
    }), null, meta)
  })

  .then(function (records) {
    return Promise.all(map(records, function (record) {
      var update, cloneUpdate
      var hasHook = typeof hook[0] === 'function'
      var id = record[primaryKey]

      update = find(updates, function (update) {
        return update[primaryKey] === id
      })

      if (!update) throw new NotFoundError(
        message('UpdateRecordMissing', language))

      if (hasHook) cloneUpdate = clone(update)

      return Promise.resolve(hasHook ?
        hook[0](context, record, update) : update)
      .then(function (result) {
        if (result) update = result

        if (hasHook) {
          // Check if the update has been modified or not.
          if (!deepEqual(update, cloneUpdate))
            context.response.meta.updateModified = true

          // Runtime safety check: primary key must be the same.
          if (update[primaryKey] !== id) throw new BadRequestError(
            message('InvalidID', language))
        }

        hookedUpdates.push(update)
        updateMap.set(update, record)

        // Shallow clone the record.
        record = assign({}, record)

        // Apply updates to record.
        applyUpdate(record, update)

        // Apply operators to record.
        if (update.operate)
          record = adapter.applyOperators(record, update.operate)

        // Enforce the fields.
        enforce(type, record, fields, meta)

        // Ensure referential integrity.
        return checkLinks.call(self, record, fields, links, meta)
        .then(function (linked) {
          linkedMap.set(update, linked)
          return record
        })
      })
    }))
  })

  .then(function (records) {
    var i, j

    validateRecords.call(self, records, fields, links, meta)

    Object.defineProperty(context.response, 'records', {
      configurable: true,
      value: records
    })

    // Drop fields in the updates that aren't defined in the record type
    // before doing the update.
    for (i = 0, j = hookedUpdates.length; i < j; i++)
      dropFields(hookedUpdates[i], fields)

    return transaction.update(type, hookedUpdates, meta)
  })

  .then(function () {
    var inverseField, isArray, linkedType, linkedIsArray, linked, record,
      partialRecord, partialRecords, ids, id, push, pull, update, field
    var i, j, k, l, m, n

    // Build up related updates based on update objects.
    var idCache = {}

    // Iterate over each update to generate related updates.
    for (i = 0, j = hookedUpdates.length; i < j; i++) {
      update = hookedUpdates[i]

      for (k = 0, l = links.length; k < l; k++) {
        field = links[k]
        inverseField = fields[field][inverseKey]

        if (!inverseField) continue

        isArray = fields[field][isArrayKey]
        linkedType = fields[field][linkKey]
        linkedIsArray =
          recordTypes[linkedType][inverseField][isArrayKey]

        // Do some initialization.
        if (!relatedUpdates[linkedType]) relatedUpdates[linkedType] = []
        if (!idCache[linkedType]) idCache[linkedType] = {}

        record = updateMap.get(update)
        linked = linkedMap.get(update)

        // Replacing a link field is pretty complicated.
        if (update.replace && field in update.replace) {
          id = update.replace[field]

          if (!Array.isArray(id)) {
            // Don't need to worry about inverse updates if the value does not
            // change.
            if (id === record[field]) continue

            // Set related field.
            if (id !== null)
              addId(update[primaryKey],
                getUpdate(linkedType, id, relatedUpdates, idCache),
                inverseField, linkedIsArray)

            // Unset 2nd degree related record.
            if (field in linked &&
              linked[field][inverseField] !== null &&
              !linkedIsArray &&
              linked[field][inverseField] !== update[primaryKey])
              removeId(id,
                getUpdate(
                  linkedType, linked[field][inverseField],
                  relatedUpdates, idCache),
                inverseField, linkedIsArray)

            // For unsetting, remove ID from related record.
            if (record[field] !== null &&
              record[field] !== update[field] &&
              record[field] !== id)
              removeId(update[primaryKey],
                getUpdate(
                  linkedType, record[field], relatedUpdates, idCache),
                inverseField, linkedIsArray)

            // After this point, there's no need to go over push/pull.
            continue
          }

          ids = id

          // Compute differences for pull, and mutate the update.
          for (m = 0, n = record[field].length; m < n; m++) {
            id = record[field][m]
            if (!includes(ids, id)) {
              if (!('pull' in update)) update.pull = {}
              if (field in update.pull) {
                if (Array.isArray(update.pull[field])) {
                  update.pull[field].push(id)
                  continue
                }
                update.pull[field] = [ update.pull[field], id ]
                continue
              }
              update.pull[field] = [ id ]
            }
          }

          // Compute differences for push, and mutate the update.
          for (m = 0, n = ids.length; m < n; m++) {
            id = ids[m]
            if (!includes(record[field], id)) {
              if (!('push' in update)) update.push = {}
              if (field in update.push) {
                if (Array.isArray(update.push[field])) {
                  update.push[field].push(id)
                  continue
                }
                update.push[field] = [ update.push[field], id ]
                continue
              }
              update.push[field] = [ id ]
            }
          }

          // Delete the original replace, since it is no longer valid.
          delete update.replace[field]
        }

        if (update.pull && update.pull[field]) {
          pull = Array.isArray(update.pull[field]) ?
            update.pull[field] : [ update.pull[field] ]

          for (m = 0, n = pull.length; m < n; m++) {
            id = pull[m]
            if (id !== null)
              removeId(update[primaryKey],
                getUpdate(linkedType, id, relatedUpdates, idCache),
                inverseField, linkedIsArray)
          }
        }

        if (update.push && update.push[field]) {
          push = Array.isArray(update.push[field]) ?
            update.push[field] : [ update.push[field] ]

          for (m = 0, n = push.length; m < n; m++) {
            id = push[m]
            if (id !== null)
              addId(update[primaryKey],
                getUpdate(linkedType, id, relatedUpdates, idCache),
                inverseField, linkedIsArray)
          }
        }

        // Unset from 2nd degree related records.
        if (field in linked && !linkedIsArray) {
          partialRecords = Array.isArray(linked[field]) ?
            linked[field] : [ linked[field] ]

          for (m = 0, n = partialRecords.length; m < n; m++) {
            partialRecord = partialRecords[m]

            if (partialRecord[inverseField] === update[primaryKey])
              continue

            removeId(partialRecord[primaryKey],
              getUpdate(
                type, partialRecord[inverseField],
                relatedUpdates, idCache),
              field, isArray)
          }
        }
      }
    }

    return Promise.all(map(Object.keys(relatedUpdates), function (type) {
      return relatedUpdates[type].length ?
        transaction.update(type, relatedUpdates[type], meta) :
        null
    }))
  })

  .then(function () {
    return transaction.endTransaction()
  })

  // This makes sure to call `endTransaction` before re-throwing the error.
  .catch(function (error) {
    if (transaction) transaction.endTransaction(error)
    throw error
  })

  .then(function () {
    var eventData = {}, linkedType

    eventData[updateMethod] = {}
    eventData[updateMethod][type] = hookedUpdates

    for (linkedType in relatedUpdates) {
      if (!relatedUpdates[linkedType].length) continue

      if (linkedType !== type)
        eventData[updateMethod][linkedType] = relatedUpdates[linkedType]

      // Get the union of update IDs.
      else eventData[updateMethod][type] =
        eventData[updateMethod][type].concat(relatedUpdates[type])
    }

    // Summarize changes during the lifecycle of the request.
    self.emit(changeEvent, eventData)

    return context
  })
}


// Validate updates.
function validateUpdates (updates, meta) {
  var language = meta.language
  var i, j, update

  if (!updates || !updates.length)
    throw new BadRequestError(
      message('UpdateRecordsInvalid', language))

  for (i = 0, j = updates.length; i < j; i++) {
    update = updates[i]
    if (!update[primaryKey])
      throw new BadRequestError(
        message('UpdateRecordMissingID', language))
  }
}


function dropFields (update, fields) {
  var field

  for (field in update.replace)
    if (!(field in fields)) delete update.replace[field]

  for (field in update.pull)
    if (!(field in fields)) delete update.pull[field]

  for (field in update.push)
    if (!(field in fields)) delete update.push[field]
}

},{"../common/apply_update":10,"../common/array/find":11,"../common/array/includes":12,"../common/array/map":13,"../common/assign":17,"../common/clone":18,"../common/constants":19,"../common/deep_equal":20,"../common/errors":21,"../common/message":24,"../common/promise":26,"../record_type/enforce":43,"./check_links":29,"./update_helpers":37,"./validate_records":38}],37:[function(require,module,exports){
'use strict'

var find = require('../common/array/find')

var keys = require('../common/keys')
var primaryKey = keys.primary


// Get a related update object by ID, or return a new one if not found.
exports.getUpdate = function (type, id, updates, cache) {
  var update

  if (cache[type] && cache[type][id])
    return find(updates[type],
      function (update) {
        return update[primaryKey] === id
      })

  update = { id: id }
  if (!updates[type]) updates[type] = []
  updates[type].push(update)
  cache[type] = {}
  cache[type][id] = true
  return update
}


// Add an ID to an update object.
exports.addId = function (id, update, field, isArray) {
  if (isArray) {
    if (!update.push) update.push = {}
    if (!update.push[field]) update.push[field] = []
    update.push[field].push(id)
    return
  }

  if (!update.replace) update.replace = {}
  update.replace[field] = id
}


// Remove an ID from an update object.
exports.removeId = function (id, update, field, isArray) {
  if (isArray) {
    if (!update.pull) update.pull = {}
    if (!update.pull[field]) update.pull[field] = []
    update.pull[field].push(id)
    return
  }

  if (!update.replace) update.replace = {}
  update.replace[field] = null
}

},{"../common/array/find":11,"../common/keys":23}],38:[function(require,module,exports){
'use strict'

var message = require('../common/message')

var errors = require('../common/errors')
var ConflictError = errors.ConflictError

var keys = require('../common/keys')
var linkKey = keys.link
var isArrayKey = keys.isArray
var inverseKey = keys.inverse

/**
 * Do some validation on records to be created or updated to determine
 * if there are any records which have overlapping to-one relationships,
 * or non-unique array relationships.
 *
 * @param {Object[]} records
 * @param {Object} fields
 * @param {Object} links
 * @param {Object} meta
 */
module.exports = function validateRecords (records, fields, links, meta) {
  var recordTypes = this.recordTypes
  var language = meta.language
  var toOneMap = {}
  var i, j, k, l, m, n, value, field, record, id, ids, seen,
    fieldLink, fieldInverse, fieldIsArray, inverseIsArray

  for (i = 0, j = links.length; i < j; i++) {
    field = links[i]
    fieldLink = fields[field][linkKey]
    fieldInverse = fields[field][inverseKey]
    fieldIsArray = fields[field][isArrayKey]
    inverseIsArray = recordTypes[fieldLink][fieldInverse][isArrayKey]

    if (fieldIsArray)
      for (k = 0, l = records.length; k < l; k++) {
        record = records[k]
        if (!Array.isArray(record[field])) continue
        ids = record[field]
        seen = {}

        for (m = 0, n = ids.length; m < n; m++) {
          id = ids[m]
          if (id in seen) throw new ConflictError(
            message('CollisionDuplicate', language, { id: id, field: field }))
          else seen[id] = true
        }
      }

    if (!inverseIsArray) {
      toOneMap[field] = {}

      for (k = 0, l = records.length; k < l; k++) {
        record = records[k]
        value = record[field]
        ids = Array.isArray(value) ? value : value ? [ value ] : []

        for (m = 0, n = ids.length; m < n; m++) {
          id = ids[m]
          if (!(id in toOneMap[field])) toOneMap[field][id] = true
          else throw new ConflictError(
            message('CollisionToOne', language, { field: field }))
        }
      }
    }
  }
}

},{"../common/errors":21,"../common/keys":23,"../common/message":24}],39:[function(require,module,exports){
'use strict'

window.fortune = require('./browser')

},{"./browser":9}],40:[function(require,module,exports){
'use strict'

var core = require('../core')
var wsRequest = require('./websocket_request')


/**
 * Given a W3C WebSocket client, return an object that contains Fortune
 * instance methods `request`, `find`, `create`, `update`, `delete`, and a new
 * method `state` for changing connection state. This is merely a convenience
 * method that wraps around `fortune.net.request`. For example:
 *
 * ```js
 * // https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
 * var client = new WebSocket(url, protocols)
 * var remote = fortune.net.client(client)
 *
 * // `remote` is an object containing Fortune instance methods, and the
 * // `state` method.
 * remote.request(...)
 * remote.state(...)
 * ```
 *
 * @param {WebSocket} client
 * @return {Object}
 */
function client (client) {
  // Using the closure here to refer to the client.
  return {
    request: function request (options) {
      return wsRequest(client, options)
    },
    state: function state (state) {
      return wsRequest(client, null, state)
    },
    find: core.prototype.find,
    create: core.prototype.create,
    update: core.prototype.update,
    delete: core.prototype.delete
  }
}

module.exports = client

},{"../core":28,"./websocket_request":41}],41:[function(require,module,exports){
'use strict'

var msgpack = require('msgpack-lite')
var promise = require('../common/promise')
var common = require('../adapter/adapters/common')
var generateId = common.generateId


/**
 * Given a W3C WebSocket client, send a request using the Fortune wire
 * protocol, and get a response back as a Promise. This will not create a
 * client, it needs to be created externally, and this method will
 * automatically wait if it is not connected yet. For example:
 *
 * ```js
 * // https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
 * var client = new WebSocket(url, protocols)
 * fortune.net.request(client, options)
 * ```
 *
 * The `options` object is exactly the same as that defined by
 * `fortune.request`, and the `state` object is an arbitrary object to send
 * to request a state change. Either `options` or `state` must be passed.
 *
 * @param {WebSocket} client
 * @param {Object} [options]
 * @param {Object} [state]
 * @return {Promise}
 */
function request (client, options, state) {
  var Promise = promise.Promise
  var id = generateId()
  var data = { id: id }
  var readyState = client.readyState
  var rejectListener

  if (options && state) throw new Error('Must specify only options or state.')
  else if (options) data.request = options
  else if (state) data.state = state
  else throw new Error('Missing argument options or state.')

  if (readyState > 1)
    throw new Error('WebSocket Client is closing or has been closed.')

  return (readyState === 0 ? new Promise(function (resolve, reject) {
    rejectListener = reject
    client.addEventListener('open', resolve, { once: true })
    client.addEventListener('error', reject, { once: true })
  }) : Promise.resolve())
  .then(function () {
    client.removeEventListener('error', rejectListener)

    return new Promise(function (resolve, reject) {
      client.binaryType = 'arraybuffer'
      client.addEventListener('message', listener)
      client.send(msgpack.encode(data))

      function listener (event) {
        var data

        if ('decoded' in event) data = event.decoded
        else try {
          data = event.decoded = msgpack.decode(new Uint8Array(event.data))
        }
        catch (error) {
          return reject(error)
        }

        // Ignore other responses.
        if (data.id !== id) return null

        client.removeEventListener('message', listener)

        return 'error' in data ?
          reject(new Error(data.error || 'No error specified.')) :
          resolve(data)
      }
    })
  })
}

module.exports = request

},{"../adapter/adapters/common":1,"../common/promise":26,"msgpack-lite":54}],42:[function(require,module,exports){
'use strict'

var Fortune = require('../core')
var promise = require('../common/promise')
var msgpack = require('msgpack-lite')
var constants = require('../common/constants')
var syncEvent = constants.sync
var failureEvent = constants.failure


/**
 * Given a W3C WebSocket client and an instance of Fortune, try to synchronize
 * records based on the `changes` data pushed from the server. This function
 * returns the event listener function.
 *
 * When a sync is completed, it emits the `sync` event with the changes data,
 * or the `failure` event if something failed.
 *
 * Optionally, a `merge` function may be passed, which accepts one argument,
 * the remote changes, and is expected to return the changes to accept. This
 * is useful for preventing remote changes from overriding local changes.
 *
 * @param {WebSocket} client
 * @param {Fortune} instance
 * @param {Function} [merge]
 * @return {Function}
 */
function sync (client, instance, merge) {
  var Promise = promise.Promise

  if (!(instance instanceof Fortune))
    throw new TypeError('An instance of Fortune is required.')

  client.binaryType = 'arraybuffer'
  client.addEventListener('message', syncListener)

  function syncListener (event) {
    var data, promises = [], changes, method, type

    if ('decoded' in event) data = event.decoded
    else
      try {
        data = event.decoded = msgpack.decode(new Uint8Array(event.data))
      }
      catch (error) {
        return instance.emit(failureEvent, error)
      }

    // Ignore if changes are not present.
    if (!('changes' in data)) return null

    changes = merge === void 0 ? data.changes : merge(data.changes)

    for (method in changes)
      for (type in changes[method])
        promises.push(instance.adapter[method](type, changes[method][type]))

    return Promise.all(promises)
    .then(function () {
      instance.emit(syncEvent, changes)
    }, function (error) {
      instance.emit(failureEvent, error)
    })
  }

  return syncListener
}

module.exports = sync

},{"../common/constants":19,"../common/promise":26,"../core":28,"msgpack-lite":54}],43:[function(require,module,exports){
(function (Buffer){
'use strict'

var message = require('../common/message')
var find = require('../common/array/find')

var errors = require('../common/errors')
var BadRequestError = errors.BadRequestError

var keys = require('../common/keys')
var primaryKey = keys.primary
var typeKey = keys.type
var linkKey = keys.link
var isArrayKey = keys.isArray


// Check input values.
var checkInput = [
  [ String, function (value) {
    return typeof value === 'string'
  } ],
  [ Number, function (value) {
    return typeof value === 'number'
  } ],
  [ Boolean, function (value) {
    return typeof value === 'boolean'
  } ],
  [ Date, function (value) {
    return value && typeof value.getTime === 'function' &&
      !Number.isNaN(value.getTime())
  } ],
  [ Object, function (value) {
    return value !== null && typeof value === 'object'
  } ],
  [ Buffer, function (value) {
    return Buffer.isBuffer(value)
  } ]
]


/**
 * Throw errors for mismatched types on a record.
 *
 * @param {String} type
 * @param {Object} record
 * @param {Object} fields
 * @param {Object} meta
 * @return {Object}
 */
module.exports = function enforce (type, record, fields, meta) {
  var i, j, key, value, fieldDefinition, language

  if (!meta) meta = {}
  language = meta.language

  for (key in record) {
    fieldDefinition = fields[key]

    if (!fieldDefinition) {
      if (key !== primaryKey) delete record[key]
      continue
    }

    value = record[key]

    if (fieldDefinition[typeKey]) {
      if (fieldDefinition[isArrayKey]) {
        // If the field is defined as an array but the value is not,
        // then throw an error.
        if (!Array.isArray(value))
          throw new BadRequestError(message('EnforceArrayType', language, {
            key: key, type: fieldDefinition[typeKey].name
          }))

        for (i = 0, j = value.length; i < j; i++)
          checkValue(fieldDefinition, key, value[i], meta)
      }
      else checkValue(fieldDefinition, key, value, meta)

      continue
    }

    if (fieldDefinition[linkKey]) {
      if (fieldDefinition[isArrayKey]) {
        if (!Array.isArray(value))
          throw new BadRequestError(
            message('EnforceArray', language, { key: key }))

        if (type === fieldDefinition[linkKey] &&
          find(value, matchId(record[primaryKey])))
          throw new BadRequestError(
            message('EnforceSameID', language, { key: key }))

        continue
      }

      if (Array.isArray(value))
        throw new BadRequestError(
          message('EnforceSingular', language, { key: key }))

      if (type === fieldDefinition[linkKey] && record[primaryKey] === value)
        throw new BadRequestError(
          message('EnforceSameID', language, { key: key }))

      continue
    }
  }

  return record
}


function checkValue (field, key, value, meta) {
  var language = meta.language
  var check

  // Skip `null` case.
  if (value === null) return

  check = find(checkInput, function (pair) {
    return pair[0] === field[typeKey]
  })
  if (check) check = check[1]
  else check = field[typeKey]

  // Fields may be nullable, but if they're defined, then they must be defined
  // properly.
  if (!check(value)) throw new BadRequestError(
    message(field[isArrayKey] ? 'EnforceValueArray' : 'EnforceValue',
    language, { key: key, type: field[typeKey].name }))
}


function matchId (a) {
  return function (b) {
    return a === b
  }
}

}).call(this,require("buffer").Buffer)
},{"../common/array/find":11,"../common/errors":21,"../common/keys":23,"../common/message":24,"buffer":47}],44:[function(require,module,exports){
'use strict'

var keys = require('../common/keys')
var linkKey = keys.link
var inverseKey = keys.inverse
var isArrayKey = keys.isArray
var denormalizedInverseKey = keys.denormalizedInverse


// Generate denormalized inverse field name.
var denormalizedPrefix = '__'
var denormalizedDelimiter = '_'
var denormalizedPostfix = '_inverse'


/**
 * Analyze the `types` object to see if `link` and `inverse` values are
 * valid. Also assign denormalized inverse fields.
 *
 * @param {Object} types
 */
module.exports = function ensureTypes (types) {
  var type, field, definition, linkedFields,
    denormalizedField, denormalizedDefinition

  for (type in types)
    for (field in types[type]) {
      definition = types[type][field]

      if (!(linkKey in definition)) continue

      if (!(definition[linkKey] in types))
        throw new Error('The value for "' + linkKey + '" on "' + field +
          '" in type "' + type +
          '" is invalid, the record type does not exist.')

      linkedFields = types[definition[linkKey]]

      if (inverseKey in definition) {
        if (!(definition[inverseKey] in linkedFields))
          throw new Error('The value for "' + inverseKey + '" on "' + field +
            '" in type "' + type + '" is invalid, the field does not exist.')

        if (linkedFields[definition[inverseKey]][inverseKey] !== field)
          throw new Error('The value for "' + inverseKey + '" on "' + field +
            '" in type "' + type +
            '" is invalid, the inversely related field must define its ' +
            'inverse as "' + field + '".')

        if (linkedFields[definition[inverseKey]][linkKey] !== type)
          throw new Error('The value for "' + linkKey + '" on "' + field +
            '" in type "' + type +
            '" is invalid, the inversely related field must define its link ' +
            'as "' + type + '".')

        continue
      }

      // Need to assign denormalized inverse. The denormalized inverse field
      // is basically an automatically assigned inverse field that should
      // not be visible to the client, but exists in the data store.
      denormalizedField = denormalizedPrefix + type +
        denormalizedDelimiter + field + denormalizedPostfix

      Object.defineProperty(definition, inverseKey, {
        value: denormalizedField
      })

      denormalizedDefinition = {}
      denormalizedDefinition[linkKey] = type
      denormalizedDefinition[inverseKey] = field
      denormalizedDefinition[isArrayKey] = true
      denormalizedDefinition[denormalizedInverseKey] = true

      Object.defineProperty(linkedFields, denormalizedField, {
        value: denormalizedDefinition
      })
    }
}

},{"../common/keys":23}],45:[function(require,module,exports){
(function (Buffer){
'use strict'

var find = require('../common/array/find')

var keys = require('../common/keys')
var primaryKey = keys.primary
var typeKey = keys.type
var linkKey = keys.link
var inverseKey = keys.inverse
var isArrayKey = keys.isArray

var nativeTypes = [ String, Number, Boolean, Date, Object, Buffer ]
var plainObject = {}


/**
 * Given a hash of field definitions, validate that the definitions are in the
 * correct format.
 *
 * @param {Object} fields
 * @return {Object}
 */
module.exports = function validate (fields) {
  var key

  if (typeof fields !== 'object')
    throw new TypeError('Type definition must be an object.')

  for (key in fields) validateField(fields, key)

  return fields
}


/**
 * Parse a field definition.
 *
 * @param {Object} fields
 * @param {String} key
 */
function validateField (fields, key) {
  var value = fields[key] = castShorthand(fields[key])

  if (typeof value !== 'object' || value.constructor !== Object)
    throw new TypeError('The definition of "' + key + '" must be an object.')

  if (key === primaryKey)
    throw new Error('Can not define primary key "' + primaryKey + '".')

  if (key in plainObject)
    throw new Error('Can not define "' + key +
      '" which is in Object.prototype.')

  if (!value[typeKey] && !value[linkKey])
    throw new Error('The definition of "' + key + '" must contain either ' +
      'the "' + typeKey + '" or "' + linkKey + '" property.')

  if (value[typeKey] && value[linkKey])
    throw new Error('Can not define both "' + typeKey + '" and "' + linkKey +
      '" on "' + key + '".')

  if (value[typeKey]) {
    if (!find(nativeTypes, function (type) {
      return type === value[typeKey]
    }) && typeof value[typeKey] !== 'function')
      throw new Error('The "' + typeKey + '" on "' + key + '" is invalid.')

    if (typeof value[typeKey] === 'function' &&
      !find(nativeTypes, function (type) {
        return type === value[typeKey].prototype.constructor
      }))
      throw new Error('The "' + typeKey + '" on "' + key + '" must inherit ' +
        'from a valid native type.')

    if (value[inverseKey])
      throw new Error('The field "' + inverseKey + '" may not be defined ' +
        'on "' + key + '".')
  }

  if (value[linkKey]) {
    if (typeof value[linkKey] !== 'string')
      throw new TypeError('The "' + linkKey + '" on "' + key +
        '" must be a string.')

    if (value[inverseKey] && typeof value[inverseKey] !== 'string')
      throw new TypeError('The "' + inverseKey + '" on "' + key + '" ' +
        'must be a string.')
  }

  if (value[isArrayKey] && typeof value[isArrayKey] !== 'boolean')
    throw new TypeError('The key "' + isArrayKey + '" on "' + key + '" ' +
        'must be a boolean.')
}


/**
 * Cast shorthand definition to standard definition.
 *
 * @param {*} value
 * @return {Object}
 */
function castShorthand (value) {
  var obj

  if (typeof value === 'string') obj = { link: value }
  else if (typeof value === 'function') obj = { type: value }
  else if (Array.isArray(value)) {
    obj = {}

    if (value[1]) obj.inverse = value[1]
    else obj.isArray = true

    // Extract type or link.
    if (Array.isArray(value[0])) {
      obj.isArray = true
      value = value[0][0]
    }
    else value = value[0]

    if (typeof value === 'string') obj.link = value
    else if (typeof value === 'function') obj.type = value
  }
  else return value

  return obj
}

}).call(this,require("buffer").Buffer)
},{"../common/array/find":11,"../common/keys":23,"buffer":47}],46:[function(require,module,exports){
'use strict'

exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

function init () {
  var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (var i = 0, len = code.length; i < len; ++i) {
    lookup[i] = code[i]
    revLookup[code.charCodeAt(i)] = i
  }

  revLookup['-'.charCodeAt(0)] = 62
  revLookup['_'.charCodeAt(0)] = 63
}

init()

function toByteArray (b64) {
  var i, j, l, tmp, placeHolders, arr
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  placeHolders = b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0

  // base64 is 4/3 + up to two characters of the original data
  arr = new Arr(len * 3 / 4 - placeHolders)

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len

  var L = 0

  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
    arr[L++] = (tmp >> 16) & 0xFF
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[L++] = tmp & 0xFF
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var output = ''
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    output += lookup[tmp >> 2]
    output += lookup[(tmp << 4) & 0x3F]
    output += '=='
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
    output += lookup[tmp >> 10]
    output += lookup[(tmp >> 4) & 0x3F]
    output += lookup[(tmp << 2) & 0x3F]
    output += '='
  }

  parts.push(output)

  return parts.join('')
}

},{}],47:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

/*
 * Export kMaxLength after typed array support is determined.
 */
exports.kMaxLength = kMaxLength()

function typedArraySupport () {
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = {__proto__: Uint8Array.prototype, foo: function () { return 42 }}
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

function createBuffer (that, length) {
  if (kMaxLength() < length) {
    throw new RangeError('Invalid typed array length')
  }
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(length)
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    if (that === null) {
      that = new Buffer(length)
    }
    that.length = length
  }

  return that
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
    return new Buffer(arg, encodingOrOffset, length)
  }

  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(this, arg)
  }
  return from(this, arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192 // not used by this implementation

// TODO: Legacy, not needed anymore. Remove in next major version.
Buffer._augment = function (arr) {
  arr.__proto__ = Buffer.prototype
  return arr
}

function from (that, value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return fromArrayBuffer(that, value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(that, value, encodingOrOffset)
  }

  return fromObject(that, value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(null, value, encodingOrOffset, length)
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
  if (typeof Symbol !== 'undefined' && Symbol.species &&
      Buffer[Symbol.species] === Buffer) {
    // Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
    Object.defineProperty(Buffer, Symbol.species, {
      value: null,
      configurable: true
    })
  }
}

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  }
}

function alloc (that, size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(that, size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(that, size).fill(fill, encoding)
      : createBuffer(that, size).fill(fill)
  }
  return createBuffer(that, size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(null, size, fill, encoding)
}

function allocUnsafe (that, size) {
  assertSize(size)
  that = createBuffer(that, size < 0 ? 0 : checked(size) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < size; ++i) {
      that[i] = 0
    }
  }
  return that
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(null, size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(null, size)
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('"encoding" must be a valid string encoding')
  }

  var length = byteLength(string, encoding) | 0
  that = createBuffer(that, length)

  that.write(string, encoding)
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = createBuffer(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array, byteOffset, length) {
  array.byteLength // this throws if `array` is not a valid ArrayBuffer

  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('\'offset\' is out of bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('\'length\' is out of bounds')
  }

  if (byteOffset === undefined && length === undefined) {
    array = new Uint8Array(array)
  } else if (length === undefined) {
    array = new Uint8Array(array, byteOffset)
  } else {
    array = new Uint8Array(array, byteOffset, length)
  }

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = array
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromArrayLike(that, array)
  }
  return that
}

function fromObject (that, obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    that = createBuffer(that, len)

    if (that.length === 0) {
      return that
    }

    obj.copy(that, 0, 0, len)
    return that
  }

  if (obj) {
    if ((typeof ArrayBuffer !== 'undefined' &&
        obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
      if (typeof obj.length !== 'number' || isnan(obj.length)) {
        return createBuffer(that, 0)
      }
      return fromArrayLike(that, obj)
    }

    if (obj.type === 'Buffer' && isArray(obj.data)) {
      return fromArrayLike(that, obj.data)
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
      (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string
  }

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
// Buffer instances.
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

function arrayIndexOf (arr, val, byteOffset, encoding) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var foundIndex = -1
  for (var i = byteOffset; i < arrLength; ++i) {
    if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
      if (foundIndex === -1) foundIndex = i
      if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
    } else {
      if (foundIndex !== -1) i -= i - foundIndex
      foundIndex = -1
    }
  }

  return -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  if (Buffer.isBuffer(val)) {
    // special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(this, val, byteOffset, encoding)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset, encoding)
  }

  throw new TypeError('val must be string, number or Buffer')
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = this.subarray(start, end)
    newBuf.__proto__ = Buffer.prototype
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; ++i) {
      newBuf[i] = this[i + start]
    }
  }

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; ++i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if (code < 256) {
        val = code
      }
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : utf8ToBytes(new Buffer(val, encoding).toString())
    var len = bytes.length
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function isnan (val) {
  return val !== val // eslint-disable-line no-self-compare
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":46,"ieee754":51,"isarray":48}],48:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],49:[function(require,module,exports){
'use strict'

var hasCaptureStackTrace = 'captureStackTrace' in Error

module.exports = errorClass


function errorClass (name) {
  var ErrorClass

  if (!name || typeof name !== 'string')
    throw new TypeError('Argument "name" must be a non-empty string.')

  // This is basically `eval`, there's no other way to dynamically define a
  // function name.
  ErrorClass = new Function('setupError',
    'return function ' + name + ' () { ' +
    'if (!(this instanceof ' + name + ')) ' +
    'return new (' + name + '.bind.apply(' + name +
      ', Array.prototype.concat.apply([ null ], arguments))); ' +
    'setupError.apply(this, arguments); ' +
    '}')(setupError)

  ErrorClass.prototype = Object.create(Error.prototype, {
    constructor: nonEnumerableProperty(ErrorClass),
    name: nonEnumerableProperty(name)
  })

  return ErrorClass
}


// Internal function to set up an error.
function setupError (message) {
  if (hasCaptureStackTrace)
    // V8 specific method.
    Error.captureStackTrace(this, this.constructor)
  else
    // Generic way to set the error stack trace.
    Object.defineProperty(this, 'stack',
      nonEnumerableProperty(Error(message).stack))

  // Use the `+` operator with an empty string to implicitly type cast the
  // `message` argument into a string.
  Object.defineProperty(this, 'message',
    nonEnumerableProperty(message !== void 0 ? '' + message : ''))
}


function nonEnumerableProperty (value) {
  // The field `enumerable` is `false` by default.
  return {
    value: value,
    writable: true,
    configurable: true
  }
}

},{}],50:[function(require,module,exports){
/**
 * event-lite.js - Light-weight EventEmitter (less than 1KB when gzipped)
 *
 * @copyright Yusuke Kawasaki
 * @license MIT
 * @constructor
 * @see https://github.com/kawanet/event-lite
 * @see http://kawanet.github.io/event-lite/EventLite.html
 * @example
 * var EventLite = require("event-lite");
 *
 * function MyClass() {...}             // your class
 *
 * EventLite.mixin(MyClass.prototype);  // import event methods
 *
 * var obj = new MyClass();
 * obj.on("foo", function() {...});     // add event listener
 * obj.once("bar", function() {...});   // add one-time event listener
 * obj.emit("foo");                     // dispatch event
 * obj.emit("bar");                     // dispatch another event
 * obj.off("foo");                      // remove event listener
 */

function EventLite() {
  if (!(this instanceof EventLite)) return new EventLite();
}

(function(EventLite) {
  // export the class for node.js
  if ("undefined" !== typeof module) module.exports = EventLite;

  // property name to hold listeners
  var LISTENERS = "listeners";

  // methods to export
  var methods = {
    on: on,
    once: once,
    off: off,
    emit: emit
  };

  // mixin to self
  mixin(EventLite.prototype);

  // export mixin function
  EventLite.mixin = mixin;

  /**
   * Import on(), once(), off() and emit() methods into target object.
   *
   * @function EventLite.mixin
   * @param target {Prototype}
   */

  function mixin(target) {
    for (var key in methods) {
      target[key] = methods[key];
    }
    return target;
  }

  /**
   * Add an event listener.
   *
   * @function EventLite.prototype.on
   * @param type {string}
   * @param func {Function}
   * @returns {EventLite} Self for method chaining
   */

  function on(type, func) {
    getListeners(this, type).push(func);
    return this;
  }

  /**
   * Add one-time event listener.
   *
   * @function EventLite.prototype.once
   * @param type {string}
   * @param func {Function}
   * @returns {EventLite} Self for method chaining
   */

  function once(type, func) {
    var that = this;
    wrap.originalListener = func;
    getListeners(that, type).push(wrap);
    return that;

    function wrap() {
      off.call(that, type, wrap);
      func.apply(this, arguments);
    }
  }

  /**
   * Remove an event listener.
   *
   * @function EventLite.prototype.off
   * @param [type] {string}
   * @param [func] {Function}
   * @returns {EventLite} Self for method chaining
   */

  function off(type, func) {
    var that = this;
    var listners;
    if (!arguments.length) {
      delete that[LISTENERS];
    } else if (!func) {
      listners = that[LISTENERS];
      if (listners) {
        delete listners[type];
        if (!Object.keys(listners).length) return off.call(that);
      }
    } else {
      listners = getListeners(that, type, true);
      if (listners) {
        listners = listners.filter(ne);
        if (!listners.length) return off.call(that, type);
        that[LISTENERS][type] = listners;
      }
    }
    return that;

    function ne(test) {
      return test !== func && test.originalListener !== func;
    }
  }

  /**
   * Dispatch (trigger) an event.
   *
   * @function EventLite.prototype.emit
   * @param type {string}
   * @param [value] {*}
   * @returns {boolean} True when a listener received the event
   */

  function emit(type, value) {
    var that = this;
    var listeners = getListeners(that, type, true);
    if (!listeners) return false;
    var arglen = arguments.length;
    if (arglen === 1) {
      listeners.forEach(zeroarg);
    } else if (arglen === 2) {
      listeners.forEach(onearg);
    } else {
      var args = Array.prototype.slice.call(arguments, 1);
      listeners.forEach(moreargs);
    }
    return !!listeners.length;

    function zeroarg(func) {
      func.call(that);
    }

    function onearg(func) {
      func.call(that, value);
    }

    function moreargs(func) {
      func.apply(that, args);
    }
  }

  /**
   * @ignore
   */

  function getListeners(that, type, readonly) {
    if (readonly && !that[LISTENERS]) return;
    var listeners = that[LISTENERS] || (that[LISTENERS] = {});
    return listeners[type] || (listeners[type] = []);
  }

})(EventLite);

},{}],51:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],52:[function(require,module,exports){
(function (Buffer){
// int64-buffer.js

/*jshint -W018 */ // Confusing use of '!'.
/*jshint -W030 */ // Expected an assignment or function call and instead saw an expression.
/*jshint -W093 */ // Did you mean to return a conditional instead of an assignment?

var Uint64BE, Int64BE, Uint64LE, Int64LE;

!function(exports) {
  // constants

  var UNDEFINED = "undefined";
  var BUFFER = (UNDEFINED !== typeof Buffer) && Buffer;
  var UINT8ARRAY = (UNDEFINED !== typeof Uint8Array) && Uint8Array;
  var ARRAYBUFFER = (UNDEFINED !== typeof ArrayBuffer) && ArrayBuffer;
  var ZERO = [0, 0, 0, 0, 0, 0, 0, 0];
  var isArray = Array.isArray || _isArray;
  var BIT32 = 4294967296;
  var BIT24 = 16777216;

  // storage class

  var storage; // Array;

  // generate classes

  Uint64BE = factory("Uint64BE", true, true);
  Int64BE = factory("Int64BE", true, false);
  Uint64LE = factory("Uint64LE", false, true);
  Int64LE = factory("Int64LE", false, false);

  // class factory

  function factory(name, bigendian, unsigned) {
    var posH = bigendian ? 0 : 4;
    var posL = bigendian ? 4 : 0;
    var pos0 = bigendian ? 0 : 3;
    var pos1 = bigendian ? 1 : 2;
    var pos2 = bigendian ? 2 : 1;
    var pos3 = bigendian ? 3 : 0;
    var fromPositive = bigendian ? fromPositiveBE : fromPositiveLE;
    var fromNegative = bigendian ? fromNegativeBE : fromNegativeLE;
    var proto = Int64.prototype;
    var isName = "is" + name;
    var _isInt64 = "_" + isName;

    // properties
    proto.buffer = void 0;
    proto.offset = 0;
    proto[_isInt64] = true;

    // methods
    proto.toNumber = toNumber;
    proto.toString = toString;
    proto.toJSON = toNumber;
    proto.toArray = toArray;

    // add .toBuffer() method only when Buffer available
    if (BUFFER) proto.toBuffer = toBuffer;

    // add .toArrayBuffer() method only when Uint8Array available
    if (UINT8ARRAY) proto.toArrayBuffer = toArrayBuffer;

    // isUint64BE, isInt64BE
    Int64[isName] = isInt64;

    // CommonJS
    exports[name] = Int64;

    return Int64;

    // constructor
    function Int64(buffer, offset, value, raddix) {
      if (!(this instanceof Int64)) return new Int64(buffer, offset, value, raddix);
      return init(this, buffer, offset, value, raddix);
    }

    // isUint64BE, isInt64BE
    function isInt64(b) {
      return !!(b && b[_isInt64]);
    }

    // initializer
    function init(that, buffer, offset, value, raddix) {
      if (UINT8ARRAY && ARRAYBUFFER) {
        if (buffer instanceof ARRAYBUFFER) buffer = new UINT8ARRAY(buffer);
        if (value instanceof ARRAYBUFFER) value = new UINT8ARRAY(value);
      }

      // Int64BE() style
      if (!buffer && !offset && !value && !storage) {
        // shortcut to initialize with zero
        that.buffer = newArray(ZERO, 0);
        return;
      }

      // Int64BE(value, raddix) style
      if (!isValidBuffer(buffer, offset)) {
        var _storage = storage || Array;
        raddix = offset;
        value = buffer;
        offset = 0;
        buffer = new _storage(8);
      }

      that.buffer = buffer;
      that.offset = offset |= 0;

      // Int64BE(buffer, offset) style
      if (UNDEFINED === typeof value) return;

      // Int64BE(buffer, offset, value, raddix) style
      if ("string" === typeof value) {
        fromString(buffer, offset, value, raddix || 10);
      } else if (isValidBuffer(value, raddix)) {
        fromArray(buffer, offset, value, raddix);
      } else if ("number" === typeof raddix) {
        writeInt32(buffer, offset + posH, value); // high
        writeInt32(buffer, offset + posL, raddix); // low
      } else if (value > 0) {
        fromPositive(buffer, offset, value); // positive
      } else if (value < 0) {
        fromNegative(buffer, offset, value); // negative
      } else {
        fromArray(buffer, offset, ZERO, 0); // zero, NaN and others
      }
    }

    function fromString(buffer, offset, str, raddix) {
      var pos = 0;
      var len = str.length;
      var high = 0;
      var low = 0;
      if (str[0] === "-") pos++;
      var sign = pos;
      while (pos < len) {
        var chr = parseInt(str[pos++], raddix);
        if (!(chr >= 0)) break; // NaN
        low = low * raddix + chr;
        high = high * raddix + Math.floor(low / BIT32);
        low %= BIT32;
      }
      if (sign) {
        high = ~high;
        if (low) {
          low = BIT32 - low;
        } else {
          high++;
        }
      }
      writeInt32(buffer, offset + posH, high);
      writeInt32(buffer, offset + posL, low);
    }

    function toNumber() {
      var buffer = this.buffer;
      var offset = this.offset;
      var high = readInt32(buffer, offset + posH);
      var low = readInt32(buffer, offset + posL);
      if (!unsigned) high |= 0; // a trick to get signed
      return high ? (high * BIT32 + low) : low;
    }

    function toString(radix) {
      var buffer = this.buffer;
      var offset = this.offset;
      var high = readInt32(buffer, offset + posH);
      var low = readInt32(buffer, offset + posL);
      var str = "";
      var sign = !unsigned && (high & 0x80000000);
      if (sign) {
        high = ~high;
        low = BIT32 - low;
      }
      radix = radix || 10;
      while (1) {
        var mod = (high % radix) * BIT32 + low;
        high = Math.floor(high / radix);
        low = Math.floor(mod / radix);
        str = (mod % radix).toString(radix) + str;
        if (!high && !low) break;
      }
      if (sign) {
        str = "-" + str;
      }
      return str;
    }

    function writeInt32(buffer, offset, value) {
      buffer[offset + pos3] = value & 255;
      value = value >> 8;
      buffer[offset + pos2] = value & 255;
      value = value >> 8;
      buffer[offset + pos1] = value & 255;
      value = value >> 8;
      buffer[offset + pos0] = value & 255;
    }

    function readInt32(buffer, offset) {
      return (buffer[offset + pos0] * BIT24) +
        (buffer[offset + pos1] << 16) +
        (buffer[offset + pos2] << 8) +
        buffer[offset + pos3];
    }
  }

  function toArray(raw) {
    var buffer = this.buffer;
    var offset = this.offset;
    storage = null; // Array
    if (raw !== false && offset === 0 && buffer.length === 8 && isArray(buffer)) return buffer;
    return newArray(buffer, offset);
  }

  function toBuffer(raw) {
    var buffer = this.buffer;
    var offset = this.offset;
    storage = BUFFER;
    if (raw !== false && offset === 0 && buffer.length === 8 && Buffer.isBuffer(buffer)) return buffer;
    var dest = new BUFFER(8);
    fromArray(dest, 0, buffer, offset);
    return dest;
  }

  function toArrayBuffer(raw) {
    var buffer = this.buffer;
    var offset = this.offset;
    var arrbuf = buffer.buffer;
    storage = UINT8ARRAY;
    if (raw !== false && offset === 0 && (arrbuf instanceof ARRAYBUFFER) && arrbuf.byteLength === 8) return arrbuf;
    var dest = new UINT8ARRAY(8);
    fromArray(dest, 0, buffer, offset);
    return dest.buffer;
  }

  function isValidBuffer(buffer, offset) {
    var len = buffer && buffer.length;
    offset |= 0;
    return len && (offset + 8 <= len) && ("string" !== typeof buffer[offset]);
  }

  function fromArray(destbuf, destoff, srcbuf, srcoff) {
    destoff |= 0;
    srcoff |= 0;
    for (var i = 0; i < 8; i++) {
      destbuf[destoff++] = srcbuf[srcoff++] & 255;
    }
  }

  function newArray(buffer, offset) {
    return Array.prototype.slice.call(buffer, offset, offset + 8);
  }

  function fromPositiveBE(buffer, offset, value) {
    var pos = offset + 8;
    while (pos > offset) {
      buffer[--pos] = value & 255;
      value /= 256;
    }
  }

  function fromNegativeBE(buffer, offset, value) {
    var pos = offset + 8;
    value++;
    while (pos > offset) {
      buffer[--pos] = ((-value) & 255) ^ 255;
      value /= 256;
    }
  }

  function fromPositiveLE(buffer, offset, value) {
    var end = offset + 8;
    while (offset < end) {
      buffer[offset++] = value & 255;
      value /= 256;
    }
  }

  function fromNegativeLE(buffer, offset, value) {
    var end = offset + 8;
    value++;
    while (offset < end) {
      buffer[offset++] = ((-value) & 255) ^ 255;
      value /= 256;
    }
  }

  // https://github.com/retrofox/is-array
  function _isArray(val) {
    return !!val && "[object Array]" == Object.prototype.toString.call(val);
  }

}(typeof exports === 'object' && typeof exports.nodeName !== 'string' ? exports : (this || {}));

}).call(this,require("buffer").Buffer)
},{"buffer":47}],53:[function(require,module,exports){
/**
 * Determine if an object is Buffer
 *
 * Author:   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * License:  MIT
 *
 * `npm install is-buffer`
 */

module.exports = function (obj) {
  return !!(obj != null &&
    (obj._isBuffer || // For Safari 5-7 (missing Object.prototype.constructor)
      (obj.constructor &&
      typeof obj.constructor.isBuffer === 'function' &&
      obj.constructor.isBuffer(obj))
    ))
}

},{}],54:[function(require,module,exports){
// browser.js

exports.encode = require("./encode").encode;
exports.decode = require("./decode").decode;

exports.Encoder = require("./encoder").Encoder;
exports.Decoder = require("./decoder").Decoder;

exports.createCodec = require("./ext").createCodec;
exports.codec = require("./codec").codec;

},{"./codec":57,"./decode":59,"./decoder":60,"./encode":62,"./encoder":63,"./ext":66}],55:[function(require,module,exports){
// util.js

var Int64Buffer = require("int64-buffer");
var Uint64BE = Int64Buffer.Uint64BE;
var Int64BE = Int64Buffer.Int64BE;

var MAXBUFLEN = 8192;

exports.writeString = writeString;
exports.readString = readString;
exports.byteLength = byteLength;
exports.copy = copy;
exports.writeUint64BE = writeUint64BE;
exports.writeInt64BE = writeInt64BE;

// new Buffer(string, "utf-8") is SLOWER then below

function writeString(string, start) {
  var buffer = this;
  var index = start || 0;
  var length = string.length;
  // JavaScript's string uses UTF-16 surrogate pairs for characters other than BMP.
  // This encodes string as CESU-8 which never reaches 4 octets per character.
  for (var i = 0; i < length; i++) {
    var chr = string.charCodeAt(i);
    if (chr < 0x80) {
      buffer[index++] = chr;
    } else if (chr < 0x800) {
      buffer[index++] = 0xC0 | (chr >> 6);
      buffer[index++] = 0x80 | (chr & 0x3F);
    } else {
      buffer[index++] = 0xE0 | (chr >> 12);
      buffer[index++] = 0x80 | ((chr >> 6) & 0x3F);
      buffer[index++] = 0x80 | (chr & 0x3F);
    }
  }
  return index - start;
}

// Buffer.ptototype.toString is 2x FASTER then below
// https://github.com/feross/buffer may throw "Maximum call stack size exceeded." at String.fromCharCode.apply.

function readString(start, end) {
  var buffer = this;
  var index = start - 0 || 0;
  if (!end) end = buffer.length;
  var size = end - start;
  if (size > MAXBUFLEN) size = MAXBUFLEN;
  var out = [];
  for (; index < end;) {
    var array = new Array(size);
    for (var pos = 0; pos < size && index < end;) {
      var chr = buffer[index++];
      chr = (chr < 0x80) ? chr :
        (chr < 0xE0) ? (((chr & 0x3F) << 6) | (buffer[index++] & 0x3F)) :
          (((chr & 0x3F) << 12) | ((buffer[index++] & 0x3F) << 6) | ((buffer[index++] & 0x3F)));
      array[pos++] = chr;
    }
    if (pos < size) array = array.slice(0, pos);
    out.push(String.fromCharCode.apply("", array));
  }
  return (out.length > 1) ? out.join("") : out.length ? out.shift() : "";
}

// Buffer.byteLength is FASTER than below

function byteLength(string) {
  var length = 0 | 0;
  Array.prototype.forEach.call(string, function(chr) {
    var code = chr.charCodeAt(0);
    length += (code < 0x80) ? 1 : (code < 0x800) ? 2 : 3;
  });
  return length;
}

// https://github.com/feross/buffer lacks descending copying feature

function copy(target, targetStart, start, end) {
  var i;
  if (!start) start = 0;
  if (!end && end !== 0) end = this.length;
  if (!targetStart) targetStart = 0;
  var len = end - start;

  if (target === this && start < targetStart && targetStart < end) {
    // descending
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start];
    }
  } else {
    // ascending
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start];
    }
  }

  return len;
}

function writeUint64BE(value, offset) {
  new Uint64BE(this, offset, value);
}

function writeInt64BE(value, offset) {
  new Int64BE(this, offset, value);
}

},{"int64-buffer":52}],56:[function(require,module,exports){
// buffer-shortage.js

exports.BufferShortageError = BufferShortageError;

BufferShortageError.prototype = Error.prototype;

function BufferShortageError() {
}

},{}],57:[function(require,module,exports){
// codec.js

exports.codec = {
  preset: require("./ext").createCodec({preset: true})
};

},{"./ext":66}],58:[function(require,module,exports){
(function (Buffer){
// decode-buffer.js

exports.DecodeBuffer = DecodeBuffer;

var preset = require("./codec").codec.preset;

var BufferShortageError = require("./buffer-shortage").BufferShortageError;

function DecodeBuffer(options) {
  if (!(this instanceof DecodeBuffer)) return new DecodeBuffer(options);

  if (options) {
    this.options = options;
    if (options.codec) {
      this.codec = options.codec;
    }
  }
}

DecodeBuffer.prototype.offset = 0;

DecodeBuffer.prototype.push = function(chunk) {
  var buffers = this.buffers || (this.buffers = []);
  buffers.push(chunk);
};

DecodeBuffer.prototype.codec = preset;

DecodeBuffer.prototype.write = function(chunk) {
  var prev = this.offset ? this.buffer.slice(this.offset) : this.buffer;
  this.buffer = prev ? (chunk ? Buffer.concat([prev, chunk]) : prev) : chunk;
  this.offset = 0;
};

DecodeBuffer.prototype.read = function() {
  var length = this.buffers && this.buffers.length;

  // fetch the first result
  if (!length) return this.fetch();

  // flush current buffer
  this.flush();

  // read from the results
  return this.pull();
};

DecodeBuffer.prototype.pull = function() {
  var buffers = this.buffers || (this.buffers = []);
  return buffers.shift();
};

DecodeBuffer.prototype.fetch = function() {
  return this.codec.decode(this);
};

DecodeBuffer.prototype.flush = function() {
  while (this.offset < this.buffer.length) {
    var start = this.offset;
    var value;
    try {
      value = this.fetch();
    } catch (e) {
      if (!(e instanceof BufferShortageError)) throw e;
      // rollback
      this.offset = start;
      break;
    }
    this.push(value);
  }
};

}).call(this,require("buffer").Buffer)
},{"./buffer-shortage":56,"./codec":57,"buffer":47}],59:[function(require,module,exports){
// decode.js

exports.decode = decode;

var DecodeBuffer = require("./decode-buffer").DecodeBuffer;

function decode(input, options) {
  var decoder = new DecodeBuffer(options);
  decoder.write(input);
  return decoder.read();
}
},{"./decode-buffer":58}],60:[function(require,module,exports){
// decoder.js

exports.Decoder = Decoder;

var EventLite = require("event-lite");
var DecodeBuffer = require("./decode-buffer").DecodeBuffer;

function Decoder(options) {
  if (!(this instanceof Decoder)) return new Decoder(options);
  DecodeBuffer.call(this, options);
}

Decoder.prototype = new DecodeBuffer();

EventLite.mixin(Decoder.prototype);

Decoder.prototype.decode = function(chunk) {
  if (arguments.length) this.write(chunk);
  this.flush();
};

Decoder.prototype.push = function(chunk) {
  this.emit("data", chunk);
};

Decoder.prototype.end = function(chunk) {
  this.decode(chunk);
  this.emit("end");
};

},{"./decode-buffer":58,"event-lite":50}],61:[function(require,module,exports){
(function (Buffer){
// encode-buffer.js

exports.EncodeBuffer = EncodeBuffer;

var preset = require("./codec").codec.preset;

var MIN_BUFFER_SIZE = 2048;
var MAX_BUFFER_SIZE = 65536;

function EncodeBuffer(options) {
  if (!(this instanceof EncodeBuffer)) return new EncodeBuffer(options);

  if (options) {
    this.options = options;
    if (options.codec) {
      this.codec = options.codec;
    }
  }
}

EncodeBuffer.prototype.offset = 0;
EncodeBuffer.prototype.start = 0;

EncodeBuffer.prototype.push = function(chunk) {
  var buffers = this.buffers || (this.buffers = []);
  buffers.push(chunk);
};

EncodeBuffer.prototype.codec = preset;

EncodeBuffer.prototype.write = function(input) {
  this.codec.encode(this, input);
};

EncodeBuffer.prototype.read = function() {
  var length = this.buffers && this.buffers.length;

  // fetch the first result
  if (!length) return this.fetch();

  // flush current buffer
  this.flush();

  // read from the results
  return this.pull();
};

EncodeBuffer.prototype.pull = function() {
  var buffers = this.buffers || (this.buffers = []);
  var chunk = buffers.length > 1 ? Buffer.concat(buffers) : buffers[0];
  buffers.length = 0; // buffer exhausted
  return chunk;
};

EncodeBuffer.prototype.fetch = function() {
  var start = this.start;
  if (start < this.offset) {
    this.start = this.offset;
    return this.buffer.slice(start, this.offset);
  }
};

EncodeBuffer.prototype.flush = function() {
  var buffer = this.fetch();
  if (buffer) this.push(buffer);
};

EncodeBuffer.prototype.reserve = function(length) {
  if (this.buffer) {
    var size = this.buffer.length;

    // is it long enough?
    if (this.offset + length < size) return;

    // flush current buffer
    this.flush();

    // resize it to 2x current length
    length = Math.max(length, Math.min(size * 2, MAX_BUFFER_SIZE));
  }

  // minimum buffer size
  length = length > MIN_BUFFER_SIZE ? length : MIN_BUFFER_SIZE;

  // allocate new buffer
  this.buffer = new Buffer(length);
  this.start = 0;
  this.offset = 0;
};

EncodeBuffer.prototype.send = function(buffer) {
  var end = this.offset + buffer.length;
  if (this.buffer && end < this.buffer.length) {
    buffer.copy(this.buffer, this.offset);
    this.offset = end;
  } else {
    this.flush();
    this.push(buffer);
  }
};

}).call(this,require("buffer").Buffer)
},{"./codec":57,"buffer":47}],62:[function(require,module,exports){
// encode.js

exports.encode = encode;

var EncodeBuffer = require("./encode-buffer").EncodeBuffer;

function encode(input, options) {
  var encoder = new EncodeBuffer(options);
  encoder.write(input);
  return encoder.read();
}

},{"./encode-buffer":61}],63:[function(require,module,exports){
// encoder.js

exports.Encoder = Encoder;

var EventLite = require("event-lite");
var EncodeBuffer = require("./encode-buffer").EncodeBuffer;

function Encoder(options) {
  if (!(this instanceof Encoder)) return new Encoder(options);
  EncodeBuffer.call(this, options);
}

Encoder.prototype = new EncodeBuffer();

EventLite.mixin(Encoder.prototype);

Encoder.prototype.encode = function(chunk) {
  this.write(chunk);
  this.emit("data", this.read());
};

Encoder.prototype.end = function(chunk) {
  if (arguments.length) this.encode(chunk);
  this.flush();
  this.emit("end");
};

},{"./encode-buffer":61,"event-lite":50}],64:[function(require,module,exports){
// ext-buffer.js

exports.ExtBuffer = ExtBuffer;

function ExtBuffer(buffer, type) {
  if (!(this instanceof ExtBuffer)) return new ExtBuffer(buffer, type);
  this.buffer = buffer;
  this.type = type;
}

},{}],65:[function(require,module,exports){
(function (Buffer){
// ext-preset.js

exports.setExtPreset = setExtPreset;

var _encode, _decode;
var hasUint8Array = ("undefined" !== typeof Uint8Array);
var hasFloat64Array = ("undefined" !== typeof Float64Array);
var hasUint8ClampedArray = ("undefined" !== typeof Uint8ClampedArray);

var ERROR_COLUMNS = {name: 1, message: 1, stack: 1, columnNumber: 1, fileName: 1, lineNumber: 1};

function setExtPreset(codec) {
  setExtPackers(codec);
  setExtUnpackers(codec);
}

function setExtPackers(preset) {
  preset.addExtPacker(0x0E, Error, [packError, encode]);
  preset.addExtPacker(0x01, EvalError, [packError, encode]);
  preset.addExtPacker(0x02, RangeError, [packError, encode]);
  preset.addExtPacker(0x03, ReferenceError, [packError, encode]);
  preset.addExtPacker(0x04, SyntaxError, [packError, encode]);
  preset.addExtPacker(0x05, TypeError, [packError, encode]);
  preset.addExtPacker(0x06, URIError, [packError, encode]);

  preset.addExtPacker(0x0A, RegExp, [packRegExp, encode]);
  preset.addExtPacker(0x0B, Boolean, [packValueOf, encode]);
  preset.addExtPacker(0x0C, String, [packValueOf, encode]);
  preset.addExtPacker(0x0D, Date, [Number, encode]);
  preset.addExtPacker(0x0F, Number, [packValueOf, encode]);

  if (hasUint8Array) {
    preset.addExtPacker(0x11, Int8Array, packBuffer);
    preset.addExtPacker(0x12, Uint8Array, packBuffer);
    preset.addExtPacker(0x13, Int16Array, packTypedArray);
    preset.addExtPacker(0x14, Uint16Array, packTypedArray);
    preset.addExtPacker(0x15, Int32Array, packTypedArray);
    preset.addExtPacker(0x16, Uint32Array, packTypedArray);
    preset.addExtPacker(0x17, Float32Array, packTypedArray);

    if (hasFloat64Array) {
      // PhantomJS/1.9.7 doesn't have Float64Array
      preset.addExtPacker(0x18, Float64Array, packTypedArray);
    }

    if (hasUint8ClampedArray) {
      // IE10 doesn't have Uint8ClampedArray
      preset.addExtPacker(0x19, Uint8ClampedArray, packBuffer);
      preset.addExtUnpacker(0x19, unpackClass(Uint8ClampedArray));
    }

    preset.addExtPacker(0x1A, ArrayBuffer, packArrayBuffer);
    preset.addExtPacker(0x1D, DataView, packTypedArray);
    preset.addExtUnpacker(0x1A, unpackArrayBuffer);
    preset.addExtUnpacker(0x1D, [unpackArrayBuffer, unpackClass(DataView)]);
  }
}

function setExtUnpackers(preset) {
  preset.addExtPacker(0x0E, Error, [packError, encode]);
  preset.addExtPacker(0x01, EvalError, [packError, encode]);
  preset.addExtPacker(0x02, RangeError, [packError, encode]);
  preset.addExtPacker(0x03, ReferenceError, [packError, encode]);
  preset.addExtPacker(0x04, SyntaxError, [packError, encode]);
  preset.addExtPacker(0x05, TypeError, [packError, encode]);
  preset.addExtPacker(0x06, URIError, [packError, encode]);

  preset.addExtUnpacker(0x0E, [decode, unpackError(Error)]);
  preset.addExtUnpacker(0x01, [decode, unpackError(EvalError)]);
  preset.addExtUnpacker(0x02, [decode, unpackError(RangeError)]);
  preset.addExtUnpacker(0x03, [decode, unpackError(ReferenceError)]);
  preset.addExtUnpacker(0x04, [decode, unpackError(SyntaxError)]);
  preset.addExtUnpacker(0x05, [decode, unpackError(TypeError)]);
  preset.addExtUnpacker(0x06, [decode, unpackError(URIError)]);

  preset.addExtPacker(0x0A, RegExp, [packRegExp, encode]);
  preset.addExtPacker(0x0B, Boolean, [packValueOf, encode]);
  preset.addExtPacker(0x0C, String, [packValueOf, encode]);
  preset.addExtPacker(0x0D, Date, [Number, encode]);
  preset.addExtPacker(0x0F, Number, [packValueOf, encode]);

  preset.addExtUnpacker(0x0A, [decode, unpackRegExp]);
  preset.addExtUnpacker(0x0B, [decode, unpackClass(Boolean)]);
  preset.addExtUnpacker(0x0C, [decode, unpackClass(String)]);
  preset.addExtUnpacker(0x0D, [decode, unpackClass(Date)]);
  preset.addExtUnpacker(0x0F, [decode, unpackClass(Number)]);

  if (hasUint8Array) {
    preset.addExtPacker(0x11, Int8Array, packBuffer);
    preset.addExtPacker(0x12, Uint8Array, packBuffer);
    preset.addExtPacker(0x13, Int16Array, packTypedArray);
    preset.addExtPacker(0x14, Uint16Array, packTypedArray);
    preset.addExtPacker(0x15, Int32Array, packTypedArray);
    preset.addExtPacker(0x16, Uint32Array, packTypedArray);
    preset.addExtPacker(0x17, Float32Array, packTypedArray);

    preset.addExtUnpacker(0x11, unpackClass(Int8Array));
    preset.addExtUnpacker(0x12, unpackClass(Uint8Array));
    preset.addExtUnpacker(0x13, [unpackArrayBuffer, unpackClass(Int16Array)]);
    preset.addExtUnpacker(0x14, [unpackArrayBuffer, unpackClass(Uint16Array)]);
    preset.addExtUnpacker(0x15, [unpackArrayBuffer, unpackClass(Int32Array)]);
    preset.addExtUnpacker(0x16, [unpackArrayBuffer, unpackClass(Uint32Array)]);
    preset.addExtUnpacker(0x17, [unpackArrayBuffer, unpackClass(Float32Array)]);

    if (hasFloat64Array) {
      // PhantomJS/1.9.7 doesn't have Float64Array
      preset.addExtPacker(0x18, Float64Array, packTypedArray);
      preset.addExtUnpacker(0x18, [unpackArrayBuffer, unpackClass(Float64Array)]);
    }

    if (hasUint8ClampedArray) {
      // IE10 doesn't have Uint8ClampedArray
      preset.addExtPacker(0x19, Uint8ClampedArray, packBuffer);
      preset.addExtUnpacker(0x19, unpackClass(Uint8ClampedArray));
    }

    preset.addExtPacker(0x1A, ArrayBuffer, packArrayBuffer);
    preset.addExtPacker(0x1D, DataView, packTypedArray);
    preset.addExtUnpacker(0x1A, unpackArrayBuffer);
    preset.addExtUnpacker(0x1D, [unpackArrayBuffer, unpackClass(DataView)]);
  }
}

function encode(input) {
  if (!_encode) _encode = require("./encode").encode; // lazy load
  return _encode(input);
}

function decode(input) {
  if (!_decode) _decode = require("./decode").decode; // lazy load
  return _decode(input);
}

function packBuffer(value) {
  return new Buffer(value);
}

function packValueOf(value) {
  return (value).valueOf();
}

function packRegExp(value) {
  value = RegExp.prototype.toString.call(value).split("/");
  value.shift();
  var out = [value.pop()];
  out.unshift(value.join("/"));
  return out;
}

function unpackRegExp(value) {
  return RegExp.apply(null, value);
}

function packError(value) {
  var out = {};
  for (var key in ERROR_COLUMNS) {
    out[key] = value[key];
  }
  return out;
}

function unpackError(Class) {
  return function(value) {
    var out = new Class();
    for (var key in ERROR_COLUMNS) {
      out[key] = value[key];
    }
    return out;
  };
}

function unpackClass(Class) {
  return function(value) {
    return new Class(value);
  };
}

function packTypedArray(value) {
  return new Buffer(new Uint8Array(value.buffer));
}

function packArrayBuffer(value) {
  return new Buffer(new Uint8Array(value));
}

function unpackArrayBuffer(value) {
  return (new Uint8Array(value)).buffer;
}

}).call(this,require("buffer").Buffer)
},{"./decode":59,"./encode":62,"buffer":47}],66:[function(require,module,exports){
// ext.js

var IS_ARRAY = require("isarray");

exports.createCodec = createCodec;

var ExtBuffer = require("./ext-buffer").ExtBuffer;
var ExtPreset = require("./ext-preset");
var ReadCore = require("./read-core");
var WriteCore = require("./write-core");

function Codec(options) {
  if (!(this instanceof Codec)) return new Codec(options);
  this.extPackers = {};
  this.extUnpackers = [];
  this.encode = WriteCore.getEncoder(options);
  this.decode = ReadCore.getDecoder(options);
  if (options && options.preset) {
    ExtPreset.setExtPreset(this);
  }
}

function createCodec(options) {
  return new Codec(options);
}

Codec.prototype.addExtPacker = function(etype, Class, packer) {
  if (IS_ARRAY(packer)) {
    packer = join(packer);
  }
  var name = Class.name;
  if (name && name !== "Object") {
    this.extPackers[name] = extPacker;
  } else {
    var list = this.extEncoderList || (this.extEncoderList = []);
    list.unshift([Class, extPacker]);
  }

  function extPacker(value) {
    var buffer = packer(value);
    return new ExtBuffer(buffer, etype);
  }
};

Codec.prototype.addExtUnpacker = function(etype, unpacker) {
  this.extUnpackers[etype] = IS_ARRAY(unpacker) ? join(unpacker) : unpacker;
};

Codec.prototype.getExtPacker = function(value) {
  var c = value.constructor;
  var e = c && c.name && this.extPackers[c.name];
  if (e) return e;
  var list = this.extEncoderList;
  if (!list) return;
  var len = list.length;
  for (var i = 0; i < len; i++) {
    var pair = list[i];
    if (c === pair[0]) return pair[1];
  }
};

Codec.prototype.getExtUnpacker = function(type) {
  return this.extUnpackers[type] || extUnpacker;

  function extUnpacker(buffer) {
    return new ExtBuffer(buffer, type);
  }
};

function join(filters) {
  filters = filters.slice();

  return function(value) {
    return filters.reduce(iterator, value);
  };

  function iterator(value, filter) {
    return filter(value);
  }
}

},{"./ext-buffer":64,"./ext-preset":65,"./read-core":67,"./write-core":70,"isarray":74}],67:[function(require,module,exports){
// read-core.js

exports.getDecoder = getDecoder;

var readUint8 = require("./read-format").readUint8;
var ReadToken = require("./read-token");

function getDecoder(options) {
  var readToken = ReadToken.getReadToken(options);
  return decode;

  function decode(decoder) {
    var type = readUint8(decoder);
    var func = readToken[type];
    if (!func) throw new Error("Invalid type: " + (type ? ("0x" + type.toString(16)) : type));
    return func(decoder);
  }
}

},{"./read-format":68,"./read-token":69}],68:[function(require,module,exports){
(function (Buffer){
// read-format.js

var ieee754 = require("ieee754");
var Int64Buffer = require("int64-buffer");
var Uint64BE = Int64Buffer.Uint64BE;
var Int64BE = Int64Buffer.Int64BE;

exports.getReadFormat = getReadFormat;
exports.readUint8 = uint8;

var BufferLite = require("./buffer-lite");
var BufferShortageError = require("./buffer-shortage").BufferShortageError;

var IS_BUFFER_SHIM = ("TYPED_ARRAY_SUPPORT" in Buffer);
var NO_ASSERT = true;

function getReadFormat(options) {
  var readFormat = {
    map: map,
    array: array,
    str: str,
    bin: bin,
    ext: ext,
    uint8: uint8,
    uint16: uint16,
    uint32: read(4, Buffer.prototype.readUInt32BE),
    uint64: read(8, readUInt64BE),
    int8: read(1, Buffer.prototype.readInt8),
    int16: read(2, Buffer.prototype.readInt16BE),
    int32: read(4, Buffer.prototype.readInt32BE),
    int64: read(8, readInt64BE),
    float32: read(4, readFloatBE),
    float64: read(8, readDoubleBE)
  };

  if (options && options.int64) {
    readFormat.uint64 = read(8, readUInt64BE_int64);
    readFormat.int64 = read(8, readInt64BE_int64);
  }

  return readFormat;
}

function map(decoder, len) {
  var value = {};
  var i;
  var k = new Array(len);
  var v = new Array(len);

  var decode = decoder.codec.decode;
  for (i = 0; i < len; i++) {
    k[i] = decode(decoder);
    v[i] = decode(decoder);
  }
  for (i = 0; i < len; i++) {
    value[k[i]] = v[i];
  }
  return value;
}

function array(decoder, len) {
  var value = new Array(len);
  var decode = decoder.codec.decode;
  for (var i = 0; i < len; i++) {
    value[i] = decode(decoder);
  }
  return value;
}

function str(decoder, len) {
  var start = decoder.offset;
  var end = decoder.offset = start + len;
  var buffer = decoder.buffer;
  if (end > buffer.length) throw new BufferShortageError();
  if (IS_BUFFER_SHIM || !Buffer.isBuffer(buffer)) {
    // slower (compat)
    return BufferLite.readString.call(buffer, start, end);
  } else {
    // 2x faster
    return buffer.toString("utf-8", start, end);
  }
}

function bin(decoder, len) {
  var start = decoder.offset;
  var end = decoder.offset = start + len;
  if (end > decoder.buffer.length) throw new BufferShortageError();
  return slice.call(decoder.buffer, start, end);
}

function ext(decoder, len) {
  var start = decoder.offset;
  var end = decoder.offset = start + len + 1;
  if (end > decoder.buffer.length) throw new BufferShortageError();
  var type = decoder.buffer[start];
  var unpack = decoder.codec.getExtUnpacker(type);
  if (!unpack) throw new Error("Invalid ext type: " + (type ? ("0x" + type.toString(16)) : type));
  var buf = slice.call(decoder.buffer, start + 1, end);
  return unpack(buf);
}

function uint8(decoder) {
  var buffer = decoder.buffer;
  if (decoder.offset >= buffer.length) throw new BufferShortageError();
  return buffer[decoder.offset++];
}

function uint16(decoder) {
  var buffer = decoder.buffer;
  if (decoder.offset + 2 > buffer.length) throw new BufferShortageError();
  return (buffer[decoder.offset++] << 8) | buffer[decoder.offset++];
}

function read(len, method) {
  return function(decoder) {
    var start = decoder.offset;
    var end = decoder.offset = start + len;
    if (end > decoder.buffer.length) throw new BufferShortageError();
    return method.call(decoder.buffer, start, NO_ASSERT);
  };
}

function readUInt64BE(start) {
  return new Uint64BE(this, start).toNumber();
}

function readInt64BE(start) {
  return new Int64BE(this, start).toNumber();
}

function readUInt64BE_int64(start) {
  return new Uint64BE(this, start);
}

function readInt64BE_int64(start) {
  return new Int64BE(this, start);
}

function readFloatBE(start) {
  if (this.readFloatBE) return this.readFloatBE(start);
  return ieee754.read(this, start, false, 23, 4);
}

function readDoubleBE(start) {
  if (this.readDoubleBE) return this.readDoubleBE(start);
  return ieee754.read(this, start, false, 52, 8);
}

function slice(start, end) {
  var f = this.slice || Array.prototype.slice;
  var buf = f.call(this, start, end);
  if (!Buffer.isBuffer(buf)) buf = Buffer(buf);
  return buf;
}

}).call(this,require("buffer").Buffer)
},{"./buffer-lite":55,"./buffer-shortage":56,"buffer":47,"ieee754":51,"int64-buffer":52}],69:[function(require,module,exports){
// read-token.js

var ReadFormat = require("./read-format");

exports.getReadToken = getReadToken;

function getReadToken(options) {
  var format = ReadFormat.getReadFormat(options);

  if (options && options.useraw) {
    return init_useraw(format);
  } else {
    return init_token(format);
  }
}

function init_token(format) {
  var i;
  var token = new Array(256);

  // positive fixint -- 0x00 - 0x7f
  for (i = 0x00; i <= 0x7f; i++) {
    token[i] = constant(i);
  }

  // fixmap -- 0x80 - 0x8f
  for (i = 0x80; i <= 0x8f; i++) {
    token[i] = fix(i - 0x80, format.map);
  }

  // fixarray -- 0x90 - 0x9f
  for (i = 0x90; i <= 0x9f; i++) {
    token[i] = fix(i - 0x90, format.array);
  }

  // fixstr -- 0xa0 - 0xbf
  for (i = 0xa0; i <= 0xbf; i++) {
    token[i] = fix(i - 0xa0, format.str);
  }

  // nil -- 0xc0
  token[0xc0] = constant(null);

  // (never used) -- 0xc1
  token[0xc1] = null;

  // false -- 0xc2
  // true -- 0xc3
  token[0xc2] = constant(false);
  token[0xc3] = constant(true);

  // bin 8 -- 0xc4
  // bin 16 -- 0xc5
  // bin 32 -- 0xc6
  token[0xc4] = flex(format.uint8, format.bin);
  token[0xc5] = flex(format.uint16, format.bin);
  token[0xc6] = flex(format.uint32, format.bin);

  // ext 8 -- 0xc7
  // ext 16 -- 0xc8
  // ext 32 -- 0xc9
  token[0xc7] = flex(format.uint8, format.ext);
  token[0xc8] = flex(format.uint16, format.ext);
  token[0xc9] = flex(format.uint32, format.ext);

  // float 32 -- 0xca
  // float 64 -- 0xcb
  token[0xca] = format.float32;
  token[0xcb] = format.float64;

  // uint 8 -- 0xcc
  // uint 16 -- 0xcd
  // uint 32 -- 0xce
  // uint 64 -- 0xcf
  token[0xcc] = format.uint8;
  token[0xcd] = format.uint16;
  token[0xce] = format.uint32;
  token[0xcf] = format.uint64;

  // int 8 -- 0xd0
  // int 16 -- 0xd1
  // int 32 -- 0xd2
  // int 64 -- 0xd3
  token[0xd0] = format.int8;
  token[0xd1] = format.int16;
  token[0xd2] = format.int32;
  token[0xd3] = format.int64;

  // fixext 1 -- 0xd4
  // fixext 2 -- 0xd5
  // fixext 4 -- 0xd6
  // fixext 8 -- 0xd7
  // fixext 16 -- 0xd8
  token[0xd4] = fix(1, format.ext);
  token[0xd5] = fix(2, format.ext);
  token[0xd6] = fix(4, format.ext);
  token[0xd7] = fix(8, format.ext);
  token[0xd8] = fix(16, format.ext);

  // str 8 -- 0xd9
  // str 16 -- 0xda
  // str 32 -- 0xdb
  token[0xd9] = flex(format.uint8, format.str);
  token[0xda] = flex(format.uint16, format.str);
  token[0xdb] = flex(format.uint32, format.str);

  // array 16 -- 0xdc
  // array 32 -- 0xdd
  token[0xdc] = flex(format.uint16, format.array);
  token[0xdd] = flex(format.uint32, format.array);

  // map 16 -- 0xde
  // map 32 -- 0xdf
  token[0xde] = flex(format.uint16, format.map);
  token[0xdf] = flex(format.uint32, format.map);

  // negative fixint -- 0xe0 - 0xff
  for (i = 0xe0; i <= 0xff; i++) {
    token[i] = constant(i - 0x100);
  }

  return token;
}

function init_useraw(format) {
  var i;
  var token = getReadToken(format).slice();

  // raw 8 -- 0xd9
  // raw 16 -- 0xda
  // raw 32 -- 0xdb
  token[0xd9] = token[0xc4];
  token[0xda] = token[0xc5];
  token[0xdb] = token[0xc6];

  // fixraw -- 0xa0 - 0xbf
  for (i = 0xa0; i <= 0xbf; i++) {
    token[i] = fix(i - 0xa0, format.bin);
  }

  return token;
}

function constant(value) {
  return function() {
    return value;
  };
}

function flex(lenFunc, decodeFunc) {
  return function(decoder) {
    var len = lenFunc(decoder);
    return decodeFunc(decoder, len);
  };
}

function fix(len, method) {
  return function(decoder) {
    return method(decoder, len);
  };
}

},{"./read-format":68}],70:[function(require,module,exports){
// write-core.js

exports.getEncoder = getEncoder;

var WriteType = require("./write-type");

function getEncoder(options) {
  var writeType = WriteType.getWriteType(options);
  return encode;

  function encode(encoder, value) {
    var func = writeType[typeof value];
    if (!func) throw new Error("Unsupported type \"" + (typeof value) + "\": " + value);
    func(encoder, value);
  }
}

},{"./write-type":72}],71:[function(require,module,exports){
(function (Buffer){
// write-token.js

var BufferLite = require("./buffer-lite");
var uint8 = require("./write-uint8").uint8;

var IS_BUFFER_SHIM = ("TYPED_ARRAY_SUPPORT" in Buffer);
var NO_TYPED_ARRAY = IS_BUFFER_SHIM && !Buffer.TYPED_ARRAY_SUPPORT;

exports.getWriteToken = getWriteToken;

function getWriteToken(options) {
  if (NO_TYPED_ARRAY || (options && options.safe)) {
    return init_safe();
  } else {
    return init_token();
  }
}

// Node.js and browsers with TypedArray

function init_token() {
  // (immediate values)
  // positive fixint -- 0x00 - 0x7f
  // nil -- 0xc0
  // false -- 0xc2
  // true -- 0xc3
  // negative fixint -- 0xe0 - 0xff
  var token = uint8.slice();

  // bin 8 -- 0xc4
  // bin 16 -- 0xc5
  // bin 32 -- 0xc6
  token[0xc4] = write1(0xc4);
  token[0xc5] = write2(0xc5);
  token[0xc6] = write4(0xc6);

  // ext 8 -- 0xc7
  // ext 16 -- 0xc8
  // ext 32 -- 0xc9
  token[0xc7] = write1(0xc7);
  token[0xc8] = write2(0xc8);
  token[0xc9] = write4(0xc9);

  // float 32 -- 0xca
  // float 64 -- 0xcb
  token[0xca] = writeN(0xca, 4, Buffer.prototype.writeFloatBE, true);
  token[0xcb] = writeN(0xcb, 8, Buffer.prototype.writeDoubleBE, true);

  // uint 8 -- 0xcc
  // uint 16 -- 0xcd
  // uint 32 -- 0xce
  // uint 64 -- 0xcf
  token[0xcc] = write1(0xcc);
  token[0xcd] = write2(0xcd);
  token[0xce] = write4(0xce);
  token[0xcf] = writeN(0xcf, 8, BufferLite.writeUint64BE);

  // int 8 -- 0xd0
  // int 16 -- 0xd1
  // int 32 -- 0xd2
  // int 64 -- 0xd3
  token[0xd0] = write1(0xd0);
  token[0xd1] = write2(0xd1);
  token[0xd2] = write4(0xd2);
  token[0xd3] = writeN(0xd3, 8, BufferLite.writeUint64BE);

  // str 8 -- 0xd9
  // str 16 -- 0xda
  // str 32 -- 0xdb
  token[0xd9] = write1(0xd9);
  token[0xda] = write2(0xda);
  token[0xdb] = write4(0xdb);

  // array 16 -- 0xdc
  // array 32 -- 0xdd
  token[0xdc] = write2(0xdc);
  token[0xdd] = write4(0xdd);

  // map 16 -- 0xde
  // map 32 -- 0xdf
  token[0xde] = write2(0xde);
  token[0xdf] = write4(0xdf);

  return token;
}

// safe mode: for old browsers and who needs asserts

function init_safe() {
  // (immediate values)
  // positive fixint -- 0x00 - 0x7f
  // nil -- 0xc0
  // false -- 0xc2
  // true -- 0xc3
  // negative fixint -- 0xe0 - 0xff
  var token = uint8.slice();

  // bin 8 -- 0xc4
  // bin 16 -- 0xc5
  // bin 32 -- 0xc6
  token[0xc4] = writeN(0xc4, 1, Buffer.prototype.writeUInt8);
  token[0xc5] = writeN(0xc5, 2, Buffer.prototype.writeUInt16BE);
  token[0xc6] = writeN(0xc6, 4, Buffer.prototype.writeUInt32BE);

  // ext 8 -- 0xc7
  // ext 16 -- 0xc8
  // ext 32 -- 0xc9
  token[0xc7] = writeN(0xc7, 1, Buffer.prototype.writeUInt8);
  token[0xc8] = writeN(0xc8, 2, Buffer.prototype.writeUInt16BE);
  token[0xc9] = writeN(0xc9, 4, Buffer.prototype.writeUInt32BE);

  // float 32 -- 0xca
  // float 64 -- 0xcb
  token[0xca] = writeN(0xca, 4, Buffer.prototype.writeFloatBE);
  token[0xcb] = writeN(0xcb, 8, Buffer.prototype.writeDoubleBE);

  // uint 8 -- 0xcc
  // uint 16 -- 0xcd
  // uint 32 -- 0xce
  // uint 64 -- 0xcf
  token[0xcc] = writeN(0xcc, 1, Buffer.prototype.writeUInt8);
  token[0xcd] = writeN(0xcd, 2, Buffer.prototype.writeUInt16BE);
  token[0xce] = writeN(0xce, 4, Buffer.prototype.writeUInt32BE);
  token[0xcf] = writeN(0xcf, 8, BufferLite.writeUint64BE);

  // int 8 -- 0xd0
  // int 16 -- 0xd1
  // int 32 -- 0xd2
  // int 64 -- 0xd3
  token[0xd0] = writeN(0xd0, 1, Buffer.prototype.writeInt8);
  token[0xd1] = writeN(0xd1, 2, Buffer.prototype.writeInt16BE);
  token[0xd2] = writeN(0xd2, 4, Buffer.prototype.writeInt32BE);
  token[0xd3] = writeN(0xd3, 8, BufferLite.writeUint64BE);

  // str 8 -- 0xd9
  // str 16 -- 0xda
  // str 32 -- 0xdb
  token[0xd9] = writeN(0xd9, 1, Buffer.prototype.writeUInt8);
  token[0xda] = writeN(0xda, 2, Buffer.prototype.writeUInt16BE);
  token[0xdb] = writeN(0xdb, 4, Buffer.prototype.writeUInt32BE);

  // array 16 -- 0xdc
  // array 32 -- 0xdd
  token[0xdc] = writeN(0xdc, 2, Buffer.prototype.writeUInt16BE);
  token[0xdd] = writeN(0xdd, 4, Buffer.prototype.writeUInt32BE);

  // map 16 -- 0xde
  // map 32 -- 0xdf
  token[0xde] = writeN(0xde, 2, Buffer.prototype.writeUInt16BE);
  token[0xdf] = writeN(0xdf, 4, Buffer.prototype.writeUInt32BE);

  return token;
}

function write1(type) {
  return function(encoder, value) {
    encoder.reserve(2);
    var buffer = encoder.buffer;
    var offset = encoder.offset;
    buffer[offset++] = type;
    buffer[offset++] = value;
    encoder.offset = offset;
  };
}

function write2(type) {
  return function(encoder, value) {
    encoder.reserve(3);
    var buffer = encoder.buffer;
    var offset = encoder.offset;
    buffer[offset++] = type;
    buffer[offset++] = value >>> 8;
    buffer[offset++] = value;
    encoder.offset = offset;
  };
}

function write4(type) {
  return function(encoder, value) {
    encoder.reserve(5);
    var buffer = encoder.buffer;
    var offset = encoder.offset;
    buffer[offset++] = type;
    buffer[offset++] = value >>> 24;
    buffer[offset++] = value >>> 16;
    buffer[offset++] = value >>> 8;
    buffer[offset++] = value;
    encoder.offset = offset;
  };
}

function writeN(type, len, method, noAssert) {
  return function(encoder, value) {
    encoder.reserve(len + 1);
    encoder.buffer[encoder.offset++] = type;
    method.call(encoder.buffer, value, encoder.offset, noAssert);
    encoder.offset += len;
  };
}

}).call(this,require("buffer").Buffer)
},{"./buffer-lite":55,"./write-uint8":73,"buffer":47}],72:[function(require,module,exports){
(function (Buffer){
// write-type.js

var IS_ARRAY = require("isarray");
var Int64Buffer = require("int64-buffer");
var Uint64BE = Int64Buffer.Uint64BE;
var Int64BE = Int64Buffer.Int64BE;

var BufferLite = require("./buffer-lite");
var WriteToken = require("./write-token");
var uint8 = require("./write-uint8").uint8;
var ExtBuffer = require("./ext-buffer").ExtBuffer;

var IS_BUFFER_SHIM = ("TYPED_ARRAY_SUPPORT" in Buffer);

var extmap = [];
extmap[1] = 0xd4;
extmap[2] = 0xd5;
extmap[4] = 0xd6;
extmap[8] = 0xd7;
extmap[16] = 0xd8;

exports.getWriteType = getWriteType;

function getWriteType(options) {
  var token = WriteToken.getWriteToken(options);

  var writeType = {
    "boolean": bool,
    "function": nil,
    "number": number,
    "object": object,
    "string": string,
    "symbol": nil,
    "undefined": nil
  };

  if (options && options.useraw) {
    writeType.object = object_raw;
    writeType.string = string_raw;
  }

  return writeType;

  // false -- 0xc2
  // true -- 0xc3
  function bool(encoder, value) {
    var type = value ? 0xc3 : 0xc2;
    token[type](encoder, value);
  }

  function number(encoder, value) {
    var ivalue = value | 0;
    var type;
    if (value !== ivalue) {
      // float 64 -- 0xcb
      type = 0xcb;
      token[type](encoder, value);
      return;
    } else if (-0x20 <= ivalue && ivalue <= 0x7F) {
      // positive fixint -- 0x00 - 0x7f
      // negative fixint -- 0xe0 - 0xff
      type = ivalue & 0xFF;
    } else if (0 <= ivalue) {
      // uint 8 -- 0xcc
      // uint 16 -- 0xcd
      // uint 32 -- 0xce
      type = (ivalue <= 0xFF) ? 0xcc : (ivalue <= 0xFFFF) ? 0xcd : 0xce;
    } else {
      // int 8 -- 0xd0
      // int 16 -- 0xd1
      // int 32 -- 0xd2
      type = (-0x80 <= ivalue) ? 0xd0 : (-0x8000 <= ivalue) ? 0xd1 : 0xd2;
    }
    token[type](encoder, ivalue);
  }

  // uint 64 -- 0xcf
  function uint64(encoder, value) {
    var type = 0xcf;
    token[type](encoder, value.toArray());
  }

  // int 64 -- 0xd3
  function int64(encoder, value) {
    var type = 0xd3;
    token[type](encoder, value.toArray());
  }

  // str 8 -- 0xd9
  // str 16 -- 0xda
  // str 32 -- 0xdb
  // fixstr -- 0xa0 - 0xbf
  function string(encoder, value) {
    // prepare buffer
    var length = value.length;
    var maxsize = 5 + length * 3;
    encoder.reserve(maxsize);

    // expected header size
    var expected = (length < 32) ? 1 : (length <= 0xFF) ? 2 : (length <= 0xFFFF) ? 3 : 5;

    // expected start point
    var start = encoder.offset + expected;

    // write string
    length = BufferLite.writeString.call(encoder.buffer, value, start);

    // actual header size
    var actual = (length < 32) ? 1 : (length <= 0xFF) ? 2 : (length <= 0xFFFF) ? 3 : 5;

    // move content when needed
    if (expected !== actual) move(encoder, start, length, actual - expected);

    // write header
    var type = (actual === 1) ? (0xa0 + length) : (actual <= 3) ? 0xd7 + actual : 0xdb;
    token[type](encoder, length);

    // move cursor
    encoder.offset += length;
  }

  function object(encoder, value) {
    // null
    if (value === null) return nil(encoder, value);

    // Buffer
    if (Buffer.isBuffer(value)) return bin(encoder, value);

    // Array
    if (IS_ARRAY(value)) return array(encoder, value);

    // int64-buffer objects
    if (Uint64BE.isUint64BE(value)) return uint64(encoder, value);
    if (Int64BE.isInt64BE(value)) return int64(encoder, value);

    // ext formats
    var packer = encoder.codec.getExtPacker(value);
    if (packer) value = packer(value);
    if (value instanceof ExtBuffer) return ext(encoder, value);

    // plain old objects
    map(encoder, value);
  }

  // nil -- 0xc0
  function nil(encoder, value) {
    var type = 0xc0;
    token[type](encoder, value);
  }

  // fixarray -- 0x90 - 0x9f
  // array 16 -- 0xdc
  // array 32 -- 0xdd
  function array(encoder, value) {
    var length = value.length;
    var type = (length < 16) ? (0x90 + length) : (length <= 0xFFFF) ? 0xdc : 0xdd;
    token[type](encoder, length);

    var encode = encoder.codec.encode;
    for (var i = 0; i < length; i++) {
      encode(encoder, value[i]);
    }
  }

  // bin 8 -- 0xc4
  // bin 16 -- 0xc5
  // bin 32 -- 0xc6
  function bin(encoder, value) {
    var length = value.length;
    var type = (length < 0xFF) ? 0xc4 : (length <= 0xFFFF) ? 0xc5 : 0xc6;
    token[type](encoder, length);
    encoder.send(value);
  }

  // fixext 1 -- 0xd4
  // fixext 2 -- 0xd5
  // fixext 4 -- 0xd6
  // fixext 8 -- 0xd7
  // fixext 16 -- 0xd8
  // ext 8 -- 0xc7
  // ext 16 -- 0xc8
  // ext 32 -- 0xc9
  function ext(encoder, value) {
    var buffer = value.buffer;
    var length = buffer.length;
    var type = extmap[length] || ((length < 0xFF) ? 0xc7 : (length <= 0xFFFF) ? 0xc8 : 0xc9);
    token[type](encoder, length);
    uint8[value.type](encoder);
    encoder.send(buffer);
  }

  // fixmap -- 0x80 - 0x8f
  // map 16 -- 0xde
  // map 32 -- 0xdf
  function map(encoder, value) {
    var keys = Object.keys(value);
    var length = keys.length;
    var type = (length < 16) ? (0x80 + length) : (length <= 0xFFFF) ? 0xde : 0xdf;
    token[type](encoder, length);

    var encode = encoder.codec.encode;
    keys.forEach(function(key) {
      encode(encoder, key);
      encode(encoder, value[key]);
    });
  }

  // raw 16 -- 0xda
  // raw 32 -- 0xdb
  // fixraw -- 0xa0 - 0xbf
  function string_raw(encoder, value) {
    // prepare buffer
    var length = value.length;
    var maxsize = 5 + length * 3;
    encoder.reserve(maxsize);

    // expected header size
    var expected = (length < 32) ? 1 : (length <= 0xFFFF) ? 3 : 5;

    // expected start point
    var start = encoder.offset + expected;

    // write string
    length = BufferLite.writeString.call(encoder.buffer, value, start);

    // actual header size
    var actual = (length < 32) ? 1 : (length <= 0xFFFF) ? 3 : 5;

    // move content when needed
    if (expected !== actual) move(encoder, start, length, actual - expected);

    // write header
    var type = (length < 32) ? (0xa0 + length) : (length <= 0xFFFF) ? 0xda : 0xdb;
    token[type](encoder, length);

    // move cursor
    encoder.offset += length;
  }

  // raw 16 -- 0xda
  // raw 32 -- 0xdb
  // fixraw -- 0xa0 - 0xbf
  function object_raw(encoder, value) {
    if (!Buffer.isBuffer(value)) return object(encoder, value);

    var length = value.length;
    var type = (length < 32) ? (0xa0 + length) : (length <= 0xFFFF) ? 0xda : 0xdb;
    token[type](encoder, length);
    encoder.send(value);
  }
}

function move(encoder, start, length, diff) {
  var targetStart = start + diff;
  var end = start + length;
  if (IS_BUFFER_SHIM) {
    BufferLite.copy.call(encoder.buffer, encoder.buffer, targetStart, start, end);
  } else {
    encoder.buffer.copy(encoder.buffer, targetStart, start, end);
  }
}

}).call(this,require("buffer").Buffer)
},{"./buffer-lite":55,"./ext-buffer":64,"./write-token":71,"./write-uint8":73,"buffer":47,"int64-buffer":52,"isarray":74}],73:[function(require,module,exports){
// write-unit8.js

var constant = exports.uint8 = new Array(256);

for (var i = 0x00; i <= 0xFF; i++) {
  constant[i] = write0(i);
}

function write0(type) {
  return function(encoder) {
    encoder.reserve(1);
    encoder.buffer[encoder.offset++] = type;
  };
}

},{}],74:[function(require,module,exports){
arguments[4][48][0].apply(exports,arguments)
},{"dup":48}]},{},[39]);