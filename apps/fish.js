import plugin from '../../../lib/plugins/plugin.js'
import fetch from 'node-fetch'
import _ from 'lodash'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 使用 import.meta.url 获取当前文件的目录路径，这是定位配置文件的最可靠方法
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// pluginRoot 变量不再用于定位此插件的配置文件
const pluginRoot = (typeof global !== 'undefined' && global.pluginRoot) ? global.pluginRoot : process.cwd()

export class FishPlugin extends plugin {
    constructor() {
        super({
            name: 'Fish TTS语音',
            dsc: 'Fish TTS',
            event: 'message',
            priority: -1000000,
            rule: [
                {
                    reg: '^#语音\\s+(.+)$',
                    fnc: 'speakText',
                    // permission: 'master'
                },
                {
                    reg: '^#fish帮助$',
                    fnc: 'showHelp'
                },
                {
                    // MODIFIED: 修改指令正则，将 "#添加(fish)?key" 改为 "#fish添加key"
                    reg: '^#fish添加key\\s*(.+)$',
                    fnc: 'addApiKey'
                },
                {
                    // MODIFIED: 修改指令正则，将 "#添加(fish)?音色" 改为 "#fish添加音色"
                    reg: '^#fish添加音色\\s*(.+)$',
                    fnc: 'addVoice'
                }
            ]
        })
    }

    // --- 新增功能：显示帮助 ---
    async showHelp(e) {
        const helpMsg = [
            'Fish TTS 语音同传 帮助：',
            // MODIFIED: 更新帮助文档中的指令示例
            '1. #fish添加key [你的Fish API Key]',
            '   示例: #fish添加key 8c80794fc7...',
            '2. #fish添加音色 [音色ID]',
            '   示例: #fish添加音色 625501a13e...',
            '3. 如何获取KEY和音色？(需使用该网站充值获得额度，最低1$）',
            '   https://fish.audio/zh-CN/go-api/billing/',
            '4. #语音 [要朗读的文本] (主人权限)',
            '   让机器人朗读指定文本。',
        ].join('\n')
        await e.reply(helpMsg)
    }

    // --- 新增功能：添加API Key ---
    async addApiKey(e) {
        const qq = String(e.user_id)
        if (!qq) return await e.reply('无法获取你的QQ号，操作失败')

        // MODIFIED: 更新用于提取key的正则表达式
        const match = e.msg.match(/^#fish添加key\s*(.+)$/)
        // NOTE: match[1] 将会是捕获组 (.+)，即key本身
        const apiKey = match[1].trim()

        if (!apiKey) {
            // MODIFIED: 更新错误提示信息
            return await e.reply('Key不能为空，请按格式输入：#fish添加key [你的API Key]')
        }

        const filePath = path.join(__dirname, 'fish_key.json')
        const fishKeyMap = readJsonSafe(filePath)
        
        // 此处直接赋值，即可实现对该用户旧数据的覆盖
        fishKeyMap[qq] = apiKey

        const success = writeJsonSafe(filePath, fishKeyMap)
        if (success) {
            await e.reply(`你的Fish API Key已成功设置为：${apiKey}`)
        } else {
            await e.reply('设置失败，可能是文件写入权限不足，请联系管理员。')
        }
    }

    // --- 新增功能：添加音色 ---
    async addVoice(e) {
        const qq = String(e.user_id)
        if (!qq) return await e.reply('无法获取你的QQ号，操作失败')

        // MODIFIED: 更新用于提取音色ID的正则表达式
        const match = e.msg.match(/^#fish添加音色\s*(.+)$/)
        // NOTE: match[1] 将会是捕获组 (.+)，即音色ID本身
        const voiceId = match[1].trim()

        if (!voiceId) {
            // MODIFIED: 更新错误提示信息
            return await e.reply('音色ID不能为空，请按格式输入：#fish添加音色 [音色ID]')
        }

        const filePath = path.join(__dirname, 'fish_audio.json')
        const fishAudioMap = readJsonSafe(filePath)

        // 此处直接赋值，即可实现对该用户旧数据的覆盖
        fishAudioMap[qq] = voiceId

        const success = writeJsonSafe(filePath, fishAudioMap)
        if (success) {
            await e.reply(`你的默认音色已成功设置为：${voiceId}`)
        } else {
            await e.reply('设置失败，可能是文件写入权限不足，请联系管理员。')
        }
    }

    // 朗读文本（#语音 xxx 指令）
    async speakText(e) {
        const match = e.msg.match(/^#语音\s+(.+)$/)
        if (!match || !match[1]) {
            await e.reply('格式错误，正确用法：#语音 你要朗读的内容')
            return
        }
        const text = match[1].trim()
        if (!text) {
            await e.reply('朗读内容不能为空')
            return
        }
        const qq = (e && e.sender && e.sender.user_id) ? String(e.sender.user_id) : (e.user_id ? String(e.user_id) : null)
        logger.info('[Fish调试] 当前QQ号:', qq)
        if (!qq) {
            await e.reply('无法识别调用者 QQ，请联系管理员')
            return
        }

        const fishKeyMap = readJsonSafe(path.join(__dirname, 'fish_key.json'))
        const fishAudioMap = readJsonSafe(path.join(__dirname, 'fish_audio.json'))
        logger.info('[Fish调试] fishKeyMap:', fishKeyMap)
        logger.info('[Fish调试] fishAudioMap:', fishAudioMap)

        const apiKey = fishKeyMap && fishKeyMap[qq] ? fishKeyMap[qq] : null
        logger.info('[Fish调试] 选用的API Key:', apiKey)
        const voiceRef = fishAudioMap && fishAudioMap[qq] ? fishAudioMap[qq] : ''
        logger.info('[Fish调试] 选用的voiceRef:', voiceRef)

        if (!apiKey) {
            await e.reply('你尚未配置Fish API Key，请使用指令：#fish添加key [你的Key]')
            return
        }

        const selectedVoice = getVoice(voiceRef)
        logger.info('[Fish调试] 选用的音色:', selectedVoice)
        try {
            const audioBuffer = await this.generateAudio(text, selectedVoice.speaker, apiKey)
            if (audioBuffer) {
                const segment = global.segment || { record: (s) => s };
                const audioBase64 = audioBuffer.toString('base64')
                const audioSegment = segment.record(`base64://${audioBase64}`)
                await e.reply(audioSegment)
            } else {
                await e.reply('音频生成失败，请稍后重试')
            }
        } catch (error) {
            console.error('语音朗读失败:', error)
            await e.reply('语音朗读失败，请检查API Key或网络')
        }
    }
    // 生成音频
    async generateAudio(text, voiceId, apiKey) {
        const payloadText = String(text)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000)

        try {
            logger?.info && logger.info("[SF-FISH]正在生成音频")
            const response = await fetch('https://fish.dwe.me/v1/tts', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'model': 's1'
                },
                body: JSON.stringify({
                    text: payloadText,
                    reference_id: voiceId,
                    format: 'mp3',
                    latency: 'normal'
                }),
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(`无法从服务器获取音频数据：${response.statusText}`)
            }

            return Buffer.from(await response.arrayBuffer())
        } catch (error) {
            console.error('生成音频失败:', error)
            return null
        }
    }

    // 查看配置
    async viewConfig(e) {
        const qq = (e && e.sender && e.sender.user_id) ? String(e.sender.user_id) : (e.user_id ? String(e.user_id) : null)
        if (!qq) return await e.reply('无法识别调用者 QQ')

        const fishKeyMap = readJsonSafe(path.join(__dirname, 'fish_key.json'))
        const fishAudioMap = readJsonSafe(path.join(__dirname, 'fish_audio.json'))

        const apiKey = fishKeyMap && fishKeyMap[qq] ? fishKeyMap[qq] : null
        const voiceRef = fishAudioMap && fishAudioMap[qq] ? fishAudioMap[qq] : ''

        const currentVoice = getVoice(voiceRef)
        let modelType = '未知'
        try {
            if (currentVoice && currentVoice.speaker) {
                const res = await fetch(`https://fish.dwe.me/model?_id=${currentVoice.speaker}`)
                const data = await res.json()
                if (data.items && data.items[0] && data.items[0].model) {
                    modelType = data.items[0].model
                }
            }
        } catch (err) {
            // 忽略网络错误
        }

        const lines = []
        lines.push(`你的 QQ: ${qq}`)
        lines.push(`Fish API Key: ${apiKey ? '已配置' : '未配置'}`)
        lines.push(`当前音色ID: ${currentVoice.speaker || '未配置'}`)
        lines.push(`音色模型类型: ${modelType}`)
        // MODIFIED: 更新配置指令的帮助说明
        lines.push(`\n配置指令: #fish添加key [你的key] | #fish添加音色 [音色ID]`)

        await e.reply(['当前 Fish 配置：', ...lines].join('\n'))
    }
}

function getVoice(value) {
    if (!value) {
        return { name: '', speaker: '' }
    }
    return { name: value, speaker: value }
}

function readJsonSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            logger.warn(`[readJsonSafe] 文件未找到，将创建新文件: ${filePath}`)
            return {}
        }
        const raw = fs.readFileSync(filePath, 'utf8')
        if (!raw.trim()) {
            return {}
        }
        return JSON.parse(raw)
    } catch (err) {
        logger.error(`[readJsonSafe] 解析 JSON 失败: ${filePath}`, err)
        return {}
    }
}

// --- 新增工具函数：安全写入JSON文件 ---
/**
 * 安全地将JS对象写入JSON文件
 * @param {string} filePath 文件绝对路径
 * @param {object} data 要写入的JS对象
 * @returns {boolean} 是否写入成功
 */
function writeJsonSafe(filePath, data) {
    try {
        // 使用 2 个空格缩进，美化JSON文件格式，方便人工查看
        const jsonString = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonString, 'utf8');
        return true;
    } catch (err) {
        logger.error(`[writeJsonSafe] 写入 JSON 文件失败: ${filePath}`, err);
        return false;
    }
}

// 兼容全局对象
const segment = global.segment || (global.segment = { record: (s) => s })
const logger = global.logger || console


export async function FishGenerateAudio(e, txt) {
    const match = e.msg
    if (!match || !match[1]) {
        await e.reply('格式错误')
        return
    }
    const text = match[1].trim()
    if (!txt) {
        await e.reply('朗读内容不能为空')
        return
    }
    const qq = (e && e.sender && e.sender.user_id) ? String(e.sender.user_id) : (e.user_id ? String(e.user_id) : null)
    logger.info('[Fish调试] 当前QQ号:', qq)
    if (!qq) {
        await e.reply('无法识别调用者 QQ，请联系管理员')
        return
    }

    const fishKeyMap = readJsonSafe(path.join(__dirname, 'fish_key.json'))
    const fishAudioMap = readJsonSafe(path.join(__dirname, 'fish_audio.json'))
    logger.info('[Fish调试] fishKeyMap:', fishKeyMap)
    logger.info('[Fish调试] fishAudioMap:', fishAudioMap)

    const apiKey = fishKeyMap && fishKeyMap[qq] ? fishKeyMap[qq] : null
    logger.info('[Fish调试] 选用的API Key:', apiKey)
    const voiceRef = fishAudioMap && fishAudioMap[qq] ? fishAudioMap[qq] : ''
    logger.info('[Fish调试] 选用的voiceRef:', voiceRef)

    if (!apiKey) {
        await e.reply('你尚未配置Fish API Key，请使用指令：#fish添加key [你的Key]')
        return
    }

    const selectedVoice = getVoice(voiceRef)
    logger.info('[Fish调试] 选用的音色:', selectedVoice)
    try {
        // 这里改为直接调用 generateAudio
        const audioBuffer = await generateAudio(txt, selectedVoice.speaker, apiKey)
        if (audioBuffer) {
            const segment = global.segment || { record: (s) => s };
            const audioBase64 = audioBuffer.toString('base64')
            const audioSegment = segment.record(`base64://${audioBase64}`)
            await e.reply(audioSegment)
        } else {
            await e.reply('音频生成失败，请稍后重试')
        }
    } catch (error) {
        console.error('语音朗读失败:', error)
        await e.reply('语音朗读失败，请检查API Key或网络')
    }
}

// 独立的音频生成函数
async function generateAudio(text, voiceId, apiKey) {
    const payloadText = String(text)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20000)

    try {
        logger?.info && logger.info("[SF-FISH]正在生成音频")
        const response = await fetch('https://fish.dwe.me/v1/tts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'model': 's1'
            },
            body: JSON.stringify({
                text: payloadText,
                reference_id: voiceId,
                format: 'mp3',
                latency: 'normal'
            }),
            signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
            throw new Error(`无法从服务器获取音频数据：${response.statusText}`)
        }

        return Buffer.from(await response.arrayBuffer())
    } catch (error) {
        console.error('生成音频失败:', error)
        return null
    }
}