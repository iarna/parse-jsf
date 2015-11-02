'use strict'
var fs = require('fs')
var parse = require('./parse.js')

var syntax = {
  colors: {},
  toplevel: {
    states: {},
    initial: null
  },
  subrs: {},
  synclines: 50
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
    if (thing.kind === 'glob') {
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
  } else if (thing.type === 'sync') {
    syntax.synclines = Number(thing.lines) || Infinity
  } else {
    throw new Error('unknown sort of thing')
  }
})
.on('end', function () {
  var overall = ''
  overall += 'var subs = {}\n'
  overall += 'var default = module.exports = {\n'
  var first
  Object.keys(syntax.toplevel.states).forEach(function (name) {
    if (first == null) first = name
    overall += stateToCode(syntax.toplevel.states[name], '  ')
  })
  overall += '}\n'
  overall += "default[''] = default['"+first+"']\n"
  Object.keys(syntax.subrs).forEach(function (subname) {
  overall += "\n"
    overall += "subs['" + subname + "'] = {\n"
    var sub = syntax.subrs[subname]
    var first = null
    Object.keys(sub.states).forEach(function (name) {
      overall += stateToCode(sub.states[name], '  ')
    })
    overall += '}\n'
    overall += "default[''] = default['"+first+"']\n"
  })
  console.log(overall)
})

function matchToCode (state, matcher, indent) {
  var code = ''
  if (matcher.kind === 'str') {
    code += indent + 'if (/[' + matcher.match + ']/) {\n'
    code += goto(state, matcher, indent + '  ')
    code += indent + '}\n'
  } else {
    code += goto(state, matcher, indent)
  }
  return code
}

function goto(state, matcher, indent) {
  var code = ''
  console.log(matcher)
  if (! matcher.options.noeat) {
    code += indent + "parser.take('" + state.color + "')\n"
  }
  if (matcher.options.call) {
    var subname = matcher.options.call.substr(1,-2)
    code += indent + "parser.call(subs['" + subname + "'], " + state.name + ", '" + matcher.goto + "')\n"
  } else {
    code += indent + "return '" + matcher.goto + "'\n"
  }
  return code
}

function stateToCode (state, indent) {
  var code =  indent + state.name + ': function ' + state.name + ' (parser, char) {\n'
  state.matches.forEach(function (matcher) {
    if (matcher.type == 'stringsdone') return
    code += matchToCode(state, matcher, indent + '  ')
  })
  if (state.default) {
    code += matchToCode(state, state.default, indent + '  ')
  }
  code += indent + '},\n'
  return code
}


/*
{ name: 'comment',
  color: 'Comment comment',
  default: null,
  matches:
   [ { type: 'match',
       kind: 'glob',
       match: '',
       goto: 'comment',
       options: {},
       ifdef: [] },
     { type: 'match',
       kind: 'str',
       match: 'n',
       goto: 'idle',
       options: {},
       ifdef: [] } ] }
*/