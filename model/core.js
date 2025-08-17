import { Config, defaultOpenAIAPI } from '../utils/config.js'
import {
  // extractContentFromFile,
  formatDate,
  getImg,
  getMasterQQ, getMaxModelTokens,
  getUin,
  getUserData,
  // isCN
} from '../utils/common.js'
// import { KeyvFile } from 'keyv-file'
// import SydneyAIClient from '../utils/SydneyAIClient.js'
import { getChatHistoryGroup } from '../utils/chat.js'
import { APTool } from '../utils/tools/APTool.js'
// import { OfficialChatGPTClient } from '../utils/message.js'
// import { ClaudeAPIClient } from '../client/ClaudeAPIClient.js'
// import { ClaudeAIClient } from '../utils/claude.ai/index.js'
// import XinghuoClient from '../utils/xinghuo/xinghuo.js'
// import { getMessageById, upsertMessage } from '../utils/history.js'
// import { v4 as uuid } from 'uuid'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from '../client/CustomGoogleGeminiClient.js'
import { QueryStarRailTool } from '../utils/tools/QueryStarRailTool.js'
import { WebsiteTool } from '../utils/tools/WebsiteTool.js'
import { SendPictureTool } from '../utils/tools/SendPictureTool.js'
import { SendVideoTool } from '../utils/tools/SendBilibiliTool.js'
import { SearchVideoTool } from '../utils/tools/SearchBilibiliTool.js'
import { SendAvatarTool } from '../utils/tools/SendAvatarTool.js'
import { SerpImageTool } from '../utils/tools/SearchImageTool.js'
import { SearchMusicTool } from '../utils/tools/SearchMusicTool.js'
import { SendMusicTool } from '../utils/tools/SendMusicTool.js'
// import { SendAudioMessageTool } from '../utils/tools/SendAudioMessageTool.js'
import { SendMessageToSpecificGroupOrUserTool } from '../utils/tools/SendMessageToSpecificGroupOrUserTool.js'
import { QueryGenshinTool } from '../utils/tools/QueryGenshinTool.js'
import { WeatherTool } from '../utils/tools/WeatherTool.js'
import { QueryUserinfoTool } from '../utils/tools/QueryUserinfoTool.js'
import { EditCardTool } from '../utils/tools/EditCardTool.js'
import { JinyanTool } from '../utils/tools/JinyanTool.js'
import { KickOutTool } from '../utils/tools/KickOutTool.js'
import { SetTitleTool } from '../utils/tools/SetTitleTool.js'
import { SerpIkechan8370Tool } from '../utils/tools/SerpIkechan8370Tool.js'
import { SerpTool } from '../utils/tools/SerpTool.js'
// import common from '../../../lib/common/common.js'
import { SendDiceTool } from '../utils/tools/SendDiceTool.js'
// import { EliMovieTool } from '../utils/tools/EliMovieTool.js'
// import { EliMusicTool } from '../utils/tools/EliMusicTool.js'
import { HandleMessageMsgTool } from '../utils/tools/HandleMessageMsgTool.js'
import { ProcessPictureTool } from '../utils/tools/ProcessPictureTool.js'
// import { ImageCaptionTool } from '../utils/tools/ImageCaptionTool.js'
// import { ChatGPTAPI } from '../utils/openai/chatgpt-api.js'
import { newFetch } from '../utils/proxy.js'
// import { ChatGLM4Client } from '../client/ChatGLM4Client.js'
// import { QwenApi } from '../utils/alibaba/qwen-api.js'
// import { BingAIClient } from '../client/CopilotAIClient.js'
// import Keyv from 'keyv'
// import crypto from 'crypto'
import {GithubAPITool} from '../utils/tools/GithubTool.js'

export const roleMap = {
  owner: 'group owner',
  admin: 'group administrator'
}

const defaultPropmtPrefix = ', a large language model trained by OpenAI. You answer as concisely as possible for each response (e.g. don’t be verbose). It is very important that you answer as concisely as possible, so please remember this. If you are generating a list, do not have too many items. Keep the number of items short.'

async function handleSystem (e, system, settings) {
  if (settings.enableGroupContext) {
    try {
      let opt = {}
      opt.groupId = e.group_id
      opt.qq = e.sender.user_id
      opt.nickname = e.sender.card
      opt.groupName = e.group.name || e.group_name
      opt.botName = e.isGroup ? (e.group.pickMember(getUin(e)).card || e.group.pickMember(getUin(e)).nickname) : e.bot.nickname
      let master = (await getMasterQQ())[0]
      if (master && e.group) {
        opt.masterName = e.group.pickMember(parseInt(master)).card || e.group.pickMember(parseInt(master)).nickname
      }
      if (master && !e.group) {
        opt.masterName = e.bot.getFriendList().get(parseInt(master))?.nickname
      }
      let chats = await getChatHistoryGroup(e, Config.groupContextLength)
      opt.chats = chats
      const namePlaceholder = '[name]'
      const defaultBotName = 'ChatGPT'
      const groupContextTip = Config.groupContextTip
      system = system.replaceAll(namePlaceholder, opt.botName || defaultBotName) +
        ((opt.groupId) ? groupContextTip : '')
      system += 'Attention, you are currently chatting in a qq group, then one who asks you now is' + `${opt.nickname}(${opt.qq})。`
      system += `the group name is ${opt.groupName}, group id is ${opt.groupId}。`
      if (opt.botName) {
        system += `Your nickname is ${opt.botName} in the group,`
      }
      if (chats) {
        system += 'There is the conversation history in the group, you must chat according to the conversation history context"'
        system += chats
          .map(chat => {
            let sender = chat.sender || {}
            // if (sender.user_id === e.bot.uin && chat.raw_message.startsWith('建议的回复')) {
            if (chat.raw_message.startsWith('建议的回复')) {
              // 建议的回复太容易污染设定导致对话太固定跑偏了
              return ''
            }
            return `【${sender.card || sender.nickname}】(qq：${sender.user_id}, ${roleMap[sender.role] || 'normal user'}，${sender.area ? 'from ' + sender.area + ', ' : ''} ${sender.age} years old, 群头衔：${sender.title}, gender: ${sender.sex}, time：${formatDate(new Date(chat.time * 1000))}, messageId: ${chat.message_id}) 说：${chat.raw_message}`
          })
          .join('\n')
      }
    } catch (err) {
      if (e.isGroup) {
        logger.warn('获取群聊聊天记录失败，本次对话不携带聊天记录', err)
      }
    }
  }
  return system
}

class Core {
  async sendMessage (prompt, conversation = {}, use, e, signal = null, opt = { // <<< 1. 在这里添加 signal 参数
    enableSmart: Config.smartMode,
    system: {
      api: Config.promptPrefixOverride,
      qwen: Config.promptPrefixOverride,
      bing: Config.sydney,
      claude: Config.claudeSystemPrompt,
      claude2: Config.claudeSystemPrompt,
      gemini: Config.geminiPrompt,
      xh: Config.xhPrompt
    },
    settings: {
      replyPureTextCallback: undefined,
      enableGroupContext: Config.enableGroupContext,
      forceTool: false
    }
  }) {
    if (!conversation) {
      conversation = {
        timeoutMs: Config.defaultTimeoutMs
      }
    }
    if (Config.debug) {
      logger.mark(`using ${use} mode`)
    }
    const userData = await getUserData(e.user_id)
    const useCast = userData.cast || {}
      let client = new CustomGoogleGeminiClient({
        e,
        userId: e.sender.user_id,
        key: Config.getGeminiKey(),
        model: Config.geminiModel,
        baseUrl: Config.geminiBaseUrl,
        debug: Config.debug,
        fetch: (url, options) => newFetch(url, { ...options, signal }) // <<< 2. 将 signal 注入到客户端的 fetch 中
      })
      let option = {
        stream: false,
        onProgress: (data) => {
          if (Config.debug) {
            logger.info(data)
          }
        },
        parentMessageId: conversation.parentMessageId,
        conversationId: conversation.conversationId,
        search: Config.geminiEnableGoogleSearch,
        codeExecution: Config.geminiEnableCodeExecution,
        signal: signal // <<< 3. 将 signal 也直接传递给 option
      }
      const image = await getImg(e)
      let imageUrl = image ? image[0] : undefined
      if (imageUrl) {
        const response = await fetch(imageUrl, { signal }) // <<< 4. 给 fetch 添加 signal
        const base64Image = Buffer.from(await response.arrayBuffer())
        option.image = base64Image.toString('base64')
      }

      // 新增：处理语音文件URL
      if (conversation.audioUrl) {
        try {
          logger.info(`[Gemini] 正在从URL获取语音文件: ${conversation.audioUrl}`);
          const response = await fetch(conversation.audioUrl, { signal }); // <<< 5. 给 fetch 添加 signal
          if (!response.ok) {
            throw new Error(`获取语音文件失败: ${response.statusText}`);
          }
          const audioBuffer = await response.arrayBuffer();
          const base64Audio = Buffer.from(audioBuffer).toString('base64');
          // 将语音数据和MIME类型传递给Gemini客户端
          option.audio = {
            mimeType: response.headers.get('content-type') || 'audio/amr', // 默认为amr格式
            data: base64Audio
          };
          logger.info(`[Gemini] 已成功处理语音文件，准备发送至API。`);
        } catch (err) {
           if (err.name !== 'AbortError') {
             logger.error(`[Gemini] 处理语音URL时出错: ${err}`);
           }
        }
      }

      // 新增：处理引用图片URL
      if (conversation.imageUrl) {
        try {
          logger.info(`[Gemini] 正在从URL获取引用图片: ${conversation.imageUrl}`);
          const response = await fetch(conversation.imageUrl, { signal }); // <<< 6. 给 fetch 添加 signal
          if (!response.ok) {
            throw new Error(`获取引用图片失败: ${response.statusText}`);
          }
          const imageBuffer = await response.arrayBuffer();
          const base64Image = Buffer.from(imageBuffer).toString('base64');
          // 将引用图片数据传递给Gemini客户端
          option.image = base64Image;
          logger.info(`[Gemini] 已成功处理引用图片，准备发送至API。`);
        } catch (err) {
          if (err.name !== 'AbortError') {
            logger.error(`[Gemini] 处理引用图片URL时出错: ${err}`);
          }
        }
      }

      if (opt.enableSmart) {
        const {
          funcMap
        } = await collectTools(e)
        let tools = Object.keys(funcMap).map(k => funcMap[k].tool)
        client.addTools(tools)
      }
      let system = opt.system.gemini
      if (opt.settings.enableGroupContext && e.isGroup) {
        let chats = await getChatHistoryGroup(e, Config.groupContextLength)
        const namePlaceholder = '[name]'
        const defaultBotName = 'GeminiPro'
        const groupContextTip = Config.groupContextTip
        let botName = e.isGroup ? (e.group.pickMember(getUin(e)).card || e.group.pickMember(getUin(e)).nickname) : e.bot.nickname
        system = system.replaceAll(namePlaceholder, botName || defaultBotName) +
          ((opt.settings.enableGroupContext && e.group_id) ? groupContextTip : '')
        system += 'Attention, you are currently chatting in a qq group, then one who asks you now is' + `${e.sender.card || e.sender.nickname}(${e.sender.user_id}).`
        system += `the group name is ${e.group.name || e.group_name}, group id is ${e.group_id}.`
        system += `Your nickname is ${botName} in the group,`
        if (chats) {
          system += 'There is the conversation history in the group, you must chat according to the conversation history context"'
          system += chats
            .map(chat => {
              let sender = chat.sender || {}
              return `【${sender.card || sender.nickname}】(qq：${sender.user_id}, ${roleMap[sender.role] || 'normal user'}，${sender.area ? 'from ' + sender.area + ', ' : ''} ${sender.age} years old, 群头衔：${sender.title}, gender: ${sender.sex}, time：${formatDate(new Date(chat.time * 1000))}, messageId: ${chat.message_id}) 说：${chat.raw_message}`
            })
            .join('\n')
        }
      }
      if (Config.enableChatSuno) {
        system += 'If I ask you to generate music or write songs, you need to reply with information suitable for Suno to generate music. Please use keywords such as Verse, Chorus, Bridge, Outro, and End to segment the lyrics, such as [Verse 1], The returned message is in JSON format, with a structure of ```json{"option": "Suno", "tags": "style", "title": "title of the song", "lyrics": "lyrics"}```.'
      }
      option.system = system
      option.replyPureTextCallback = opt.settings.replyPureTextCallback || (async (msg) => {
        if (msg) {
          await e.reply(msg, true)
        }
      })
      option.toolMode = (opt.settings.forceTool || Config.geminiForceToolKeywords?.find(k => prompt?.includes(k))) ? 'ANY' : 'AUTO'
      return await client.sendMessage(prompt, option)
  }
}

/**
 * 收集tools
 * @param e
 * @return {Promise<{systemAddition, funcMap: {}, promptAddition: string, fullFuncMap: {}}>}
 */
async function collectTools (e) {
  let serpTool
  switch (Config.serpSource) {
    case 'ikechan8370': {
      serpTool = new SerpIkechan8370Tool()
      break
    }
    case 'azure': {
      if (!Config.azSerpKey) {
        logger.warn('未配置bing搜索密钥，转为使用ikechan8370搜索源')
        serpTool = new SerpIkechan8370Tool()
      } else {
        serpTool = new SerpTool()
      }
      break
    }
    default: {
      serpTool = new SerpIkechan8370Tool()
    }
  }
  let fullTools = [
    new EditCardTool(),
    // new QueryStarRailTool(),
    new WebsiteTool(),
    new JinyanTool(),
    new KickOutTool(),
    new WeatherTool(),
    new SendPictureTool(),
    new SendVideoTool(),
    // new ImageCaptionTool(),
    new SearchVideoTool(),
    new SendAvatarTool(),
    new SerpImageTool(),
    new SearchMusicTool(),
    new SendMusicTool(),
    new SerpIkechan8370Tool(),
    new SerpTool(),
    // new SendAudioMessageTool(),
    // new ProcessPictureTool(),
    new APTool(),
    new HandleMessageMsgTool(),
    new QueryUserinfoTool(),
    // new EliMusicTool(),
    // new EliMovieTool(),
    new SendMessageToSpecificGroupOrUserTool(),
    new SendDiceTool(),
    new QueryGenshinTool(),
    new SetTitleTool(),
    new GithubAPITool()
  ]
  // todo 3.0再重构tool的插拔和管理
  let /** @type{AbstractTool[]} **/ tools = [
    new SendAvatarTool(),
    new SendDiceTool(),
    new SendMessageToSpecificGroupOrUserTool(),
    // new EditCardTool(),
    new QueryStarRailTool(),
    new QueryGenshinTool(),
    new SendMusicTool(),
    new SearchMusicTool(),
    new ProcessPictureTool(),
    new WebsiteTool(),
    // new JinyanTool(),
    // new KickOutTool(),
    new WeatherTool(),
    new SendPictureTool(),
    // new SendAudioMessageTool(),
    new APTool(),
    // new HandleMessageMsgTool(),
    serpTool,
    new QueryUserinfoTool(),
    new GithubAPITool()
  ]
  let systemAddition = ''
  if (e.isGroup) {
    let botInfo = await e.bot?.pickMember?.(e.group_id, getUin(e)) || await e.bot?.getGroupMemberInfo?.(e.group_id, getUin(e))
    if (botInfo.role !== 'member') {
      // 管理员才给这些工具
      tools.push(...[new EditCardTool(), new JinyanTool(), new KickOutTool(), new HandleMessageMsgTool(), new SetTitleTool()])
      // 用于撤回和加精的id
      if (e.source?.seq) {
        let source = (await e.group.getChatHistory(e.source?.seq, 1)).pop()
        systemAddition += `\nthe last message is replying to ${source.message_id}"\n`
      } else {
        systemAddition += `\nthe last message id is ${e.message_id}. `
      }
    }
  }
  let promptAddition = ''
  let img = await getImg(e)
  if (img?.length > 0 && Config.extraUrl) {
    // tools.push(new ImageCaptionTool())
    // tools.push(new ProcessPictureTool())
    promptAddition += `\nthe url of the picture(s) above: ${img.join(', ')}`
  } else {
    tools.push(new SerpImageTool())
    tools.push(...[new SearchVideoTool(),
      new SendVideoTool()])
  }
  let funcMap = {}
  let fullFuncMap = {}
  tools.forEach(tool => {
    funcMap[tool.name] = {
      exec: tool.func,
      function: tool.function(),
      tool
    }
  })
  fullTools.forEach(tool => {
    fullFuncMap[tool.name] = {
      exec: tool.func,
      function: tool.function(),
      tool
    }
  })
  return {
    funcMap,
    fullFuncMap,
    systemAddition,
    promptAddition
  }
}

export default new Core()