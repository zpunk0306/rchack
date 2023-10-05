const BigNumber = require('bignumber.js')
const { Script } = require('bitcore-lib-doge')

const tonumber = (value) => {
  return new BigNumber(value).toNumber() || 0
}

const tofix = (value, p) => {
  return new BigNumber(value || 0).toFixed(p, BigNumber.ROUND_DOWN)
}

const bnminus = (a, b) => {
  return new BigNumber(a).minus(new BigNumber(b)).toNumber()
}

const bndiv = (a, b) => {
  return new BigNumber(a).div(new BigNumber(b)).toNumber()
}

const bnmult = (a, b) => {
  return new BigNumber(a).multipliedBy(new BigNumber(b)).toNumber()
}

const bnadd = (a, b) => {
  return new BigNumber(a).plus(new BigNumber(b)).toNumber()
}

const bnfix = (a, fix = 2) => {
  return new BigNumber(a).toFixed(fix)
}

const bncomp = (a, b) => {
  return new BigNumber(a).comparedTo(new BigNumber(b))
}

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms)) // Wait 10 seconds
}

async function extract(transaction) {
  if (transaction && transaction[0].scriptSig.hex) {
    let script = Script.fromHex(transaction[0].scriptSig.hex)
    let chunks = script.chunks

    let prefix = chunks.shift().buf.toString('utf8')
    if (prefix != 'ord') {
      return null
    }

    let pieces = chunkToNumber(chunks.shift())
    chunks.shift().buf.toString('utf8')
    let data = Buffer.alloc(0)
    let remaining = pieces

    while (remaining && chunks.length) {
      let n = chunkToNumber(chunks.shift())
      data = Buffer.concat([data, chunks.shift().buf])
      remaining -= 1
    }
    return data
  } else {
    return null
  }
}

function chunkToNumber(chunk) {
  if (chunk.opcodenum == 0) return 0
  if (chunk.opcodenum == 1) return chunk.buf[0]
  if (chunk.opcodenum == 2) return chunk.buf[1] * 255 + chunk.buf[0]
  if (chunk.opcodenum > 80 && chunk.opcodenum <= 96) return chunk.opcodenum - 80
  return undefined
}

module.exports = {
  tonumber,
  tofix,
  bnminus,
  bndiv,
  bnmult,
  bnadd,
  bncomp,
  sleep,
  extract,
  bnfix,
}
