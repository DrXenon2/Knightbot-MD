/**
 * Knight Bot - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { smsg, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
// Using a lightweight persisted store instead of makeInMemoryStore (compat across versions)
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000) // every 1 minute

// Memory monitoring - Restart if RAM gets too high
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1) // Panel will auto-restart
    }
}, 30_000) // check every 30 seconds

// CORRECTION : Utiliser le numéro de téléphone des settings
let phoneNumber = settings.ownerNumber || process.env.PHONE_NUMBER || "2250501758422"
let owner = []
try {
    owner = JSON.parse(fs.readFileSync('./data/owner.json'))
} catch (error) {
    console.log('⚠️ Fichier owner.json non trouvé, utilisation des settings')
    owner = [settings.ownerNumber || phoneNumber]
}

global.phoneNumber = phoneNumber
global.botname = "DR XENON"
global.themeemoji = "•"

// CORRECTION : Toujours utiliser pairing code pour plus de simplicité
const pairingCode = true // Forcer l'utilisation du pairing code
const useMobile = false // Désactivé car incompatible avec pairing code

// Only create readline interface if we're in an interactive environment
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        // In non-interactive environment, use ownerNumber from settings
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}

async function startXeonBotInc() {
    try {
        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false, // Désactivé car on utilise pairing code
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: true,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: undefined,
        })

        store.bind(XeonBotInc.ev)

        // CORRECTION : Gestion du pairing code AVANT les autres événements
        if (!XeonBotInc.authState.creds.registered) {
            console.log(chalk.yellow('📱 Configuration du pairing code...'))
            
            let phoneNumberToUse = phoneNumber
            
            // Si pas de numéro dans les settings, demander interactivement
            if (!phoneNumberToUse && rl) {
                phoneNumberToUse = await question(chalk.bgBlack(chalk.greenBright(`\nVeuillez entrer votre numéro WhatsApp 😍\nFormat: 2250500107362 (sans + ou espaces) : `)))
            }

            if (!phoneNumberToUse) {
                console.log(chalk.red('❌ Aucun numéro de téléphone fourni. Vérifiez vos settings.'))
                process.exit(1)
            }

            // Nettoyer le numéro de téléphone
            phoneNumberToUse = phoneNumberToUse.replace(/[^0-9]/g, '')

            // Validation du numéro
            try {
                const pn = new PhoneNumber(phoneNumberToUse, 'ZZ') // 'ZZ' pour numéro international
                if (!pn.isValid()) {
                    console.log(chalk.red('❌ Numéro de téléphone invalide. Format: 2250500107362 (sans +)'))
                    process.exit(1)
                }
            } catch (error) {
                console.log(chalk.yellow('⚠️ Validation du numéro ignorée, continuation...'))
            }

            console.log(chalk.blue(`🔢 Numéro utilisé: ${phoneNumberToUse}`))

            // Demander le pairing code
            try {
                const code = await XeonBotInc.requestPairingCode(phoneNumberToUse)
                const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code
                
                console.log(chalk.green('\n╔══════════════════════════════════════╗'))
                console.log(chalk.green('║           🤖 PAIRING CODE           ║'))
                console.log(chalk.green('╠══════════════════════════════════════╣'))
                console.log(chalk.green(`║          ${chalk.bold.white(formattedCode)}          ║`))
                console.log(chalk.green('╚══════════════════════════════════════╝'))
                
                console.log(chalk.yellow('\n📝 Instructions:'))
                console.log(chalk.white('1. Ouvrez WhatsApp sur votre téléphone'))
                console.log(chalk.white('2. Allez dans Paramètres > Appareils liés'))
                console.log(chalk.white('3. Appuyez sur "Lier un appareil"'))
                console.log(chalk.white('4. Entrez le code ci-dessus'))
                console.log(chalk.white('5. Attendez la connexion...\n'))
                
            } catch (error) {
                console.log(chalk.red('❌ Erreur lors de la demande du pairing code:'))
                console.log(chalk.red(error.message))
                console.log(chalk.yellow('💡 Vérifiez votre numéro et réessayez'))
                process.exit(1)
            }
        }

        // Message handling
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek.message) return
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate);
                    return;
                }
                if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

                // Clear message retry cache to prevent memory bloat
                if (XeonBotInc?.msgRetryCounterCache) {
                    XeonBotInc.msgRetryCounterCache.clear()
                }

                try {
                    await handleMessages(XeonBotInc, chatUpdate, true)
                } catch (err) {
                    console.error("Error in handleMessages:", err)
                    // Only try to send error message if we have a valid chatId
                    if (mek.key && mek.key.remoteJid) {
                        await XeonBotInc.sendMessage(mek.key.remoteJid, {
                            text: '❌ An error occurred while processing your message.',
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363161513685998@newsletter',
                                    newsletterName: 'KnightBot MD',
                                    serverMessageId: -1
                                }
                            }
                        }).catch(console.error);
                    }
                }
            } catch (err) {
                console.error("Error in messages.upsert:", err)
            }
        })

        // Add these event handlers for better functionality
        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        XeonBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = XeonBotInc.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        XeonBotInc.getName = (jid, withoutContact = false) => {
            id = XeonBotInc.decodeJid(jid)
            withoutContact = XeonBotInc.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
                XeonBotInc.user :
                (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        XeonBotInc.public = true

        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

        // Connection handling
        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s
            if (connection == "open") {
                console.log(chalk.green('\n✅ Connexion WhatsApp établie avec succès!'))
                console.log(chalk.yellow(`🌿 Connecté en tant que: ` + JSON.stringify(XeonBotInc.user.id, null, 2)))

                // Envoyer un message de confirmation
                try {
                    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await XeonBotInc.sendMessage(botNumber, {
                        text: `🤖 Bot Connecté avec Succès!\n\n⏰ Heure: ${new Date().toLocaleString()}\n✅ Statut: En ligne et prêt!`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363161513685998@newsletter',
                                newsletterName: 'KnightBot MD',
                                serverMessageId: -1
                            }
                        }
                    });
                } catch (error) {
                    console.log('⚠️ Impossible d\'envoyer le message de confirmation')
                }

                await delay(1999)
                console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'KNIGHT BOT'} ]`)}\n\n`))
                console.log(chalk.cyan(`< ================================================== >`))
                console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: MR UNIQUE HACKER`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: mrunqiuehacker`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: MR UNIQUE HACKER`))
                console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connecté avec Succès! ✅`))
                console.log(chalk.blue(`Version du Bot: ${settings.version}`))
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode
                console.log(chalk.yellow(`🔌 Connexion fermée (Code: ${statusCode})`))
                
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync('./session', { recursive: true, force: true })
                        console.log(chalk.red('🗑️ Session déconnectée. Fichiers supprimés.'))
                    } catch { }
                    console.log(chalk.yellow('🔄 Redémarrage dans 5 secondes...'))
                    setTimeout(startXeonBotInc, 5000)
                } else {
                    console.log(chalk.yellow('🔄 Reconnexion dans 3 secondes...'))
                    setTimeout(startXeonBotInc, 3000)
                }
            }
        })

        // Track recently-notified callers to avoid spamming messages
        const antiCallNotified = new Set();

        // Anticall handler: block callers when enabled
        XeonBotInc.ev.on('call', async (calls) => {
            try {
                const { readState: readAnticallState } = require('./commands/anticall');
                const state = readAnticallState();
                if (!state.enabled) return;
                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId;
                    if (!callerJid) continue;
                    try {
                        // First: attempt to reject the call if supported
                        try {
                            if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
                                await XeonBotInc.rejectCall(call.id, callerJid);
                            } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
                                await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                            }
                        } catch {}

                        // Notify the caller only once within a short window
                        if (!antiCallNotified.has(callerJid)) {
                            antiCallNotified.add(callerJid);
                            setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                            await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.' });
                        }
                    } catch {}
                    // Then: block after a short delay to ensure rejection and message are processed
                    setTimeout(async () => {
                        try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {}
                    }, 800);
                }
            } catch (e) {
                // ignore
            }
        });

        XeonBotInc.ev.on('creds.update', saveCreds)

        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        });

        XeonBotInc.ev.on('messages.upsert', async (m) => {
            if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, m);
            }
        });

        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        XeonBotInc.ev.on('messages.reaction', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        return XeonBotInc

    } catch (error) {
        console.error(chalk.red('❌ Erreur lors du démarrage du bot:'), error)
        console.log(chalk.yellow('🔄 Nouvelle tentative dans 10 secondes...'))
        setTimeout(startXeonBotInc, 10000)
    }
}

// Start the bot with error handling
startXeonBotInc().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
})

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})
