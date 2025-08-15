// ==================== 依赖导入区域 ====================
import plugin from '../../../lib/plugins/plugin.js' // Yunzai 插件基类
import common from '../../../lib/common/common.js' // Yunzai 通用工具函数
import _ from 'lodash' // lodash 工具库，提供实用函数
import { Config } from '../utils/config.js' // 插件配置管理
import {
  // completeJSON,        // JSON 补全工具
  // formatDate,          // 日期格式化
  // formatDate2,         // 日期格式化（第二种格式）
  // generateAudio,       // 音频生成
  getDefaultReplySetting,  // 获取默认回复设置
  getImageOcrText,     // 图片 OCR 文字识别
  getImg,              // 获取消息中的图片
  getUin,              // 获取机器人 QQ 号
  getUserData,         // 获取用户数据
  getUserReplySetting, // 获取用户回复设置
  isImage,             // 判断链接是否为图片
  makeForwardMsg,      // 创建合并转发消息
  randomString,        // 生成随机字符串
  render,              // 模板渲染
  renderUrl            // URL 渲染为图片
} from '../utils/common.js'
import fetch from 'node-fetch' // HTTP 请求库
import { deleteConversation, getConversations, getLatestMessageIdByConversationId } from '../utils/conversation.js' // 对话管理相关函数
import { ConversationManager, originalValues } from '../model/conversation.js' // 对话管理器类
import { getProxy } from '../utils/proxy.js' // 代理设置获取
import { generateSuggestedResponse } from '../utils/chat.js' // 生成建议回复
import Core from '../model/core.js' // AI 核心处理模块
import { collectProcessors } from '../utils/postprocessors/BasicProcessor.js' // 后处理器收集
import { segment } from 'oicq'; // OICQ 消息段构造器
import path from 'path'; // Node.js 路径处理
import { fileURLToPath } from 'url'; // URL 转文件路径工具
import fs from 'fs'; // Node.js 文件系统模块
import { customSplitRegex, filterResponseChunk } from '../utils/text.js'; // 文本分段和过滤工具
import { convertFaces } from '../utils/face.js'; // 表情转换处理工具
import moment from 'moment'; // 时间日期处理库

// ==================== 全局变量定义区域 ====================
const __filename = fileURLToPath(import.meta.url); // 当前文件的绝对路径
const __dirname = path.dirname(__filename); // 当前文件所在目录的绝对路径
const chatMessageBuffers = new Map();//消息缓冲区 - 存储每个用户/群的消息缓冲和定时器
const interruptionFlags = new Map();//中断标志映射 - 用于标记对话是否被中断
const pendingRequests = new Map();//挂起请求映射 - 用于跟踪正在处理的请求
const userContinuationStates = new Map();//用户续接对话状态 - 跟踪最近与AI交互的用户，允许续接对话
const processingPrompts = new Map(); // 新增：存储正在调用API的prompt
const pendingConfirmations = new Map(); // 用于销毁对话前的确认

// ==================== API调用日志管理 ====================
function getApiLogFileName() {
  const today = moment().format('YYYY-MM-DD');
  return path.join(__dirname, 'api_log', `API_log_${today}.json`);
}

// 确保api_log目录存在
const apiLogDir = path.join(__dirname, 'api_log');
if (!fs.existsSync(apiLogDir)) {
  fs.mkdirSync(apiLogDir);
}

/**
 * 加载API调用日志
 * @returns {object} API调用日志对象
 */
function loadApiLog() {
  const file = getApiLogFileName();
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      if (data.trim()) {
        return JSON.parse(data);
      }
    }
  } catch (error) {
    logger.error(`[API日志] 加载API日志文件失败: ${error}`);
  }
  return {};
}

function saveApiLog(logData) {
  const file = getApiLogFileName();
  try {
    fs.writeFileSync(file, JSON.stringify(logData, null, 2), 'utf8');
  } catch (error) {
    logger.error(`[API日志] 保存API日志文件失败: ${error}`);
  }
}

function recordApiCall(userId) {
  try {
    const apiLog = loadApiLog();
    const userIdStr = userId.toString();
    if (!apiLog[userIdStr]) {
      apiLog[userIdStr] = 0;
    }
    apiLog[userIdStr]++;
    saveApiLog(apiLog);
    logger.info(`[API日志] 用户 ${userIdStr} API调用次数: ${apiLog[userIdStr]}`);
  } catch (error) {
    logger.error(`[API日志] 记录API调用失败: ${error}`);
  }
}
// ==================== 全局配置变量 ====================
let version = Config.version // 插件版本号
let proxy = getProxy()       // 代理配置
// ==================== 关键词触发配置 ====================
// 当消息包含这些关键词时，会像被@一样触发AI回复
// 您可以根据需要修改、添加或删除关键词
const TRIGGER_KEYWORDS = [
  '小绘小绘',        // 基础触发词
  '星小绘bot'
];

// ==================== 续接对话配置 ====================
// 用户在触发关键词或被@后，可以续接对话的时间窗口（毫秒）
const CONTINUATION_TIMEOUT = 5 * 60 * 1000; // 5分钟

/**
 * 设置用户续接对话状态
 * @param {string} conversationKey - 对话键
 * @param {number} userId - 用户ID
 */
const setUserContinuationState = (conversationKey, userId) => {
  const now = Date.now();
  if (!userContinuationStates.has(conversationKey)) {
    userContinuationStates.set(conversationKey, new Map());
  }
  userContinuationStates.get(conversationKey).set(userId, now);
  
  // 清理过期的状态
  setTimeout(() => {
    if (userContinuationStates.has(conversationKey)) {
      const states = userContinuationStates.get(conversationKey);
      if (states.has(userId) && states.get(userId) === now) {
        states.delete(userId);
        if (states.size === 0) {
          userContinuationStates.delete(conversationKey);
        }
      }
    }
  }, CONTINUATION_TIMEOUT);
};

/**
 * 检查用户是否可以续接对话
 * @param {string} conversationKey - 对话键
 * @param {number} userId - 用户ID
 * @returns {boolean} - 是否可以续接对话
 */
const canUserContinue = (conversationKey, userId) => {
  if (!userContinuationStates.has(conversationKey)) {
    return false;
  }
  const states = userContinuationStates.get(conversationKey);
  if (!states.has(userId)) {
    return false;
  }
  const timestamp = states.get(userId);
  const now = Date.now();
  return (now - timestamp) < CONTINUATION_TIMEOUT;
};

/**
 * 清除用户续接对话状态
 * @param {string} conversationKey - 对话键
 * @param {number} userId - 用户ID
 */
const clearUserContinuationState = (conversationKey, userId) => {
  if (userContinuationStates.has(conversationKey)) {
    const states = userContinuationStates.get(conversationKey);
    if (states.has(userId)) {
      states.delete(userId);
      logger.info(`[ChatGPT] 已清除用户 ${userId} 的续接对话状态`);
      if (states.size === 0) {
        userContinuationStates.delete(conversationKey);
      }
    }
  }
};

/**
 * 带代理的 fetch 函数
 * 根据配置决定是否使用代理进行网络请求
 * 
 * @param {string} url - 请求的 URL
 * @param {object} options - fetch 选项
 * @returns {Promise} fetch 请求的 Promise
 */
const newFetch = (url, options = {}) => {
  // 如果配置了代理，则添加代理配置到默认选项
  const defaultOptions = Config.proxy
    ? {
        agent: proxy(Config.proxy)  // 使用配置的代理
      }
    : {} // 未配置代理则使用空对象
  
  // 合并默认选项和传入的选项
  const mergedOptions = {
    ...defaultOptions,
    ...options
  }

  return fetch(url, mergedOptions)
}


export class chatgpt extends plugin {///////////////////////////////////// * ChatGPT 插件主类 * 继承自 Yunzai 的插件基类
  task = [] // 任务队列，确保 task 属性被初始化为空数组
  
  /**
   * 构造函数 - 初始化插件配置和规则
   * @param {object} e - 事件对象
   */
  constructor (e) {/////////////////////////////////////////////////////////////////初始化插件配置和规则
    // 规则数组插入#备份和#恢复
    let toggleMode = Config.toggleMode // 获取切换模式配置
    super({
      name: 'ChatGpt 对话',
      dsc: '与人工智能对话，畅聊无限可能~',
      event: 'message',
      priority: 1144,/** 优先级，数字越小等级越高 */
  rule: [
        // ==================== 聊天记录备份与恢复 ====================
        {
          reg: '^#备份$',
          fnc: 'backupConversation'
        },
        {
          reg: '^#恢复(\\d+)$',
          fnc: 'restoreConversation'
        },
        // ==================== 时间查询规则 ====================
        {
          reg: '^#当前时间$',           // 正则：查询当前时间
          fnc: 'getCurrentTime'         // 对应的处理函数
        },
        // ==================== 默认聊天规则 ====================
        {
          // 根据切换模式决定是艾特触发还是 #chat 触发，如果是at模式则使用at触发，如果是chat模式则使用chat触发
          reg: toggleMode === 'at' ? '^[^#][sS]*' : '^#(图片)?chat[^gpt][sS]*',
          fnc: 'chatgpt',  // 默认聊天处理函数
          log: false       // 不记录日志
        },
        // ==================== 对话管理规则 ====================
        {
          reg: '^#(chatgpt)?对话列表$',  // 查看对话列表
          fnc: 'getAllConversations',
          permission: 'master'           // 需要主人权限
        },
        {
          // 结束对话的多种表达方式
          reg: `^#?(${originalValues.join('|')})?(结束|新开|摧毁|毁灭|完结)对话([sS]*)$`,
          fnc: 'destroyConversations'
        },
        {
          // 结束全部对话
          reg: `^#?(${originalValues.join('|')})?(结束|新开|摧毁|毁灭|完结)全部对话$`,
          fnc: 'endAllConversations',
          permission: 'master'           // 需要主人权限
        },
        {
          reg: '^#确认$', // 新增：处理确认操作的规则
          fnc: 'confirmAction'
        },
        {
          reg: '^#取消$', // 新增：处理取消操作的规则
          fnc: 'cancelAction'
        },
        // ==================== 回复模式切换规则 ====================
        // {
        //   reg: '#chatgpt帮助',           // 帮助命令（已注释）
        //   fnc: 'help'
        // },
        {
          reg: '^#chatgpt图片模式$',      // 切换到图片回复模式
          fnc: 'switch2Picture'
        },
        {
          reg: '^#chatgpt文本模式$',      // 切换到文本回复模式
          fnc: 'switch2Text'
        },
        // ==================== 管理功能规则 ====================
        {
          reg: '^#保存语音',              // 语音合成并保存
          fnc: 'saveAudioCommand',
          permission: 'master'           // 需要主人权限
        },
        {
          reg: '^#API统计(\\s+\\d{4}-\\d{2}-\\d{2})?$', // 支持带日期参数
          fnc: 'getApiStats',
          permission: 'master'           // 需要主人权限
        }
      ]
    })
    
    // 保存切换模式配置到实例
    this.toggleMode = toggleMode
  }

  /**
   * 获取当前时间的处理函数
   * 响应 #当前时间 命令，返回格式化的当前服务器时间
   * 
   * @param {object} e - 事件对象
   * @returns {boolean} - 是否成功处理
   */
  async getCurrentTime (e) {
    // logger.info(`[getCurrentTime] 函数被调用。消息: ${e.msg}`);
    
    // 使用 moment 格式化当前时间
    const currentTime = moment().format('YYYY年MM月DD日 HH:mm:ss')
    
    // 回复当前时间
    await this.reply(`当前服务器时间是：${currentTime}`, true)
    return true
  }

  /**
   * 语音合成保存命令处理函数
   * 处理 #保存语音 命令，将文本合成为语音并发送
   * 
   * @param {object} e - 事件对象
   * @returns {boolean} - 是否成功处理
   */
  async saveAudioCommand (e) {
    // 提取要合成的文本内容
    let textToSynthesize = e.msg.replace(/^#保存语音\s*/, '').trim()

    // 检查是否有输入内容
    if (!textToSynthesize) {
      await this.reply('请输入您要合成的语音内容，例如：#保存语音 你好', true)
      return false
    }

    try {
      // 动态导入语音合成模块
      const { synthesizeAudio } = await import('./audio.js')

      // 合成语音文件
      const audioFilePath = await synthesizeAudio(textToSynthesize)

      if (audioFilePath) {
        // 发送语音文件
        await this.reply(segment.record(audioFilePath))
      } else {
        await this.reply('语音合成失败，请检查日志。', true)
      }
    } catch (error) {
      logger.error('调用语音合成服务失败：', error)
      await this.reply('语音合成服务调用失败，请检查日志。', true)
    }
    return true
  }

  /**
   * 测试关键词匹配功能
   * 处理 #测试关键词 命令，测试关键词匹配是否正常工作
   * 
   * @param {object} e - 事件对象
   * @returns {boolean} - 是否成功处理
   */


  /**
   * 获取API调用统计
   * 处理 #API统计 命令，显示所有用户的API调用次数
   * 
   * @param {object} e - 事件对象
   * @returns {boolean} - 是否成功处理
   */
  async getApiStats (e) {
    try {
      // 支持查询指定日期，格式 #API统计 2025-08-14
      let date = e.msg.replace(/^#API统计\s*/, '').trim();
      if (!date) date = moment().format('YYYY-MM-DD');
      const file = path.join(__dirname, 'api_log', `API_log_${date}.json`);
      let apiLog = {};
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file, 'utf8');
        if (data.trim()) apiLog = JSON.parse(data);
      }
      if (Object.keys(apiLog).length === 0) {
        await this.reply(`${date} 暂无API调用记录`, true);
        return true;
      }
      const sortedUsers = Object.entries(apiLog)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20);
      let result = `${date} API调用统计 (前20名)\n`;
      result += '━━━━━━━━━━━━━━━━━━━━\n';
      let totalCalls = 0;
      sortedUsers.forEach(([userId, count], index) => {
        result += `${index + 1}. QQ: ${userId} - ${count}次\n`;
        totalCalls += count;
      });
      result += '━━━━━━━━━━━━━━━━━━━━\n';
      result += `总用户数: ${Object.keys(apiLog).length}\n`;
      result += `总调用次数: ${totalCalls}`;
      await this.reply(result, true);
      return true;
    } catch (error) {
      logger.error('[API统计] 获取API统计失败:', error);
      await this.reply('获取API统计失败，请检查日志', true);
      return false;
    }
  }

  /**
   * 获取当前对话列表
   * 显示所有正在进行的对话及其基本信息
   * 
   * @param {object} e - 事件对象
   * @returns {Promise<void>}
   */
  async getConversations (e) {
    // TODO: 根据 use 参数返回不同的对话列表
    let keys = await redis.keys('CHATGPT:CONVERSATIONS:*')
    
    if (!keys || keys.length === 0) {
      await this.reply('当前没有人正在与机器人对话', true)
    } else {
      let response = '当前对话列表：(格式为【开始时间 ｜ qq昵称 ｜ 对话长度 ｜ 最后活跃时间】)\n'
      
      // 并行获取所有对话信息
      await Promise.all(keys.map(async (key) => {
        let conversation = await redis.get(key)
        if (conversation) {
          conversation = JSON.parse(conversation)
          response += `${conversation.ctime} ｜ ${conversation.sender.nickname} ｜ ${conversation.num} ｜ ${conversation.utime} \n`
        }
      }))
      
      await this.reply(`${response}`, true)
    }
  }

  /**
   * 销毁指定用户的对话
   * 清除用户的对话上下文和相关数据
   * 
   * @param {object} e - 事件对象
   * @returns {Promise<void>}
   */
  async destroyConversations (e) {
    const confirmationKey = e.isGroup ? e.group_id : e.sender.user_id;
    pendingConfirmations.set(confirmationKey, { action: 'destroy', e: e });

    setTimeout(() => {
      if (pendingConfirmations.has(confirmationKey) && pendingConfirmations.get(confirmationKey).action === 'destroy') {
        pendingConfirmations.delete(confirmationKey);
      }
    }, 60000); // 60秒后自动取消

    await this.reply('确认结束当前对话吗？回复“#确认”以继续，或“#取消”以取消操作', true);
  }

  /**
   * 结束所有对话
   * 清除所有用户的对话上下文（仅限管理员）
   * 
   * @param {object} e - 事件对象
   * @returns {Promise<void>}
   */
  async endAllConversations (e) {
    const confirmationKey = e.sender.user_id; // 全部对话只能由master发起，用user_id作为key
    pendingConfirmations.set(confirmationKey, { action: 'destroyAll', e: e });

    setTimeout(() => {
      if (pendingConfirmations.has(confirmationKey) && pendingConfirmations.get(confirmationKey).action === 'destroyAll') {
        pendingConfirmations.delete(confirmationKey);
      }
    }, 60000); // 60秒后自动取消

    await this.reply('确认结束全部对话吗？回复“#确认”以继续，或“#取消”以取消操作', true);
  }

  /**
   * 确认执行待定操作
   * @param {object} e - 事件对象
   */
  async confirmAction(e) {
    const confirmationKey = e.isGroup ? e.group_id : e.sender.user_id;
    const pending = pendingConfirmations.get(confirmationKey);

    if (!pending) {
      await this.reply('当前没有需要确认的操作。', true);
      return;
    }

    // 权限验证：确保在群里发起，在群里确认；私聊发起，私聊确认。
    // 对于endAll，必须是同一个人确认。
    if (pending.e.isGroup !== e.isGroup || pending.e.sender.user_id !== e.sender.user_id) {
        if (pending.action !== 'destroyAll' || pending.e.sender.user_id !== e.sender.user_id) {
            await this.reply('无效确认。请在发起指令的聊天中进行确认。', true);
            return;
        }
    }

    let manager = new ConversationManager(pending.e);
    
    if (pending.action === 'destroy') {
      await manager.endConversation.bind(this)(pending.e);
    } else if (pending.action === 'destroyAll') {
      // 再次检查权限
      if (!pending.e.isMaster) {
          await this.reply('无权限执行此操作。', true);
          pendingConfirmations.delete(confirmationKey);
          return;
      }
      await manager.endAllConversations.bind(this)(pending.e);
    }

    pendingConfirmations.delete(confirmationKey); // 清除待确认状态
  }

  /**
   * 取消待定的操作
   * @param {object} e - 事件对象
   */
  async cancelAction(e) {
    const confirmationKey = e.isGroup ? e.group_id : e.sender.user_id;
    const pending = pendingConfirmations.get(confirmationKey);

    if (!pending) {
      await this.reply('当前没有需要取消的操作。', true);
      return;
    }

    // 权限验证
    if (pending.e.sender.user_id !== e.sender.user_id) {
      await this.reply('无效操作。请由发起指令的用户取消。', true);
      return;
    }

    pendingConfirmations.delete(confirmationKey);
    await this.reply('操作已取消。', true);
  }

  /**
   * 删除指定对话
   * 支持通过对话ID或@用户来删除对话（仅限管理员）
   * 
   * @param {object} e - 事件对象
   * @returns {Promise<boolean>} - 是否成功处理
   */
  async deleteConversation (e) {
    let ats = e.message.filter(m => m.type === 'at')  // 获取所有@的用户
    let use = await redis.get('CHATGPT:USE') || 'api'  // 获取当前使用的模式
    
    // 检查是否为支持的模式
    if (use !== 'api3') {
      await this.reply('本功能当前仅支持API3模式', true)
      return false
    }
    
    // 处理未@任何人或只@了机器人的情况
    if (ats.length === 0 || (ats.length === 1 && (e.atme || e.atBot))) {
      // 通过对话ID删除
      let conversationId = _.trimStart(e.msg, '#chatgpt删除对话').trim()
      if (!conversationId) {
        await this.reply('指令格式错误，请同时加上对话id或@某人以删除他当前进行的对话', true)
        return false
      } else {
        // 调用API删除对话
        let deleteResponse = await deleteConversation(conversationId, newFetch)
        logger.mark(deleteResponse)
        
        let deleted = 0
        // 清理本地绑定的对话记录
        let qcs = await redis.keys('CHATGPT:QQ_CONVERSATION:*')
        for (let i = 0; i < qcs.length; i++) {
          if (await redis.get(qcs[i]) === conversationId) {
            await redis.del(qcs[i])
            if (Config.debug) {
              logger.info('delete conversation bind: ' + qcs[i])
            }
            deleted++
          }
        }
        await this.reply(`对话删除成功，同时清理了${deleted}个同一对话中用户的对话。`, true)
      }
    } else {
      // 处理@了用户的情况，删除被@用户的对话
      for (let u = 0; u < ats.length; u++) {
        let at = ats[u]
        let qq = at.qq
        let atUser = _.trimStart(at.text, '@')
        
        // 获取被@用户的对话ID
        let conversationId = await redis.get('CHATGPT:QQ_CONVERSATION:' + qq)
        if (conversationId) {
          // 删除对话
          let deleteResponse = await deleteConversation(conversationId)
          if (Config.debug) {
            logger.mark(deleteResponse)
          }
          
          let deleted = 0
          // 清理相关的对话绑定
          let qcs = await redis.keys('CHATGPT:QQ_CONVERSATION:*')
          for (let i = 0; i < qcs.length; i++) {
            if (await redis.get(qcs[i]) === conversationId) {
              await redis.del(qcs[i])
              if (Config.debug) {
                logger.info('delete conversation bind: ' + qcs[i])
              }
              deleted++
            }
          }
          await this.reply(`${atUser}的对话${conversationId}删除成功，同时清理了${deleted}个同一对话中用户的对话。`)
        } else {
          await this.reply(`${atUser}当前已没有进行对话`)
        }
      }
    }
  }

  /**
   * 切换到图片回复模式
   * 将用户的回复模式设置为图片模式，AI回复将以图片形式展示
   * 
   * @param {object} e - 事件对象
   */
  async switch2Picture (e) {
    // 获取用户当前的回复设置
    let userReplySetting = await redis.get(`CHATGPT:USER:${e.sender.user_id}`)
    if (!userReplySetting) {
      userReplySetting = getDefaultReplySetting()  // 使用默认设置
    } else {
      userReplySetting = JSON.parse(userReplySetting)
    }
    
    // 设置为图片模式
    userReplySetting.usePicture = true
    userReplySetting.useTTS = false
    
    // 保存设置到Redis
    await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userReplySetting))
    await this.reply('ChatGPT回复已转换为图片模式')
  }

  /**
   * 切换到文本回复模式
   * 将用户的回复模式设置为文本模式，AI回复将以纯文本形式展示
   * 
   * @param {object} e - 事件对象
   */
  async switch2Text (e) {
    let userSetting = await getUserReplySetting(this.e)
    
    // 设置为文本模式
    userSetting.usePicture = false
    userSetting.useTTS = false
    
    // 保存设置到Redis
    await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
    await this.reply('ChatGPT回复已转换为文字模式')
  }

  /**
   * 主要的聊天处理函数
  * 处理用户消息，调用AI模型生成回复
   * @param {object} e - 事件对象，包含消息信息
   * @returns {boolean} - 是否成功处理消息
   */
  async chatgpt (e) {///////////////////////////////////////////////////////////ChatGPT主要对话处理方法
    let msg = e.msg            // 用户发送的消息
    let prompt                 // 将要发送给AI的提示文本
    let forcePictureMode = false  // 是否强制使用图片模式回复
    
    // 生成对话键：群聊和私聊独立，且同一用户在不同场景下不混用
    let conversationKey;
    if (e.isGroup) {
      // 群聊场景，按群号+用户号区分
      conversationKey = `group_${e.group_id}_${e.sender.user_id}`;
    } else {
      // 私聊场景
      conversationKey = `private_${e.sender.user_id}`;
    }
    
    // ==================== 回复消息处理逻辑 ====================
    let replyContent = ''  // 存储被回复消息的内容

    // 安全地输出消息对象的关键信息，避免循环引用
    const safeMessageInfo = {
      msg: e.msg,
      message: e.message,
      user_id: e.user_id,
      group_id: e.group_id,
      isGroup: e.isGroup,
      source: e.source,
      atme: e.atme,
      atBot: e.atBot,
      raw_message: e.raw_message
    }
    
    // 尝试从消息中直接提取回复信息
    let replySegment = null
    if (e.message && Array.isArray(e.message)) {
      replySegment = e.message.find(seg => seg.type === 'reply')
      if (replySegment) {
        // logger.info(`[ChatGPT Debug] 从message中找到reply段: ${JSON.stringify(replySegment)}`)
      }
    }
     
    // ==================== 消息预处理 ====================
    // 检查消息是否包含触发关键词（先确保msg存在且为字符串）
    const matchedKeywords = (msg && typeof msg === 'string') ? TRIGGER_KEYWORDS.filter(keyword => 
      msg.toLowerCase().includes(keyword.toLowerCase())
    ) : [];
    const containsTriggerKeyword = matchedKeywords.length > 0;
    
  // 检查用户续接状态（续接状态也要用新的key）
  const canContinue = canUserContinue(conversationKey, e.sender.user_id);
    
    // 添加详细的匹配日志
    if (containsTriggerKeyword) {
      logger.info(`[ChatGPT] 关键词匹配检测: 用户 ${e.sender.user_id} 消息 "${msg}" 匹配到关键词: [${matchedKeywords.join(', ')}]`)
    }
    
    if (canContinue) {
      // logger.info(`[ChatGPT] 续接对话检测: 用户 ${e.sender.user_id} 可以续接对话`)
    }
    
    // ==================== 处理回复消息的多种方式 ====================
    if ((e.source || replySegment) && (e.atme || e.atBot || e.isPrivate || containsTriggerKeyword || canContinue)) {
      replyContent = await this.quoteReply(e, replySegment)
    }

    // 新增：处理私聊中的直接语音消息
    let directAudioUrlContent = '';
    // 条件：私聊、非引用、非关键词触发（避免和文本消息冲突）、是语音消息
    if (e.isPrivate && !e.source && !replySegment) {
      const recordSegment = e.message?.find(seg => seg.type === 'record');
      if (recordSegment?.url) {
        directAudioUrlContent = `[[AUDIO_URL=${recordSegment.url}]]`;
        logger.info(`[ChatGPT Debug] 在私聊中检测到直接发送的语音消息，URL: ${recordSegment.url}`);
      }
    }
    
    // if (this.toggleMode === 'at') {// 艾特模式：只响应艾特机器人的消息或包含关键词的消息
      if (!msg && !directAudioUrlContent) { // 如果没有文本消息也没有语音，则忽略
        return false
      }
      if (e.msg?.startsWith('#')) {
        return false  // 忽略空消息或命令消息
      }
      
      // 修改条件：艾特机器人、包含触发关键词、可以续接对话、或在私聊中发语音
      if ((e.isGroup || e.group_id) && !(e.atme || e.atBot || (e.at === e.self_id) || containsTriggerKeyword || canContinue)) {
        return false  // 群聊中必须满足条件
      }
      
      if (e.user_id == getUin(e)) return false  // 忽略机器人自己的消息

      prompt = msg ? msg.trim() : '' //这一步是为了去除多余空格

      // 如果是通过关键词触发（而非艾特），添加日志记录
      if (containsTriggerKeyword && !(e.atme || e.atBot || (e.at === e.self_id))) { 
        logger.info(`[ChatGPT] 通过关键词触发: 用户 ${e.sender.user_id} 发送消息包含触发词`)
      }
      
      // 如果是通过续接对话触发，添加日志记录
      if (canContinue && !(e.atme || e.atBot || (e.at === e.self_id) || containsTriggerKeyword)) {
        // logger.info(`[ChatGPT] 通过续接对话触发: 用户 ${e.sender.user_id} 在对话窗口期内续接对话`)
      }
      
      // 处理群聊中的艾特信息，移除艾特文本
      try {
        if (e.isGroup) {
          let mm = this.e.bot.gml  // 群成员列表
          let me = mm.get(getUin(e)) || {}  // 获取机器人信息
          let card = me.card      // 群名片
          let nickname = me.nickname  // 昵称
          
          if (nickname && card) {
            if (nickname.startsWith(card)) {
              // 例如nickname是"滚筒洗衣机"，card是"滚筒"
              prompt = prompt.replace(`@${nickname}`, '').trim()
            } else if (card.startsWith(nickname)) {
              // 例如nickname是"十二"，card是"十二｜本月已发送1000条消息"
              prompt = prompt.replace(`@${card}`, '').trim()
              // 如果是好友，显示的还是昵称
              prompt = prompt.replace(`@${nickname}`, '').trim()
            } else {
              // 互不包含，分别替换
              if (nickname) {
                prompt = prompt.replace(`@${nickname}`, '').trim()
              }
              if (card) {
                prompt = prompt.replace(`@${card}`, '').trim()
              }
            }
          } else if (nickname) {
            prompt = prompt.replace(`@${nickname}`, '').trim()
          } else if (card) {
            prompt = prompt.replace(`@${card}`, '').trim()
          }
        }
      } catch (err) {
        logger.warn(err)
      }
    
    let groupId = e.isGroup ? e.group.group_id : ''  // 群号（如果是群聊）

    // ==================== 获取用户配置 ====================
    const userData = await getUserData(e.user_id)
    const use = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE') || 'api'

    // 处理自动化插件的消息更新问题
    // 自动化插件本月已发送xx条消息更新太快，由于延迟和缓存问题导致不同客户端不一样，at文本和获取的card不一致。因此单独处理一下
    prompt = prompt.replace(/^｜本月已发送\d+条消息/, '')

    // ==================== 权限验证 ====================
    // 关闭私聊通道后不回复
    if (!e.isMaster && e.isPrivate && !Config.enablePrivateChat) {
      logger.info(`[ChatGPT] 私聊通道未开启或非Master用户，忽略消息。用户ID: ${e.user_id}`)
      return false
    }

    // ==================== 黑白名单过滤 ====================
    const permissionCheck = checkChatPermission(e)
    if (!permissionCheck.allowed) {
      logger.info(`[ChatGPT] ${permissionCheck.reason}`)
      return false
    }

    // ==================== 屏蔽词检查 ====================
    // 检查输入是否包含屏蔽词
    const promtBlockWord = Config.promptBlockWords.find(word => prompt.toLowerCase().includes(word.toLowerCase()))
    if (promtBlockWord) {
      await this.reply('主人不让我回答你这种问题，真是抱歉了呢', true)
      return false
    }

    // ==================== 构造最终的prompt ====================
    // 整合所有内容到prompt
    prompt = `${directAudioUrlContent}${replyContent}${prompt}`;
    // if (prompt) {
    //   logger.info(`[ChatGPT] 整合后，最终prompt: ${prompt}`);
    // }


    // ==================== 添加日期时间前缀 ====================
    // 在最终prompt前面添加当前日期时间信息
    const now = new Date()
    const currentDateTime = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

    prompt = `当前日期时间：${currentDateTime} 对话人QQ号：${e.sender.user_id}  用户消息：${prompt}`

    // ==================== 消息缓冲和延迟处理机制 ====================
    // 【恢复】消息缓冲和等待机制 (回到之前5秒延迟的模式)
    
    // 设置中断标志
    interruptionFlags.set(conversationKey, true);

    // 新增：检查是否有正在处理的API调用，并合并消息
    if (processingPrompts.has(conversationKey)) {
      const oldPrompt = processingPrompts.get(conversationKey);
      // 从新旧prompt中提取纯粹的用户消息部分
      const oldUserMessage = oldPrompt.match(/用户消息：(.*)$/)?.[1] || '';
      const newUserMessage = prompt.match(/用户消息：(.*)$/)?.[1] || '';
      
      // 找到旧消息的前缀
      const prefixMatch = oldPrompt.match(/^(当前日期时间：.*?用户消息：)/);
      if (prefixMatch) {
        const prefix = prefixMatch[1];
        // 将新消息追加到旧消息后面，形成新的完整prompt
        prompt = prefix + oldUserMessage + ' ' + newUserMessage;
        logger.info(`[ChatGPT] API调用被打断，新旧消息已合并。合并后: '${prompt}'`);
      }
      // 将合并后的消息作为当前缓冲区的第一条消息
      if (chatMessageBuffers.has(conversationKey)) {
        chatMessageBuffers.get(conversationKey).messages = [prompt];
      } else {
        // 如果万一没有缓冲区，就创建一个
        chatMessageBuffers.set(conversationKey, { messages: [prompt], timer: null, e: null, use: use, forcePictureMode: forcePictureMode });
      }
      processingPrompts.delete(conversationKey); // 清除旧的标记
    } else {
      // 原始逻辑：将新消息添加到缓冲区
      // 初始化消息缓冲区（如果不存在）
      if (!chatMessageBuffers.has(conversationKey)) {
          chatMessageBuffers.set(conversationKey, { 
            messages: [],           // 消息数组
            timer: null,           // 定时器
            e: null,               // 事件对象
            use: use,              // AI模型
            forcePictureMode: forcePictureMode  // 强制图片模式
          });
      }
      chatMessageBuffers.get(conversationKey).messages.push(prompt);
    }

    const buffer = chatMessageBuffers.get(conversationKey);

    // 存储或更新最新的事件对象、模型和模式设置
    buffer.e = e;
    buffer.use = use;
    buffer.forcePictureMode = forcePictureMode;
    
    logger.info(`[ChatGPT Debug] 消息已缓冲， 当前缓冲消息数: ${buffer.messages.length}, 消息内容: '${buffer.messages[buffer.messages.length - 1]}'`);

  // 设置用户续接对话状态，允许后续消息无需关键词或@触发
  setUserContinuationState(conversationKey, e.sender.user_id);

    // 清除任何现有的定时器
    if (buffer.timer) {
        clearTimeout(buffer.timer);
        
        // 提取所有消息的用户消息部分，用于日志显示
        const userMessages = buffer.messages.map(msg => {
          const userContentMatch = msg.match(/用户消息：(.*)$/);
          return userContentMatch ? userContentMatch[1] : msg;
        });
        
        logger.info(`[ChatGPT Debug] 重置定时器，当前消息: ${userMessages[userMessages.length - 1]}，合并后用户消息: ${userMessages.join(' ')}`);
    }

    // ==================== 智能等待时间计算 ====================
    // 根据消息内容决定等待时间
    let waitTime = 8000; // 默认8秒
    if(prompt.includes('##')){
        waitTime = 10; // 包含"##"时立即处理
        logger.info(`[ChatGPT Debug] 检测到用户输入"##"`);
    }else if (prompt.endsWith('?')||prompt.endsWith('？')||prompt.endsWith('吗')||
    prompt.includes('什么')||prompt.includes('怎么')||prompt.includes('如何')||prompt.includes('为什么')) {
        waitTime = 4000; // 结尾是疑问词时等待4秒
        logger.info(`[ChatGPT Debug] 检测到用户输入以"?"结尾或包含"吗"，等待时间4秒`);
    }else if(prompt.includes('...')||prompt.includes('。')){
      waitTime = 12000; // 包含省略号或句号时等待12秒
      logger.info(`[ChatGPT Debug] 检测到用户输入"..."，等待时间12秒`);
    }

    // ==================== 设置定时器处理缓冲消息 ====================
    // 设置新的定时器
    buffer.timer = setTimeout(async () => {
      const currentBuffer = chatMessageBuffers.get(conversationKey);
      if (!currentBuffer || currentBuffer.messages.length === 0) {
          logger.warn(`[ChatGPT Debug] 定时器触发但缓冲为空`);
          return;
      }

      // 合并所有缓冲的消息
      let combinedPrompt;
      if (currentBuffer.messages.length === 1) {
        // 只有一条消息时直接使用
        combinedPrompt = currentBuffer.messages[0];
      } else {
        // 多条消息时，提取第一条消息的前缀和所有消息的用户内容
        const firstMessage = currentBuffer.messages[0];
        const prefixMatch = firstMessage.match(/^(当前日期时间：.*?用户消息：)/);
        
        if (prefixMatch) {
          const prefix = prefixMatch[1];
          // 从所有消息中提取用户消息部分
          const userMessages = currentBuffer.messages.map(msg => {
            const userContentMatch = msg.match(/用户消息：(.*)$/);
            return userContentMatch ? userContentMatch[1] : msg;
          });
          combinedPrompt = prefix + userMessages.join(' ');
        } else {
          // 如果无法匹配前缀，回退到原来的合并方式
          combinedPrompt = currentBuffer.messages.join(' ');
        }
      }
      logger.info(`[ChatGPT Debug] 定时器触发，开始调用API, 合并后消息: '${combinedPrompt}'`);

      // 为这个请求生成一个唯一的ID，用于防止重复处理
      const requestId = Date.now().toString();
      pendingRequests.set(conversationKey, requestId);
      // logger.info(`[ChatGPT Debug] 为对话键 ${conversationKey} 生成新的请求 ID: ${requestId}`);
      
      // 清空缓冲列表和定时器引用
      currentBuffer.messages = [];
      currentBuffer.timer = null;
      
      // 调用核心聊天处理函数
      await this.abstractChat(currentBuffer.e, combinedPrompt, currentBuffer.use, currentBuffer.forcePictureMode, requestId);
    }, waitTime); // 使用计算出的等待时间
    // 提前返回 false，因为回复将由定时器异步发送
    return false;
  }

  /**
   * 抽象聊天处理函数 - AI对话的核心处理逻辑
   * 
   * 这个函数负责：
   * 1. 处理图片OCR识别
   * 2. 调用AI模型获取回复
   * 3. 处理AI回复内容（表情、特殊指令等）
   * 4. 根据用户设置选择回复模式（文本/图片/语音）
   * 5. 管理对话上下文和状态
   * 
   * @param {object} e - 事件对象
   * @param {string} prompt - 用户输入的提示文本
   * @param {string} use - 使用的AI模型类型
   * @param {boolean} forcePictureMode - 是否强制使用图片模式
   * @param {string|null} requestId - 请求ID，用于防止重复处理
   */
  async abstractChat (e, prompt, use, forcePictureMode = false, requestId = null) {
    // 生成对话键：群聊和私聊独立，且同一用户在不同场景下不混用
    let conversationKey;
    if (e.isGroup) {
      conversationKey = `group_${e.group_id}_${e.sender.user_id}`;
    } else {
      conversationKey = `private_${e.sender.user_id}`;
    }
    let previousConversation, conversation, key; // 变量声明提前

    // ==================== 请求有效性检查 ====================
    // 在开始处理前，检查这个请求是否仍然是最新的
    if (requestId && pendingRequests.get(conversationKey) !== requestId) {
      logger.info(`[ChatGPT] 请求 ${requestId} 已过时，新的请求正在处理中。此请求将被忽略。`);
      return; // 忽略这个过时的请求
    }
    
    interruptionFlags.set(conversationKey, false); // 重置中断标志

    // ==================== 对话模型与上下文管理 ====================
    // let previousConversation  // 之前的对话记录
    // let conversation = {}      // 当前对话对象
    // let key                    // Redis中存储对话的键名

    // if (use === 'api3') {
    //   // API3模式：所有对话共享一个上下文管理器
    //   let manager = new ConversationManager(e)
    //   let conv = await manager.getConversation(e)
    //   conversation = conv.conversation
    //   key = conv.key
    //   previousConversation = conv.previousConversation
    // } else {
      // ==================== 其他AI模型的对话管理 ====================
      // 非API3模式：每种AI模型使用独立的Redis键名存储对话
      switch (use) {
        case 'gemini': {
          // Google Gemini模型的对话键名
          key = `CHATGPT:CONVERSATIONS_GEMINI:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
      }
      
      // ==================== 对话记录的初始化和恢复 ====================
      let ctime = new Date()  // 当前时间作为创建/更新时间
      
      // 尝试从Redis中恢复之前的对话记录
      previousConversation = (key ? await redis.get(key) : null) || JSON.stringify({
        sender: e.sender,       // 发送者信息（昵称、用户ID等）
        ctime,                  // 对话创建时间
        utime: ctime,          // 最后更新时间
        num: 0,                // 对话轮数计数器
        messages: [{           // 消息历史数组
          role: 'system',      // 系统角色
          content: 'You are an AI assistant that helps people find information.'  // 默认系统提示
        }],
        conversation: {}       // 对话状态对象（存储各种模型特定的状态信息）
      })
      
      // 解析JSON字符串为对象
      previousConversation = JSON.parse(previousConversation)
      
      if (Config.debug) {
        logger.info({ previousConversation })
      }
      
      // ==================== 构造当前对话上下文 ====================
      // 从之前的对话记录中提取必要的状态信息
      conversation = {
        messages: previousConversation.messages,                           // 消息历史
        conversationId: previousConversation.conversation?.conversationId, // 对话ID
        parentMessageId: previousConversation.parentMessageId,             // 父消息ID
        clientId: previousConversation.clientId,                          // 客户端ID（Bing专用）
        invocationId: previousConversation.invocationId,                  // 调用ID（Bing专用）
        conversationSignature: previousConversation.conversationSignature, // 对话签名（Bing专用）
        bingToken: previousConversation.bingToken                         // Bing令牌
      }
    // }

    // ==================== 语音消息处理（Gemini专用） ====================
    // 这段逻辑必须在conversation对象初始化之后
    if (use === 'gemini') {
      const audioMatch = prompt.match(/\[\[AUDIO_URL=(.*?)\]\]/);
      if (audioMatch && audioMatch[1]) {
        const audioUrl = audioMatch[1];
        prompt = prompt.replace(/\[\[AUDIO_URL=.*?\]\]/g, '').trim(); // 从prompt中移除语音URL标记
        logger.info(`[ChatGPT Gemini] 检测到语音消息，URL: ${audioUrl}`);
        conversation.audioUrl = audioUrl; // 将audioUrl附加到conversation对象
      }

      // 新增：处理图片URL
      const imageMatch = prompt.match(/\[\[IMAGE_URL=(.*?)\]\]/);
      if (imageMatch && imageMatch[1]) {
        const imageUrl = imageMatch[1];
        prompt = prompt.replace(/\[\[IMAGE_URL=.*?\]\]/g, '').trim(); // 从prompt中移除图片URL标记
        logger.info(`[ChatGPT Gemini] 检测到图片消息，URL: ${imageUrl}`);
        conversation.imageUrl = imageUrl; // 将imageUrl附加到conversation对象
      }
    }
    
    // ==================== 获取运行时处理器 ====================
    // 运行时处理器用于扩展功能，如按钮、后处理等
    let handler = this.e.runtime?.handler || {
      has: (arg1) => false  // 默认的空处理器，所有功能检查都返回false
    }

    try {
      // 新增：标记prompt正在处理
      processingPrompts.set(conversationKey, prompt);

      if (Config.debug) {
        // 调试模式下可以记录对话状态（当前已注释）
        // logger.mark({ conversation })
      }
      
      // ==================== 调用AI核心处理模块 ====================
      // 这是整个插件的核心：将用户输入发送给AI并获取回复
      
      // 记录API调用
      recordApiCall(e.sender.user_id);
      
      let chatMessage = await Core.sendMessage.bind(this)(prompt, conversation, use, e)

      // 新增：检查API调用返回后，是否已经被新消息打断并合并
      if (!processingPrompts.has(conversationKey)) {
        logger.info(`[ChatGPT] API调用返回，但prompt已被新消息合并处理，本次结果作废。`);
        return; // 直接返回，不处理本次结果
      } else {
        // 如果没有被打断，正常清理标记
        processingPrompts.delete(conversationKey);
      }

      // ==================== 处理AI回复为空的情况 ====================
      if (chatMessage?.noMsg) {
        return false  // AI明确表示不需要回复
      }

        // 保存对话ID到对话记录中
        previousConversation.conversation = {
          conversationId: chatMessage.conversationId
        }
        
        if (use === 'bing' && !chatMessage.error) {
          // ==================== Bing模式的特殊状态管理 ====================
          // Bing聊天需要维护额外的状态信息来保持对话连续性
          previousConversation.clientId = chatMessage.clientId                     // 客户端ID
          previousConversation.invocationId = chatMessage.invocationId             // 调用ID
          previousConversation.parentMessageId = chatMessage.parentMessageId       // 父消息ID
          previousConversation.conversationSignature = chatMessage.conversationSignature  // 对话签名
          previousConversation.bingToken = ''  // 重置Bing令牌
        } else if (chatMessage.id) {
          // ==================== 其他模式的消息ID管理 ====================
          // 大多数AI模型使用简单的消息ID来维护对话链
          previousConversation.parentMessageId = chatMessage.id
        } else if (chatMessage.message) {
          // ==================== 基于消息历史的对话管理 ====================
          // 某些模型通过维护完整的消息历史来保持上下文
          
          // 限制消息历史长度，避免上下文过长影响性能
          if (previousConversation.messages.length > 10) {
            previousConversation.messages.shift()  // 移除最旧的消息
          }
          // 添加新的消息到历史记录
          previousConversation.messages.push(chatMessage.message)
        }
        
        if (Config.debug) {
          // 调试模式下记录AI回复信息（当前已注释）
          // logger.info(chatMessage)
        }
        
        // ==================== 保存对话状态到Redis ====================
        if (!chatMessage.error) {
          // 只有在没有错误的时候才更新对话记录，避免错误状态污染对话历史
          previousConversation.num = previousConversation.num + 1  // 增加对话轮数
          
          // 根据配置决定是否设置过期时间
          const saveOptions = Config.conversationPreserveTime > 0 
            ? { EX: Config.conversationPreserveTime }  // 设置过期时间（秒）
            : {}  // 永不过期
            
          await redis.set(key, JSON.stringify(previousConversation), saveOptions)
        }
      // }
      
      // ==================== AI回复内容预处理 ====================
      let response = chatMessage?.text?.replace('\n\n\n', '\n')  // 清理多余的换行符
      
      // ==================== 应用后处理器 ====================
      // 后处理器可以对AI回复进行各种转换和优化
      let postProcessors = await collectProcessors('post')
      let thinking = chatMessage.thinking_text  // AI的思考过程（如果有）
      
      for (let processor of postProcessors) {
        let output = await processor.processInner({
          text: response,           // 当前的回复文本
          thinking_text: thinking   // 思考过程文本
        })
        response = output.text          // 更新处理后的回复文本
        thinking = output.thinking_text // 更新处理后的思考过程
      }
      
      // ==================== 表情包处理逻辑 ====================
      // 【新增/调整】表情包处理逻辑：从回复文本中提取表情图，并移除表情标记
      // ==================== 表情符号处理功能 ====================
      // 处理回复中的自定义表情标记 {{表情名}}，将其转换为实际的图片消息
      const imagesToSend = [];  // 存储解析出的表情图片段对象
      const emojiRegex = /{{(.*?)}}/g;  // 正则表达式：匹配双大括号包围的表情名称
      let match;

      // 使用临时变量进行表情解析，避免修改原始回复文本
      let tempTextForFindingEmojis = response; 
      
      // 循环查找所有表情标记
      while ((match = emojiRegex.exec(tempTextForFindingEmojis)) !== null) {
        const emojiName = match[1];  // 提取表情名称
        
        // 构建表情图片的本地文件路径
        let imagePath = path.join(__dirname, 'emojis', `${emojiName}.png`);
        const fileUrlImagePath = `file://${imagePath.replace(/\\/g, '/')}`;  // 转换为文件URL格式
        
        try {
          // 创建图片消息段并添加到发送队列
          imagesToSend.push(segment.image(fileUrlImagePath));
        } catch (imgError) {
          // 表情图片加载失败的错误处理
          logger.error(`[ChatGPT] 为 ${emojiName} 创建图片段时出错，路径为 ${fileUrlImagePath}: ${imgError}`);
        }
      }
      
      // ==================== 清理表情标记 ====================
      // 从最终回复文本中移除所有表情标记，只保留纯文本内容
      response = response.replace(emojiRegex, '').trim();

      // ==================== 响应后处理器调用 ====================
      // 如果注册了响应后处理器，在发送回复前调用进行最终处理
      if (handler.has('chatgpt.response.post')) {
        logger.debug('调用后处理器: chatgpt.response.post')
        handler.call('chatgpt.response.post', this.e, {
          content: response,    // 处理后的回复内容
          thinking,            // AI的思考过程
          use,                 // 使用的AI模型
          prompt              // 用户的原始输入
        }, true).catch(err => {
          logger.error('后处理器出错', err)
        })
      }

      // ==================== 表情图片发送处理 ====================
      // 优先发送解析出的表情图片，每张图片单独发送以确保显示效果
      if (imagesToSend.length > 0) {
        const sendImage = Math.random() < 1; // 100%概率发送图片（预留概率控制接口）
        if (sendImage) {
          // ==================== 表情发送延迟控制 ====================
          // 添加1秒延迟，避免消息发送过快导致的显示问题
          await new Promise((resolve) => {
            setTimeout(() => {
              resolve();
            }, 1000);  // 1000毫秒延迟
          });
          
          // ==================== 逐个发送表情图片 ====================
          // 遍历所有表情图片，逐个发送以确保良好的用户体验
          for (const imageSegment of imagesToSend) {
            await this.reply(imageSegment, false); // 图片消息通常不需要引用
            
            // 图片间添加短暂延迟，避免发送过快
            await new Promise((resolve) => {
              setTimeout(() => {
                resolve();
              }, 500); // 500毫秒的图片间隔延迟
            });
          }
        }
      }

      // ==================== Bing建议回复处理 ====================
      // 如果是Bing模式且返回了建议回复，生成并发送建议回复按钮
      if (use === 'bing' && !chatMessage.error && Config.suggestedResponses && chatMessage?.details?.suggestedResponses?.length > 0) {
        let suggested = await generateSuggestedResponse(chatMessage.details.suggestedResponses)
        if (suggested) {
          await this.reply(suggested, true, { btnData: { suggested, use: use } })
        }
      }

      // ==================== 回复内容验证和情绪处理准备 ====================
      let mood = 'blandness'  // 默认情绪：平淡
      
      // 验证是否有有效的回复内容
      if (!response) {
        await this.reply('没有任何回复', true)
        return
      }
      
      // ==================== 回复内容屏蔽词检查 ====================
      // 检查AI回复是否包含配置的屏蔽词
      const blockWord = Config.blockWords.find(word => response.toLowerCase().includes(word.toLowerCase()))
      if (blockWord) {
        await this.reply('返回内容存在敏感词，我不想回答你', true)
        return false
      }
      
      // ==================== 代码块完整性修复 ====================
      // 处理AI回复中被中断的代码区域，确保代码块标记完整
      const codeBlockCount = (response.match(/```/g) || []).length  // 统计代码块标记数量
      const shouldAddClosingBlock = codeBlockCount % 2 === 1 && !response.endsWith('```')  // 判断是否需要补充结束标记
      
      if (shouldAddClosingBlock) {
        response += '\n```'  // 添加缺失的代码块结束标记
      }
      if (codeBlockCount && !shouldAddClosingBlock) {
        // 确保代码块结束标记前有换行符
        response = response.replace(/```$/, '\n```')
      }
      
      // ==================== 处理引用消息 ====================
      let quotemessage = []  // 存储有效的引用消息
      if (chatMessage?.quote) {
        // 过滤空的引用消息
        chatMessage.quote.forEach(function (item, index) {
          if (item.text && item.text.trim() !== '') {
            quotemessage.push(item)
          }
        })
      }
      
      // ==================== 处理回复中的图片链接 ====================
      const regex = /\b((?:https?|ftp|file):\/\/[-a-zA-Z0-9+&@#/%?=~_|!:,.;]*[-a-zA-Z0-9+&@#/%=~_|])/g
      let responseUrls = response.match(regex)  // 提取所有URL
      let imgUrls = []  // 存储图片URL
      
      if (responseUrls) {
        // 检查每个URL是否为图片
        let images = await Promise.all(responseUrls.map(link => isImage(link)))
        imgUrls = responseUrls.filter((link, index) => images[index])  // 筛选出图片URL
      }
      
      // 添加引用消息中的图片链接
      for (let quote of quotemessage) {
        if (quote.imageLink) imgUrls.push(quote.imageLink)
      }

      // ==================== 定时消息处理 ====================
      // 处理 [[定时 YY/MM/DD HH:MM:SS xxxxxx yyyyyy]] 标记并调度定时消息
      // 格式说明：日期时间 + QQ号 + 定时事项内容
      const scheduleRegex = /\[\[定时\s*(\d{4}\/\d{1,2}\/\d{1,2}\s*\d{2}:\d{2}:\d{2})\s*(\d+)\s*(.*?)\]\]/
      const scheduleMatch = response.match(scheduleRegex)
      
      if (scheduleMatch) {
        let [fullMatch, dateTimeStr, targetQQ, content] = scheduleMatch  // 解构匹配结果
        
        // ==================== 处理targetQQ占位符 ====================
        // 如果AI生成的是占位符或无效QQ号，则替换为实际的用户QQ号
        if (!targetQQ || 
            targetQQ.toLowerCase().includes('userqq') || 
            targetQQ.toLowerCase().includes('user') ||
            isNaN(parseInt(targetQQ)) || 
            parseInt(targetQQ) <= 0) {
          targetQQ = e.sender.user_id.toString()  // 使用当前用户的QQ号
          logger.info(`[定时调试] 检测到占位符或无效QQ号，已替换为实际用户QQ: ${targetQQ}`)
        }
        
        const targetTime = moment(dateTimeStr, 'YYYY/MM/DD HH:mm:ss')  // 解析目标时间
        const currentTime = moment()  // 当前时间
        const delay = targetTime.diff(currentTime)  // 计算延迟时间（毫秒）

        logger.info(`[定时调试] 时间字符串: ${dateTimeStr}, 目标时间: ${targetTime.toISOString()}, 当前时间: ${currentTime.toISOString()}, 延迟: ${delay}ms`)

        if (delay > 0) {
          // 延迟时间有效，设置定时任务
          const botInstance = e.bot; // 捕获机器人实例
          const chatgptInstance = this; // 捕获插件实例
          const originalE = e; // 捕获原始事件对象
          
          setTimeout(async (bot) => {
            try {
              // 构造定时消息的虚拟事件对象
              const dummyE = {
                sender: { user_id: targetQQ },  // 目标用户
                isPrivate: true,                // 私聊模式
                bot: bot,                       // 机器人实例
                self_id: originalE.self_id      // 机器人自身ID
              };
              
              // 构造系统提示，让AI生成合适的提醒内容
              const systemPrompt = `【system】:定时提示触发，请根据上下文和提示内容"${content}"给出提示语句以提醒对方做什么事情。`;
              
              // 动态确定定时消息使用的模型，与主程序保持一致
              const userData = await getUserData(targetQQ);
              const useModel = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE') || 'api';

              // 直接调用 abstractChat 方法处理定时消息，复用所有现有逻辑
              await chatgptInstance.abstractChat(dummyE, systemPrompt, useModel, false, null);
              logger.info(`[定时消息][成功] 已向 ${targetQQ} 触发定时提醒处理：${content}`);
            } catch (error) {
              // 定时消息发送失败的错误处理
              logger.error(`[定时消息][错误] 发送定时消息失败到 ${targetQQ}：`, error);
              try {
                // 尝试发送失败通知
                await bot.pickFriend(targetQQ).sendMsg(`定时提醒失败：${content}`);
                logger.info(`[定时消息][错误] 已向 ${targetQQ} 发送定时提醒失败通知。`);
              } catch (replyError) {
                logger.error(`[定时消息][错误] 告知定时提醒失败也失败了：`, replyError);
              }
            }
          }, delay, botInstance);  // 设置定时器
          
          // 向用户确认定时任务设置成功
          await this.reply(`好的~`, true);
          logger.info(`[定时设置] 成功设置定时任务：${dateTimeStr}，目标QQ：${targetQQ}，内容：${content}，延迟：${delay}毫秒。`);
          response = response.replace(fullMatch, '').trim(); // 从回复中移除定时标记
        } else {
          // 延迟时间无效（时间已过）
          await this.reply(`[定时提醒][失败] 定时时间已过，无法设置定时提醒。请检查时间格式并确保时间在未来。您输入的标记为：${fullMatch}`, true);
          logger.warn(`[定时设置][失败] 定时时间已过，无法设置定时任务。标记：${fullMatch}，计算延迟：${delay}毫秒。`);
          response = response.replace(fullMatch, '').trim(); // 即使失败也移除标记
        }
      }

      // ==================== 戳一戳功能处理 ====================
      // 新增：处理 [[戳一戳]] 标记并发送戳一戳动作
      if (response.includes('[[戳一戳]]')) {
        response = response.replace('[[戳一戳]]', '').trim() // 移除标记
        try {
          if (e.poke) {
            await e.poke() // 发送戳一戳动作
          } else {
            logger.warn('当前环境不支持发送戳一戳动作。')
          }
        } catch (error) {
          logger.error('发送戳一戳失败：', error)
        }
      }

      // ==================== 语音回复功能处理 ====================
      // 新增：处理 [[语音]] 标记并发送语音回复
      if (response.includes('[[语音]]')) {
        response = response.replace('[[语音]]', '').trim() // 移除标记
        try {
          // 动态导入语音合成模块
          const { synthesizeAudio } = await import('./audio.js')
          
          // 合成语音文件
          const audioFilePath = await synthesizeAudio(response)
          if (audioFilePath) {
            // 发送语音和文本（双重保险）
            await this.reply(segment.record(audioFilePath))
            await this.reply(response, e.isGroup) 
          } else {
            await this.reply('语音合成失败，请检查日志。', true)
          }
        } catch (error) {
          logger.error('语音合成或发送失败：', error)
          await this.reply('语音合成或发送失败，请检查日志。', true)
        }
        return // 执行完语音回复后立即返回，不执行后续逻辑
      }
      
      // ==================== 空回复处理 ====================
      // 新增：处理 [[empty]] 标记，表示不需要回复
      if (response.includes('[[empty]]')) {
        logger.warn('收到[[empty]]标记，跳过回复')
        return // 不执行后续的文本或图片发送逻辑
      }

      // // ==================== 普通文本模式回复处理 ====================
      // } else {
        // 缓存对话数据用于后续检索和历史记录
        this.cacheContent(e, use, response, prompt, quotemessage, mood, chatMessage.suggestedResponses, imgUrls)
        
        // // ==================== Bing特定错误处理 ====================
        // if (response === 'Thanks for this conversation! I\'ve reached my limit, will you hit "New topic," please?') {
        //   this.reply('当前对话超过上限，已重置对话', false, { at: true })
        //   await redis.del(`CHATGPT:CONVERSATIONS_BING:${e.sender.user_id}`)  // 清除Bing会话缓存
        //   return false
        // } else if (response === 'Throttled: Request is throttled.') {
        //   this.reply('今日对话已达上限')
        //   return false
        // }
        
        // ==================== 智能文本分段发送 ====================
        // 将回复按照合理的分割点分段发送，提升用户体验
        let texts = customSplitRegex(
          response, 
          e.isPrivate ? /\n\n/g : /(?<!\?)[。？\n](?!\?)/, // 私聊双换行分割，群聊句号/问号/换行分割
          e.isPrivate ? Infinity : 3  // 私聊无分段限制，群聊最多3段
        )
        
        // 逐段处理和发送文本
        for (let originalSegmentT of texts) {
          // 检查中断标志
          if (interruptionFlags.get(conversationKey)) {
            logger.info(`[ChatGPT] 对话 ${prompt} 的消息输出被中断。`);
            break; // 停止发送剩余分段
          }
          
          // 跳过空分段
          if (!originalSegmentT) {
            continue
          }
          
          originalSegmentT = originalSegmentT.trim()  // 清理首尾空白
          
          // ==================== 表情符号和@机器人处理 ====================
          let textMsgArray = await convertFaces(originalSegmentT, Config.enableRobotAt, e);
          textMsgArray = textMsgArray.map(filterResponseChunk).filter(i => !!i);  // 过滤处理结果
          
          // 发送消息（包含按钮数据）
          if (textMsgArray.length > 0) {
            await this.reply(textMsgArray, e.isGroup, {
              btnData: {
                use,  // 当前使用的AI模型
                suggested: chatMessage.suggestedResponses  // 建议回复数据
              }
            });
            
            // ==================== 消息间隔控制 ====================
            // 根据文本长度动态调整发送间隔
            await new Promise((resolve) => {
              setTimeout(() => {
                resolve();
              }, Math.min(originalSegmentT.length * 200, 3000)); // 200ms/字符，最长3秒
            });
          }
        }
        
        // ==================== 引用消息处理 ====================
        // 发送引用消息的转发卡片
        if (quotemessage.length > 0 && !interruptionFlags.get(conversationKey)) {
          this.reply(await makeForwardMsg(this.e, quotemessage.map(msg => `${msg.text} - ${msg.url}`)))
        }
        
        // ==================== 建议回复生成与显示 ====================
        // 如果启用了建议回复功能且当前没有建议回复，尝试生成
        if (chatMessage?.conversation && Config.enableSuggestedResponses && !chatMessage.suggestedResponses && Config.apiKey && !interruptionFlags.get(conversationKey)) {
          try {
            chatMessage.suggestedResponses = await generateSuggestedResponse(chatMessage.conversation)
          } catch (err) {
            logger.debug('生成建议回复失败', err)
          }
        }
        
        // ==================== 思考过程显示 ====================
        // 如果AI返回了思考过程，根据配置选择显示方式
        if (thinking && !interruptionFlags.get(conversationKey)) {
          if (Config.forwardReasoning) {
            // 转发消息模式显示思考过程
            let thinkingForward = await common.makeForwardMsg(e, [thinking], '思考过程')
            this.reply(thinkingForward)  // 发送思考过程转发消息
          } else {
            // 日志模式显示思考过程
            logger.mark('思考过程', thinking)
          }
        }

        // ==================== 最终建议回复显示 ====================
        // 在所有消息发送完成后，显示AI建议的回复选项
        if (Config.enableSuggestedResponses && chatMessage.suggestedResponses && !interruptionFlags.get(conversationKey)) {
          this.reply(`建议的回复：\n${chatMessage.suggestedResponses}`)
        }
      // }
      
    // ==================== 异常处理机制 ====================
    } catch (err) {
      logger.error(err)  // 记录详细错误信息
      
      // 新增：在catch块中也要清理标记
      if (processingPrompts.has(conversationKey)) {
        processingPrompts.delete(conversationKey);
      }
      
      // // ==================== API3队列清理 ====================
      // // 如果是API3模式出现异常，需要清理队列腾出位置
      // if (use === 'api3') {
      //   await redis.lPop('CHATGPT:CHAT_QUEUE', 0)
      // }
      
      // ==================== 特定错误类型处理 ====================
      if (err === 'Error: {"detail":"Conversation not found"}') {
        // 对话不存在错误 - 清除会话并提示重试
        await this.destroyConversations(err)
        await this.reply('当前对话异常，已经清除，请重试', true, { recallMsg: e.isGroup ? 10 : 0 })
      } else {
        // ==================== 通用错误处理 ====================
        // 提取错误消息文本
        let errorMessage = err?.message || err?.data?.message || (typeof (err) === 'object' ? JSON.stringify(err) : err) || '未能确认错误类型！'
        
        if (errorMessage.length < 200) {
          // 短错误消息：直接文本回复
          await this.reply(`出现错误：${errorMessage}\n请重试或联系Bot管理员`, true, { recallMsg: e.isGroup ? 10 : 0 })
        } else {
          // 长错误消息：渲染为图片回复（避免刷屏）
          await this.renderImage(e, use, `出现异常,错误信息如下 \n \`\`\`${errorMessage}\`\`\``, prompt)
        }
      }
      
      // ==================== 清除续接对话状态（错误情况） ====================
      // 即使出现错误，也要清除用户的续接对话状态
      clearUserContinuationState(conversationKey, e.sender.user_id);
    }
    
    // ==================== 清除续接对话状态 ====================
    // AI响应完成后，清除用户的续接对话状态，要求下次必须重新使用关键词或@触发
    clearUserContinuationState(conversationKey, e.sender.user_id);
  }

  // ================================================
  // 内容处理与渲染功能区域
  // ================================================

  /**
   * ==================== 对话内容缓存功能 ====================
   * 将对话内容发送到渲染服务器进行缓存，用于后续的图片渲染和内容管理
   * 这个功能支持将聊天记录保存为可视化的图片格式，便于分享和查看
   * 
   * @param {object} e - 事件对象，包含用户和群组信息
   * @param {string} use - 当前使用的AI模型标识
   * @param {string} content - AI生成的回复内容
   * @param {string} prompt - 用户发送的原始提示内容
   * @param {array} quote - 引用的消息数组，默认为空数组
   * @param {string} mood - 情绪信息，用于TTS语音合成，默认为空
   * @param {string} suggest - AI建议的后续回复内容，默认为空
   * @param {array} imgUrls - 消息中包含的图片URL数组，默认为空数组
   * @returns {object} 返回缓存操作结果对象，包含文件名、状态等信息
   */
  async cacheContent (e, use, content, prompt, quote = [], mood = '', suggest = '', imgUrls = []) {
    // ==================== 功能开关检查 ====================
    // 如果未启用工具箱功能，跳过缓存操作
    if (!Config.enableToolbox) {
      return
    }
    
    // ==================== 初始化缓存数据对象 ====================
    let cacheData = {
      file: '',     // 生成的缓存文件名
      status: ''    // HTTP响应状态码
    }
    
    // ==================== 生成唯一缓存文件标识 ====================
    cacheData.file = randomString()  // 生成随机字符串作为缓存文件名
    
    // ==================== 构建缓存请求数据 ====================
    const cacheresOption = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: {
          content: Buffer.from(content).toString('base64'),      // 将回复内容转为Base64编码
          prompt: Buffer.from(prompt).toString('base64'),        // 将用户输入转为Base64编码
          senderName: e.sender.nickname,                         // 消息发送者的昵称
          style: Config.toneStyle,                               // 配置的语调风格
          mood,                                                  // 情绪标识（用于TTS）
          quote,                                                 // 引用的消息列表
          group: e.isGroup ? e.group.name : '',                 // 群组名称（群聊时）
          suggest: suggest ? suggest.split('\n').filter(Boolean) : [], // 建议回复转为数组
          images: imgUrls                                        // 消息中的图片URL列表
        },
        model: use,                                              // 当前使用的AI模型
        bing: use === 'bing',                                   // 是否为Bing模式的特殊标识
        chatViewBotName: Config.chatViewBotName || '',          // 聊天视图中显示的机器人名称
        entry: cacheData.file,                                  // 缓存入口文件名
        userImg: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.sender.user_id}`,     // 用户QQ头像URL
        botImg: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${getUin(e)}`,             // 机器人QQ头像URL
        cacheHost: Config.serverHost,                           // 缓存服务器主机地址
        qq: e.sender.user_id                                    // 用户QQ号码
      })
    }
    
    // ==================== 发送缓存请求 ====================
    // 向渲染服务器发送缓存请求，将对话数据保存到服务器
    const cacheres = await fetch(
      Config.viewHost ? `${Config.viewHost}/` : `http://127.0.0.1:${Config.serverPort || 3321}/` + 'cache', 
      cacheresOption
    )
    
    // ==================== 处理缓存响应 ====================
    if (cacheres.ok) {
      // 请求成功，合并响应数据到缓存对象
      cacheData = Object.assign({}, cacheData, await cacheres.json())
    } else {
      // 请求失败，记录错误信息
      cacheData.error = '渲染服务器出错！'
    }
    cacheData.status = cacheres.status  // 保存HTTP状态码
    return cacheData
  }

  /**
   * ==================== 对话内容图片渲染功能 ====================
   * 调用渲染服务器将对话内容转换为图片格式并发送给用户
   * 适用于长文本、代码块、表格等需要特殊格式展示的内容
   * 
   * @param {object} e - 事件对象，包含
   * @param {string} use - 当前使用的AI模型标识  
   * @param {string} content - AI生成的回复内容
   * @param {string} prompt - 用户发送的原始提示内容
   * @param {array} quote - 引用的消息数组，默认为空数组
   * @param {string} mood - 情绪信息，用于TTS和情绪表达，默认为空
   * @param {string} suggest - AI建议的后续回复内容，默认为空
   * @param {array} imgUrls - 消息中包含的图片URL数组，默认为空数组
   */
  async renderImage (e, use, content, prompt, quote = [], mood = '', suggest = '', imgUrls = []) {
    // ==================== 内容缓存步骤 ====================
    // 首先将对话内容缓存到渲染服务器，为图片生成做准备
    let cacheData = await this.cacheContent(e, use, content, prompt, quote, mood, suggest, imgUrls)
    
    // ==================== 缓存结果检查 ====================
    // 检查缓存操作是否成功完成
    if (cacheData.error || cacheData.status != 200) {
      // 缓存失败，发送错误提示给用户
      await this.reply(`出现错误：${cacheData.error || 'server error ' + cacheData.status}\n请重试或联系Bot管理员`, true)
    } else {
      // ==================== 图片渲染与发送 ====================
      // 缓存成功，调用渲染服务生成图片并发送
      await this.reply(await renderUrl(e, 
        // 构建渲染页面的完整URL
        (Config.viewHost ? `${Config.viewHost}/` : `http://127.0.0.1:${Config.serverPort || 3321}/`) + 
        `page/${cacheData.file}?qr=${Config.showQRCode ? 'true' : 'false'}`, 
        {
          // ==================== 渲染配置参数 ====================
          retType: Config.quoteReply ? 'base64' : '',              // 返回类型：引用回复时使用base64格式
          Viewport: {
            width: parseInt(Config.chatViewWidth),                 // 渲染视口宽度
            height: parseInt(parseInt(Config.chatViewWidth) * 0.56) // 渲染视口高度（16:9比例）
          },
          // Live2D动画功能配置（仅在本地服务且启用时生效）
          func: (parseFloat(Config.live2d) && !Config.viewHost) ? 'window.Live2d == true' : '', 
          deviceScaleFactor: parseFloat(Config.cloudDPR)          // 设备像素比例，影响图片清晰度
        }
      ), e.isGroup && Config.quoteReply)                       // 群聊且启用引用回复时进行引用
    }
  }

  /**
   * ==================== 获取所有对话会话功能 ====================
   * 获取当前用户的所有ChatGPT对话会话列表
   * 仅支持API3模式，用于管理和查看历史对话
   * 
   * @param {object} e - 事件对象，包含用户消息和上下文信息
   * @returns {Promise} 返回渲染结果
   */
  async getAllConversations (e) {
    // ==================== 检查当前使用模式 ====================
    const use = await redis.get('CHATGPT:USE')
      return await this.getConversations(e)
    // }
  }

  /**
   * ==================== 处理引用回复消息 ====================
   * 当用户回复某条消息并@机器人时，获取被回复的消息内容
   * 支持多种获取方式：e.source、reply segment、segment文本信息
   * 
   * @param {object} e - 事件对象，包含消息上下文
   * @param {object} replySegment - 回复消息段对象
   * @returns {Promise<string>} 返回格式化的回复内容字符串
   */
  async quoteReply(e, replySegment) {
    try {
      logger.info(`[ChatGPT Debug] 开始处理回复消息`)
      
      let originalMessage = null
      
      // 方式1：通过e.source获取历史消息
      if (e.source) {
        let replyMsg = null
        if (e.isGroup) {
          replyMsg = await e.group.getChatHistory(e.source.seq, 1)
        } else {
          replyMsg = await e.friend.getChatHistory(e.source.seq, 1)
        }
        
        if (replyMsg && replyMsg.length > 0) {
          originalMessage = replyMsg[0]
          logger.info(`[ChatGPT Debug] 通过source获取到回复消息`)
        }
      }

      // 方式2：通过reply segment获取历史消息
      if (!originalMessage && replySegment && replySegment.id) {
        try {
          let replyMsg = null
          if (e.isGroup) {
            replyMsg = await e.group.getChatHistory(replySegment.id, 1)
          } else {
            replyMsg = await e.friend.getChatHistory(replySegment.id, 1)
          }
          
          if (replyMsg && replyMsg.length > 0) {
            originalMessage = replyMsg[0]
            logger.info(`[ChatGPT Debug] 通过reply segment获取到回复消息`)
          }
        } catch (replySegErr) {
          logger.warn(`[ChatGPT Debug] 通过reply segment获取消息失败: ${replySegErr}`)
        }
      }
      
      // 方式3：如果有reply segment但获取不到历史消息，尝试使用segment中的信息
      if (!originalMessage && replySegment) {
        if (replySegment.text || replySegment.content) {
          originalMessage = {
            raw_message: replySegment.text || replySegment.content
          }
          logger.info(`[ChatGPT Debug] 使用reply segment中的文本信息`)
        }
      }
      
      // ==================== 提取被回复消息的文本内容 ====================
      if (originalMessage) {
        let replyText = ''
        let replyContent = '' // 在这里初始化 replyContent

        // 新增：如果引用了文件，读取文件内容
        if (e.source?.file) {
            const file = e.source.file;
            logger.info(`[Chat] 检测到引用文件: ${file.name}, 大小: ${file.size}`);
            try {
                const response = await fetch(file.url);
                if (response.ok) {
                    const content = await response.text();
                    let fileContent = '';
                    if (content.length > 200) {
                        fileContent = content.substring(0, 200);
                        logger.info(`[Chat] 文件 ${file.name} 内容读取成功 (截取前200字符)。`);
                    } else {
                        fileContent = content;
                        logger.info(`[Chat] 文件 ${file.name} 内容读取成功 (全文)。`);
                    }
                    replyContent += `【以下是引用的文件'${file.name}'中的内容】:\n${fileContent}\n`;
                } else {
                    logger.error(`[Chat] 下载文件 ${file.name} 失败，状态码: ${response.status}`);
                }
            } catch (error) {
                logger.error(`[Chat] 读取或处理文件 ${file.name} 时出错:`, error);
            }
        }
        
        logger.info(`[ChatGPT Debug] 原始消息结构: ${JSON.stringify(originalMessage)}`)
        
        // 提取被回复消息的文本内容
        if (originalMessage.message && Array.isArray(originalMessage.message)) {
          for (let segment of originalMessage.message) {
            if (segment.type === 'text') {
          replyText += segment.text;
            } else if (segment.type === 'image') {
          if (segment.url) {
            replyText += `[[IMAGE_URL=${segment.url}]]`;
            logger.info(`[ChatGPT Debug] 提取到引用图片URL: ${segment.url}`);
          } else {
            replyText += '[图片]';
          }
            } else if (segment.type === 'face') {
          replyText += '[表情]';
            } else if (segment.type === 'at') {
          replyText += `@${segment.text || segment.qq}`;
            } else if (segment.type === 'record') {
          if (segment.url) {
            replyText += `[[AUDIO_URL=${segment.url}]]`;
            // logger.info(`[ChatGPT Debug] 提取到语音消息URL: ${segment.url}`);
          } else {
            replyText += '[语音]';
          }
            } else if (segment.type === 'video') {
              if (segment.url) {
                replyText += `[[VIDEO_URL=${segment.url}]]`;
                logger.info(`[ChatGPT Debug] 提取到引用视频URL: ${segment.url}`);
              } else {
                replyText += '[视频]';
              }
            } else if (segment.type === 'file' && segment.file) {
              // 新增：处理文件类型的消息段
              // 尝试从 e.source 获取更完整的文件信息，包括 URL
              if (e.source?.file?.url) {
                try {
                  const response = await fetch(e.source.file.url);
                  if (response.ok) {
                    const content = await response.text();
                    let fileContent = '';
                    if (content.length > 200) {
                      fileContent = content.substring(0, 200);
                      logger.info(`[Chat] 文件 ${e.source.file.name} 内容读取成功 (截取前200字符)。`);
                    } else {
                      fileContent = content;
                      logger.info(`[Chat] 文件 ${e.source.file.name} 内容读取成功 (全文)。`);
                    }
                    // 将文件内容直接加入 replyText
                    replyText += `\n【以下是引用的文件'${e.source.file.name}'中的内容】：\n${fileContent}\n`;
                  } else {
                    logger.error(`[Chat] 下载文件 ${e.source.file.name} 失败，状态码: ${response.status}`);
                    replyText += `[文件: ${segment.file}]`;
                  }
                } catch (error) {
                  logger.error(`[Chat] 读取或处理文件 ${e.source.file.name} 时出错:`, error);
                  replyText += `[文件: ${segment.file}]`;
                }
              } else {
                logger.warn(`[Chat] 未能获取文件 ${segment.file} 的下载链接，仅记录文件名。`);
                replyText += `[文件: ${segment.file}]`;
              }
            }
          }
        } else if (typeof originalMessage.raw_message === 'string') {
          replyText = originalMessage.raw_message
        } else if (typeof originalMessage.message === 'string') {
          replyText = originalMessage.message
        }
        
        logger.info(`[ChatGPT Debug] 提取的回复文本: '${replyText}'`)
        
        // 如果成功提取到回复文本，构造上下文
        if (replyText.trim()) {
          // 获取被引用消息发送者的群名片或昵称
          let senderName = '某用户'
          if (originalMessage.sender) {
            // 优先使用群名片，其次是昵称，最后是用户ID
            senderName = originalMessage.sender.card || 
                        originalMessage.sender.nickname || 
                        originalMessage.sender.user_id || 
                        '某用户'
          } else if (originalMessage.user_id) {
            // 如果没有sender对象，尝试直接获取user_id
            senderName = originalMessage.user_id
          }
          
          const replyContent = `【对话人引用的用户‘${senderName}’的消息内容】：${replyText.trim()}\n【对话人的主消息内容】：`
          logger.info(`[ChatGPT] 检测到回复消息，被回复内容: ${replyText.trim()}，发送者: ${senderName}`)
          return replyContent
        } else {
          logger.warn(`[ChatGPT Debug] 回复文本为空`)
        }
      } else {
        logger.warn(`[ChatGPT Debug] 未获取到回复消息`)
      }
    } catch (err) {
      logger.warn('[ChatGPT] 获取回复消息失败:', err)
    }
    
    return '' // 如果没有获取到有效的回复内容，返回空字符串
  }

  /**
   * ==================== 其他AI模式通用处理功能 ====================
   * 处理各种AI模型的通用调用逻辑
   * 包括权限检查、命令解析、@检测、图片模式识别等
   * 
   * @param {object} e - 事件对象，包含用户消息和上下文信息
   * @param {string} mode - AI模型标识（如'api', 'bing', 'claude'等）
   * @param {RegExp|string} pattern - 匹配命令的正则表达式或字符串模式，默认为`#${mode}`
   * @returns {Promise<boolean>} 返回处理结果，true表示成功处理，false表示未处理
   */
  async otherMode (e, mode, pattern = `#${mode}`) {
    // ==================== 权限检查 ====================
    // 检查是否允许使用其他AI模式
    if (!Config.allowOtherMode) {
      return false
    }
    
    // ==================== @消息检测 ====================
    // 检查消息中的@情况，避免响应不相关的消息
    let ats = e.message.filter(m => m.type === 'at')  // 筛选所有@消息
    if (!(e.atme || e.atBot) && ats.length > 0) {
      // 如果消息中有@但没有@机器人，则忽略
      if (Config.debug) {
        logger.mark('艾特别人了，没艾特我，忽略' + pattern)
      }
      return false
    }
    
    // ==================== 命令内容提取 ====================
    // 从消息中提取实际的提示内容（移除命令前缀）
    let prompt = _.replace(e.msg.trimStart(), pattern, '').trim()
    if (prompt.length === 0) {
      return false  // 如果没有有效内容，不处理
    }
    
    // ==================== 图片模式检测 ====================
    // 检查是否为强制图片输出模式
    let forcePictureMode = e.msg.trimStart().startsWith('#图片')
    
    // ==================== 调用核心处理逻辑 ====================
    // 调用抽象聊天处理函数进行实际的AI对话
    await this.abstractChat(e, prompt, mode, forcePictureMode)
    return true
  }
    // 聊天记录备份到本地
  async backupConversation(e) {
    const userId = e.sender.user_id;
    const key = `CHATGPT:CONVERSATIONS:${userId}`;
    const filePath = path.join(__dirname, 'chat_history', `${userId}.json`);
    try {
      const data = await redis.get(key);
      if (!data) {
        await this.reply('未找到你的聊天记录，无法备份。', true);
        return true;
      }
      fs.writeFileSync(filePath, data, 'utf8');
      await this.reply(`聊天记录已备份到本地：${filePath}`);
    } catch (err) {
      logger.error(`[备份聊天记录] 失败: ${err}`);
      await this.reply('备份失败，请检查日志。', true);
    }
    return true;
  }

  // 聊天记录恢复/继承
  async restoreConversation(e) {
    const match = e.msg.match(/^#恢复(\d+)$/);
    if (!match) {
      await this.reply('格式错误，应为#恢复QQ号', true);
      return true;
    }
    const fromId = match[1];
    const filePath = path.join(__dirname, 'chat_history', `${fromId}.json`);
    const toId = e.sender.user_id;
    const key = `CHATGPT:CONVERSATIONS:${toId}`;
    try {
      if (!fs.existsSync(filePath)) {
        await this.reply('未找到该QQ号的聊天记录备份文件。', true);
        return true;
      }
      const data = fs.readFileSync(filePath, 'utf8');
      await redis.set(key, data);
      await this.reply(`已继承QQ号${fromId}的聊天记录。`);
    } catch (err) {
      logger.error(`[恢复聊天记录] 失败: ${err}`);
      await this.reply('恢复失败，请检查日志。', true);
    }
    return true;
  }
}

/**
 * 黑白名单权限检查函数
 * 检查用户是否有权限进行ChatGPT对话
 * 
 * @param {object} e - 事件对象，包含用户和群组信息
 * @returns {object} 返回检查结果 {allowed: boolean, reason: string}
 */
function checkChatPermission(e) {
  // ==================== 获取配置的黑白名单 ====================
  let [whitelist = [], blacklist = []] = [Config.whitelist, Config.blacklist]
  let chatPermission = false // 对话许可状态
  
  // ==================== 统一处理名单格式 ====================
  if (typeof whitelist === 'string') {
    whitelist = [whitelist]
  }
  if (typeof blacklist === 'string') {
    blacklist = [blacklist]
  }
  
  // ==================== 白名单检查 ====================
  if (whitelist.join('').length > 0) {
    for (const item of whitelist) {
      if (item.length > 11) {
        // 格式：群号^用户QQ（特定群的特定用户）
        const [group, qq] = item.split('^')
        if (e.isGroup && group === e.group_id.toString() && qq === e.sender.user_id.toString()) {
          chatPermission = true
          break
        }
      } else if (item.startsWith('^') && item.slice(1) === e.sender.user_id.toString()) {
        // 格式：^用户QQ（任意位置的特定用户）
        chatPermission = true
        break
      } else if (e.isGroup && !item.startsWith('^') && item === e.group_id.toString()) {
        // 格式：群号（整个群）
        chatPermission = true
        break
      }
    }
    
    // 如果有白名单配置但用户不在白名单中，拒绝访问
    if (!chatPermission) {
      return {
        allowed: false,
        reason: `用户不在白名单中。用户ID: ${e.sender.user_id}${e.isGroup ? `, 群ID: ${e.group_id}` : ''}`
      }
    }
  }
  
  // ==================== 黑名单检查（仅在没有白名单权限时进行） ====================
  if (!chatPermission && blacklist.join('').length > 0) {
    for (const item of blacklist) {
      if (e.isGroup && !item.startsWith('^') && item === e.group_id.toString()) {
        return {
          allowed: false,
          reason: `消息命中黑名单群组，忽略。群ID: ${e.group_id}`
        }
      }
      if (item.startsWith('^') && item.slice(1) === e.sender.user_id.toString()) {
        return {
          allowed: false,
          reason: `消息命中黑名单用户，忽略。用户ID: ${e.sender.user_id}`
        }
      }
      if (item.length > 11) {
        const [group, qq] = item.split('^')
        if (e.isGroup && group === e.group_id.toString() && qq === e.sender.user_id.toString()) {
          return {
            allowed: false,
            reason: `消息命中黑名单特定用户，忽略。群ID: ${e.group_id}, 用户ID: ${e.sender.user_id}`
          }
        }
      }
    }
  }
  
  // ==================== 权限检查通过 ====================
  return {
    allowed: true,
    reason: chatPermission ? '用户在白名单中' : '无黑白名单限制'
  }
}
