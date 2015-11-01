var inherits = require('util').inherits
var Transform = require('stream').Transform
module.exports = parse

function parse () {
  return new ParseJSF()
}

function ParseJSF(opts) {
  if (!opts) opts = {}
  opts.mode = 'object'
  Transform.call(this, opts)
  this._writableState.objectMode = false;
  this._readableState.objectMode = true;
  this._currentState = line_start
  this.line = 0
  this.col = 0
}
inherits(ParseJSF, Transform)

ParseJSF.prototype._flush = function (cb) {
  this._consumeCharacter('\n')
  cb()
}

ParseJSF.prototype._transform = function (data, enc, cb) {
  data = data.toString('utf8')
  for (var ii=0; ii<data.length; ++ii) {
    var newState = this._consumeCharacter(data[ii])
    if (!newState) throw 'Error: ' + this._currentState.name + ' failed to return a new state'
    this._currentState = newState
  }
  cb()
}

ParseJSF.prototype._consumeCharacter = function (char) {
  try {
    this.col ++
    return this._currentState(this, char)
  } catch (er) {
    console.error(er.message + ' at ' + this.line + ', ' + this.col + ' (' + this._currentState.name + ')')
    console.error({line: this.line, col: this.col, declr: this.declr, char: char})
    console.error(er.stack)
    process.exit(1)
  }
}

function newline (hl) {
  hl.line ++
  hl.col = 0
  if (hl.declr && hl.declr.type) {
    ['name', 'color', 'goto', 'match'].forEach(function (key) {
      if (hl.declr[key] == null) return
      hl.declr[key] = hl.declr[key].trim()
    })
    if (hl.declr.options != null) {
      var opts = {}
      if (hl.declr.options != '') {
        hl.declr.options.trim().split(' ').forEach(function (opt) {
          var match = opt.match(/^([^=]+)=(.*?)$/)
          if (match) {
            opts[match[1]] = match[2]
          } else {
            opts[opt] = true
          }
        })
      }
      hl.declr.options = opts
    }
    hl.push(hl.declr)
  }
  hl.declr = {line: hl.line}
  return line_start
}

function match (str, next) {
  var chars = str.split('')
  var lastChar = chars.pop()
  var matchChars = chars.map(function (matchChar, ii) {
    return function (hl, char) {
      if (char !== matchChar) throw new Error('Invalid ' + char + '!==' + matchChar)
      return matchChars[ii+1]
    }
  })
  matchChars.push(function (hl, char) {
    if (char !== lastChar) throw new Error('Invalid')
    return next
  })
  return matchChars[0]
}

function isSpace (char) {
  return char === '\t' || char === ' ' || char === '\r'
}

function isNL (char) {
  return char === '\n'
}

function line_start (hl, char) {
  if (char === '#') return eolcomment
  if (isNL(char)) return newline(hl)
  if (isSpace(char)) return line_start
  if (char === '=') return defcolor_start
  if (char === ':') return defstate_start
  if (char === '.') return cmd_start
  if (char === '*') return stateline_glob(hl)
  if (char === '&') return stateline_buffer(hl)
  if (char === '"') return stateline_str(hl)
  if (char === 'd') return done_start(hl, char)
  throw new Error('Invalid')
}

function eolcomment (hl, char) {
  if (isNL(char)) return newline(hl)
  return eolcomment
}

function defcolor_start (hl, char) {
  if (isNL(char) || char === '#') throw new Error('Invalid')
  if (isSpace(char)) throw new Error('Invalid')
  hl.declr = {type: 'defcolor', name: char, color: ''}
  return defcolor
}

function defcolor (hl, char) {
  if (isSpace(char)) return defcolor_sep
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  hl.declr.name += char
  return defcolor
}

function sep(value) {
  return function thissep (hl, char) {
    if (isSpace(char)) return thissep
    if (isNL(char)) return newline(hl)
    if (char === '#') return eolcomment
    return value(hl, char)
  }
}

var defcolor_sep = sep(function defcolor_value (hl, char) {
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  hl.declr.color += char
  return defcolor_value
})

function defstate_start (hl, char) {
  if (isNL(char) || char === '#') throw new Error('Invalid')
  if (isSpace(char)) throw new Error('Invalid')
  hl.declr = {type: 'defstate', name: char, color: ''}
  return defstate
}

function defstate (hl, char) {
  if (isSpace(char)) return defstate_sep
  if (isNL(char)) throw new Error('Invalid')
  if (char === '#') throw new Error('Invalid')
  hl.declr.name += char
  return defstate
}

var defstate_sep = sep(function defstate_value (hl, char) {
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  hl.declr.color += char
  return defstate_value
})

function cmd_start (hl, char) {
  if (isNL(char) || char === '#') throw new Error('Invalid')
  if (isSpace(char)) throw new Error('Invalid')
  hl.declr = { type: '' }
  return cmd_name(hl, char)
}

function cmd_name (hl, char) {
  if (/\w/.test(char)) {
    hl.declr.type += char
    return cmd_name
  }
  switch (hl.declr.type) {
    case 'subr':
      hl.declr = {type: 'subrstart', name: ''}
      return cmd_sep(hl, char)
    case 'end':
      hl.declr = {type: 'subrend'}
      return cmd_end(hl, char)
    case 'ifdef':
      hl.declr.name = ''
      return cmd_sep(hl, char)
    case 'else':
      return cmd_end(hl, char)
    case 'endif':
      return cmd_end(hl, char)
    default:
      throw new Error('Invalid parser directovie: ' + hl.declr.type)
  }
}

var cmd_sep = sep(function (hl, char) {
  if (isNL(char) || char === '#') throw new Error('Invalid')
  return cmd_value(hl, char)
})

function cmd_value (hl, char) {
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  hl.declr.name += char
  return cmd_value
}

function cmd_end (hl, char) {
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  if (isSpace(char)) return subr_end
  throw new Error('Invalid')
}

var done_start = match('done', function done_line (hl, char) {
  hl.declr = {type: 'stringsdone'}
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  if (isSpace(char)) return done_line
  throw new Error('Invalid')
})

function stateline_buffer(hl) {
  hl.declr = {type:'match', kind: 'buffer', match: '', goto: '', options: ''}
  return stateline_sep_goto
}

function stateline_glob (hl) {
  hl.declr = {type:'match', kind: 'glob', match: '', goto: '', options: ''}
  return stateline_sep_goto
}

var stateline_sep_goto = sep(function (hl, char) {
  if (isNL(char) || char === '#') throw new Error('Invalid')
  if (isSpace(char)) throw new Error('Invalid')
  return stateline_goto(hl, char)
})

function stateline_goto (hl, char) {
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  if (isSpace(char)) return stateline_sep_options
  hl.declr.goto += char
  return stateline_goto
}

var stateline_sep_options = sep(function stateline_options (hl, char) {
  if (isNL(char)) return newline(hl)
  if (char === '#') return eolcomment
  hl.declr.options += char
  return stateline_options
})

function stateline_str (hl) {
  hl.declr = {type:'match', kind: 'str', match: '', goto: '', options: ''}
  return stateline_str_match
}

function stateline_str_match (hl, char) {
  if (isNL(char)) throw new Error('Invalid')
  if (char === '"') return stateline_str_end
  if (char === '\\') return stateline_str_bs
  hl.declr.match += char
  return stateline_str_match
}

function stateline_str_bs (hl, char) {
  if (isNL(char) || char === '#') throw new Error('Invalid')
  hl.declr.match += char
  return stateline_str_match
}

function stateline_str_end (hl, char) {
  if (isSpace(char)) return stateline_sep_goto
  throw new Error('Invalid')
}
