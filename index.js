const _ = require("lodash")
const { Script, Address, Transaction, PrivateKey, HDPrivateKey } = require('bitcore-lib-doge')
const { validateMnemonic, mnemonicToSeedSync } = require("bip39")
const axios = require('axios')
const { tonumber, bnadd, bnmult, bnfix } = require("./bn")
const dogecore = require('bitcore-lib-doge')
const { words_12, sender, apikey } = require('./config')
const args = require('minimist')(process.argv.slice(2))

const memetype = "text/plain;charset=utf8"
const MAX_CHUNK_LEN = 240
const MAX_PAYLOAD_LEN = 1500
const satoshi = 100000
const fixed_fee = 0.03
Transaction.DUST_AMOUNT = bnmult(0.001, 1e8)

var tick = ""
var amt = ""
var receiver = ""

const sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms)) // Wait 10 seconds
}

const createScript = () => {
    return new Script()
}

const getprivatekey = () => {
    const mnemonic = words_12
    const masterKey = HDPrivateKey.fromSeed(mnemonicToSeedSync(mnemonic).toString(`hex`))
    const accountKey = masterKey.deriveChild("m/44'/3'/0'/0/0")
    const privateKey = accountKey.privateKey.toString()
    return { privateKey, address: new PrivateKey(privateKey).toAddress().toString() }
}

function bufferToChunk(b, type) {
    b = Buffer.from(b, type)
    return {
        buf: b.length ? b : undefined,
        len: b.length,
        opcodenum: b.length <= 75 ? b.length : b.length <= 255 ? 76 : 77
    }
}

function numberToChunk(n) {
    return {
        buf: n <= 16 ? undefined : n < 128 ? Buffer.from([n]) : Buffer.from([n % 256, n / 256]),
        len: n <= 16 ? 0 : n < 128 ? 1 : 2,
        opcodenum: n == 0 ? 0 : n <= 16 ? 80 + n : n < 128 ? 1 : 2
    }
}

function opcodeToChunk(op) {
    return { opcodenum: op }
}

function utxosnotin(utxos, compareUtxos) {
    let newutxos = []
    try {
        const cmputxos = {}
        for (const ou of compareUtxos) {
            const xkey = `${ou.txid}-${String(ou.outputIndex)}`
            if (!Object.hasOwn(cmputxos, xkey) && ou?.satoshis > 0) {
                cmputxos[xkey] = ou
            }
        }

        for (const newo of utxos) {
            const xkey = `${newo.txid}-${String(newo.outputIndex)}`
            if (!Object.hasOwn(cmputxos, xkey) && newo?.satoshis > 0) {
                newutxos.push(newo)
            }
        }
    } catch (error) {
        newutxos = utxos
    }
    return newutxos
}

const transferUxtos = (address, uxtos) => {
    return uxtos.map(
        (v) => {
            return Object.assign({}, {
                address,
                txid: _.get(v, ["txid"]),
                outputIndex: _.get(v, ["vout"]),
                script: _.get(v, ["script"], null) || Script.buildPublicKeyHashOut(address).toString(),
                satoshis: tonumber(_.get(v, ["value"])),
                time: _.get(v, ["time"], Date.now()),
                confirmations: _.get(v, ["confirmations"]),
                height: _.get(v, ["height"], null),
            })
        }
    )
}

const send_transaction = async (hex) => {
    let txid = null
    try {
        const res = await axios({
            method: 'post',
            url: `https://doge.nownodes.io`,
            responseType: "json",
            headers: {
                'Content-Type': 'application/json'
            },
            data: {
                "API_key": apikey,
                "jsonrpc": "2.0",
                "id": "test",
                "method": "sendrawtransaction",
                "params": [hex]
            }
        })
        if (res?.data) {
            txid = res.data.result
        }
    } catch (error) {
        console.error(error)
    }
    return txid
}

const getutxos = async (address) => {
    let utxos = []
    try {
        const res = await axios({
            method: 'get',
            url: `https://dogebook.nownodes.io/api/v2/utxo/${address}`,
            responseType: "json",
            headers: {
                'api-key': apikey,
                'Content-Type': 'application/json'
            }
        })
        if (res?.data) {
            utxos = res.data
        }
    } catch (error) {
        console.error(`Error: ${error.message}`)
        throw error
    }
    return transferUxtos(address, utxos)
}

const goInscribe = (transaction, priKey, utxos) => {
    try {
        let amountTotal = tonumber(transaction.outputAmount) || 0
        const t_fees = fixed_fee * 1e8
        const used_utxos = []
        let curvalue = 0
        for (const u of utxos) {
            used_utxos.push(u)
            curvalue = bnadd(curvalue, u.satoshis)
            if (curvalue >= bnadd(amountTotal, t_fees)) {
                break
            }
        }
        if (curvalue < bnadd(amountTotal, t_fees)) {
            throw new Error(`not enough utxo`)
        }
        if (used_utxos && used_utxos.length > 0) {
            transaction
                .from(used_utxos)
                .fee(t_fees)
                .change(sender)
                .sign(priKey)
            return [transaction, used_utxos]
        }
    } catch (error) {
        throw error
    }
    return [null, null]
}

const createTransactionB = async (amount, keystring = null) => {
    if (!keystring) throw new Error(`not found key.`)

    const utxos = await getutxos(sender) || []
    const useable_utxos = _.filter(utxos, (e) => { return e.satoshis > 0 && e.confirmations > 0 })

    let temputxos = useable_utxos
    if (useable_utxos.length <= 0) {
        throw new Error(`not enough utxo for transaction.`)
    }

    const transfobj = {
        "p": "drc-20",
        "op": "transfer",
        "amt": String(amount),
        "tick": tick
    }

    const txs = []
    const texthex = Buffer.from(JSON.stringify(transfobj, null, 2), "utf8").toString("hex")
    let data = Buffer.from(texthex, "hex")

    const privateKey = new PrivateKey(keystring)
    const publicKey = privateKey.toPublicKey() // privateKey.toPublicKey()
    const parts = []

    while (data.length) {
        const part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length))
        data = data.slice(part.length)
        parts.push(part)
    }

    const inscription = new Script()
    inscription.chunks.push(bufferToChunk('ord'))
    inscription.chunks.push(numberToChunk(parts.length))
    inscription.chunks.push(bufferToChunk(memetype))
    parts.forEach((part, n) => {
        inscription.chunks.push(numberToChunk(parts.length - n - 1))
        inscription.chunks.push(bufferToChunk(part))
    })

    let p2shInput
    let lastLock
    let lastPartial

    const Hash = dogecore.crypto.Hash
    const Signature = dogecore.crypto.Signature

    while (inscription.chunks.length) {
        const partial = createScript()

        if (txs.length == 0) {
            partial.chunks.push(inscription.chunks.shift())
        }

        while (partial.toBuffer().length <= MAX_PAYLOAD_LEN && inscription.chunks.length) {
            partial.chunks.push(inscription.chunks.shift())
            partial.chunks.push(inscription.chunks.shift())
        }

        if (partial.toBuffer().length > MAX_PAYLOAD_LEN) {
            inscription.chunks.unshift(partial.chunks.pop())
            inscription.chunks.unshift(partial.chunks.pop())
        }

        const _Opcode = dogecore.Opcode
        const lock = createScript()
        lock.chunks.push(bufferToChunk(publicKey.toBuffer()))
        lock.chunks.push(opcodeToChunk(_Opcode.OP_CHECKSIGVERIFY))
        partial.chunks.forEach(() => {
            lock.chunks.push(opcodeToChunk(_Opcode.OP_DROP))
        })
        lock.chunks.push(opcodeToChunk(_Opcode.OP_TRUE))

        const lockhash = Hash.ripemd160(Hash.sha256(lock.toBuffer()))

        const p2sh = createScript()
        p2sh.chunks.push(opcodeToChunk(_Opcode.OP_HASH160))
        p2sh.chunks.push(bufferToChunk(lockhash))
        p2sh.chunks.push(opcodeToChunk(_Opcode.OP_EQUAL))

        const p2shOutput = new Transaction.Output({
            script: p2sh,
            satoshis: satoshi
        })

        let tx = new Transaction()
        if (p2shInput) tx.addInput(p2shInput)
        tx.addOutput(p2shOutput)

        if (p2shInput) {
            const signature = Transaction.sighash.sign(tx, privateKey, Signature.SIGHASH_ALL, 0, lastLock)
            const txsignature = Buffer.concat([signature.toBuffer(), Buffer.from([Signature.SIGHASH_ALL])])
            const unlock = createScript()
            unlock.chunks = unlock.chunks.concat(lastPartial.chunks)
            unlock.chunks.push(bufferToChunk(txsignature))
            unlock.chunks.push(bufferToChunk(lastLock.toBuffer()))
            tx.inputs[0].setScript(unlock)
        }

        const [newtx, usedtxos] = goInscribe(tx, keystring, temputxos)
        if (!newtx || !usedtxos || usedtxos.length <= 0) {
            throw new Error(`process create transactino inscription error`)
        }
        tx = newtx

        txs.push([tx, usedtxos])
        temputxos = utxosnotin(temputxos, usedtxos)

        // eslint-disable-next-line @typescript-eslint/no-loop-func
        tx.outputs.forEach((output, vout) => {
            if (output.script.toAddress().toString() == sender) {
                temputxos.push({
                    address: sender,
                    txid: tx.hash,
                    outputIndex: vout,
                    script: output.script.toString(),
                    satoshis: output.satoshis,
                    confirmations: 0
                })
            }
        })
        p2shInput = new Transaction.Input({
            prevTxId: tx.hash,
            outputIndex: 0,
            output: tx.outputs[0],
            script: ''
        })

        p2shInput.clearSignatures = () => { }
        p2shInput.getSignatures = () => { }

        lastLock = lock
        lastPartial = partial

    }

    let tx = new Transaction()
    tx.addInput(p2shInput)
    const toList = []
    toList.push({ address: receiver, satoshis: satoshi })
    tx.to(toList)

    const [newtx, usedtxos] = goInscribe(tx, keystring, temputxos)
    if (!newtx || !usedtxos || usedtxos.length <= 0) {
        throw new Error(`process create transactino inscription error`)
    }
    const signature = Transaction.sighash.sign(tx, privateKey, Signature.SIGHASH_ALL, 0, lastLock)
    const txsignature = Buffer.concat([signature.toBuffer(), Buffer.from([Signature.SIGHASH_ALL])])

    const unlock = createScript()
    unlock.chunks = unlock.chunks.concat(lastPartial.chunks)
    unlock.chunks.push(bufferToChunk(txsignature))
    unlock.chunks.push(bufferToChunk(lastLock.toBuffer()))
    tx.inputs[0].setScript(unlock)

    tx = newtx
    txs.push([tx, usedtxos])
    temputxos = utxosnotin(temputxos, usedtxos)

    tx.outputs.forEach((output, vout) => {
        if (output.script.toAddress().toString() == sender) {
            temputxos.push({
                address: sender,
                txid: tx.hash,
                outputIndex: vout,
                script: output.script.toString(),
                satoshis: output.satoshis,
                confirmations: 0
            })
        }
    })

    return { txs, temputxos }
}

const main = async () => {
    tick = args["tick"]
    amt = String(args["amt"])
    receiver = String(args["receiver"])

    if (_.isEmpty(tick) || _.isEmpty(amt)) {
        throw new Error(`tick or amt params error.`)
    }

    if (!Address.isValid(receiver)) {
        throw new Error(`receiver params error.`)
    }

    if (
        _.isEmpty(words_12) ||
        !Address.isValid(sender) ||
        !validateMnemonic(words_12)
    ) {
        throw new Error(`data config error or address || words error!`)
    }

    if (_.isEmpty(apikey)) {
        throw new Error(`apikey error,u need to config a nownowdes free apikey.`)
    }

    const { privateKey } = getprivatekey()
    const { txs, temputxos } = await createTransactionB(amt, privateKey)

    const sended_txs = []
    for (let index = 0; index < txs.length; index++) {
        const [tx, usedtxos] = txs[index]
        let sendedTxid = null
        while (!sendedTxid) {
            sendedTxid = await send_transaction(tx.toString())
            if (sendedTxid) {
                sended_txs.push(sendedTxid)
                console.log(`send transaction success ${sendedTxid}`)
            } else {
                console.log(`error in send transaction try again`)
            }
            console.info(`wait 5 second`)
            await sleep(5000 * 1)
        }
    }
    console.log(`inscription transaction`, sended_txs[1])
}

main()