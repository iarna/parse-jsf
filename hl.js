'use strict'
var fs = require('fs')
var parse = require('./parse.js')

var syntax = {
  colors: {},
  toplevel: {
    states: {},
    initial: null
  },
  subrs: {}
}
var subr = syntax.toplevel
var ifdef = []
var state = null
fs.createReadStream(process.argv[2],{encoding: 'utf8'}).pipe(parse()).on('data', function (thing) {
  if (thing.type === 'defcolor') {
    syntax.colors[thing.name] = thing.color.split(/\s+/)
  } else if (thing.type === 'defstate') {
    state = subr.states[thing.name] = {
      name: thing.name,
      color: thing.color,
      default: null,
      matches: [],
    }
    if (!subr.initial) subr.initial = state
  } else if (thing.type === 'match') {
    thing.ifdef = [].concat(ifdef)
    if (thing.type === 'glob') {
      state.default = thing
    } else {
      state.matches.push(thing)
    }
  } else if (thing.type === 'stringsdone') {
    state.matches.push(thing)
  } else if (thing.type === 'subrstart') {
    subr = syntax.subrs[thing.name] = {
      name: thing.name,
      states: {},
      initial: null
    }
  } else if (thing.type === 'subrend') {
    subr = syntax.toplevel
  } else if (thing.type === 'ifdef') {
    ifdef.push(thing.name)
  } else if (thing.type === 'else') {
    ifdef.push('!' + ifdef.pop())
  } else if (thing.type === 'endif') {
    ifdef.pop()
  } else {
    throw new Error('unknown sort of thing')
  }
})
.on('end', function () {
  console.log(syntax)
})
