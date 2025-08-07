import { Config } from '../utils/config.js'
import { getChatHistoryGroup } from '../utils/chat.js'
import { convertFaces } from '../utils/face.js'
import { customSplitRegex, filterResponseChunk } from '../utils/text.js'
import core, { roleMap } from '../model/core.js'
import { formatDate } from '../utils/common.js'
import { segment } from 'oicq'; // 已添加
import path from 'path'; // 已添加
import { fileURLToPath } from 'url'; // 已添加
import fs from 'fs/promises'; // 新增：引入fs模块
import fetch from 'node-fetch'; // 新增：引入node-fetch

// 用于 ES 模块中的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add this outside the class, or as a static member
const processedMessageIds = new Set();

export class bym extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin 伪人bym',
      dsc: 'bym',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^[^#][sS]*',
          fnc: 'bym',
          priority: '-100000000',
          log: false,
          event: 'message.group' // 新增：只在群聊消息中生效
        }
      ]
    })
  }

  /** 复读 */
  async bym (e) {
    if (processedMessageIds.has(e.message_id)) {
      logger.info(`[BYM] 消息 ${e.message_id} 已处理，跳过。`);
      return false;
    }
    processedMessageIds.add(e.message_id);

    if (!Config.enableBYM) {
      return false
    }

    // 伪人禁用群
    if (Config.bymDisableGroup?.includes(e.group_id?.toString())) {
      return false
    }

    let sender = e.sender.user_id
    let card = e.sender.card || e.sender.nickname
    let group = e.group_id
    let prop = Math.floor(Math.random() * 100)
    if (Config.assistantLabel && e.msg?.includes(Config.assistantLabel)) {
      prop = -1
    }
    // 去掉吧 频率有点逆天
    // if (e.msg?.endsWith('？')) {
    //   prop = prop / 10
    // }

    let fuck = false
    let candidate = Config.bymPreset
    if (Config.bymFuckList?.find(i => e.msg?.includes(i))) {
      fuck = true
      candidate = candidate + Config.bymFuckPrompt
    }

    //概率符合要求，则进行伪人回复，同时，当消息里面带有"小绘"的时候也进行回复
    if (prop < Config.bymRate || e.msg?.includes('小绘')) {
      logger.info('[BYM] 随机聊天命中1');
      if (e.msg?.includes('小绘')) {
        logger.info('[BYM] 检测到北教');
      }
      // let chats = await getChatHistoryGroup(e, Config.groupContextLength) // 获取群聊历史记录
      let system = `你的名字是"${Config.assistantLabel}"，你在一个qq群里，群号是${group},当前说话的人群名片是${card}, qq号是${sender}, 
      请你结合用户的发言和聊天记录随意说话，要求表现得随性一点，最好参与讨论，混入其中（因为他不一定是跟你说的)。不要过分插科打诨，不知道说什么可以复读群友的话。
      要求你做搜索、发图、发视频和音乐等操作时要使用工具。不可以直接发[图片]这样蒙混过关。要求优先使用中文进行对话。如果此时不需要自己说话，可以只回复<EMPTY>` +
        candidate +
        `\n你的回复应该尽可能简练，像人类一样随意，不要附加任何奇怪的东西，如聊天记录的格式（比如${Config.assistantLabel}：），禁止重复聊天记录。
        如果仅叫了你“小绘"但是并没有@你的话，需要定时和语音的时候，你不输出[[定时 YY/MM/DD HH:MM:SS xxxxxx yyyyyy]]或者[[语音]]的格式，并告知用户你并没有被@不能使用定时或语音功能。`

      let rsp = await core.sendMessage(e.msg, {}, Config.bymMode, e, {
        enableSmart: Config.smartMode,
        system: {
          api: system,
          qwen: system,
          bing: system,
          claude: system,
          claude2: system,
          gemini: system,
          xh: system
        },
        settings: {
          replyPureTextCallback: msg => {
            msg = filterResponseChunk(msg)
            msg && e.reply(msg)
          },
          // 强制打开上下文，不然伪人笨死了
          enableGroupContext: true
        }
      })
      // let rsp = await client.sendMessage(e.msg, opt) // 使用客户端发送消息
      let text = rsp.text
      let texts = customSplitRegex(text, /(?<!\?)[。？\n](?!\?)/, 3)
      // let texts = text.split(/(?<!\?)[。？\n](?!\?)/, 3) // 按句号、问号、换行符分割文本，最多3段
      for (let originalSegmentT of texts) {
        if (!originalSegmentT) {
          continue
        }
        originalSegmentT = originalSegmentT.trim()
        
        const imagesToSend = [];
        const emojiRegex = /{{(.*?)}}/g;
        let match;

        // 遍历副本以供 regex.exec 使用，因为它会推进其 lastIndex
        let tempTextForFindingEmojis = originalSegmentT;
        while ((match = emojiRegex.exec(tempTextForFindingEmojis)) !== null) {
          const emojiName = match[1];
          // 构建到表情图片的绝对路径
          let imagePath = path.join(__dirname, 'emojis', `${emojiName}.png`);
          // 对于文件 URL，确保使用正斜杠，尤其是在 Windows 上
          const fileUrlImagePath = `file://${imagePath.replace(/\\/g, '/')}`;
          
          try {
            // 可选：在创建段之前使用 fs.existsSync(imagePath) 检查文件是否存在
            imagesToSend.push(segment.image(fileUrlImagePath));
          } catch (imgError) {
            logger.error(`[BYM] 为 ${emojiName} 创建图片段时出错，路径为 ${fileUrlImagePath}: ${imgError}`);
          }
        }
        
        // 从原始段中删除所有表情标签以获取最终的文本部分
        let finalTextPart = originalSegmentT.replace(emojiRegex, '').trim();

        // 根据原始段在完整响应中的上下文调整末尾的"?"
        const originalSegmentIndexInFullText = text.indexOf(originalSegmentT);
        let shouldEndWithQuestionMark = false;
        if (originalSegmentIndexInFullText !== -1 &&
            (originalSegmentIndexInFullText + originalSegmentT.length) < text.length &&
            text[originalSegmentIndexInFullText + originalSegmentT.length] === '？') {
            shouldEndWithQuestionMark = true;
        }

        if (shouldEndWithQuestionMark) {
            if (finalTextPart && !finalTextPart.endsWith('？')) {
                finalTextPart += '？';
            } else if (!finalTextPart) { // 如果文本现在为空但应以"?"结尾
                finalTextPart = '？';
            }
            // 如果 finalTextPart 已经以"?"结尾，则不执行任何操作。
        }

        // 先发送文本部分
        if (finalTextPart) { // 仅当有文本时才处理和添加文本
            let textMsgArray = await convertFaces(finalTextPart, true, e);
            textMsgArray = textMsgArray.map(filterResponseChunk).filter(i => !!i);
            if (textMsgArray.length > 0) {
              let shouldQuoteRandomly = (Math.floor(Math.random() * 100) < 10);
              await this.reply(textMsgArray, shouldQuoteRandomly, {
                recallMsg: fuck ? 10 : 0
              });

              await new Promise((resolve) => {
                setTimeout(() => {
                  resolve();
                }, Math.min(finalTextPart.length * 200, 3000));
              });
            }
        }

        // 然后发送图片表情包，每张图片单独发送
        if (imagesToSend.length > 0) {
          const sendImage = Math.random() < 1; // 50% 概率发送图片
          if (sendImage) {
            //延迟3秒钟
            await new Promise((resolve) => {
              setTimeout(() => {
                resolve();
              }, 3000);
            });
            for (const imageSegment of imagesToSend) {
              await this.reply(imageSegment, false, { // 图片消息通常不需要引用
                recallMsg: fuck ? 10 : 0
              });
              await new Promise((resolve) => {
                setTimeout(() => {
                  resolve();
                }, 500); // 图片间的小延迟
              });
            }
          }
        }
      }
    }
    return false
  }
}
