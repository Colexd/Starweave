/**
 * @file greet.js
 * @description 这是一个用于定时向指定QQ用户发送问候消息的插件。
 *              它通过调用chat.js中的chatgpt接口实现消息发送。
 */

import plugin from '../../../lib/plugins/plugin.js'
import { chatgpt } from './chat.js' // 导入 chatgpt 类，用于调用其抽象聊天接口
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 用于 ES 模块中的 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class Greet extends plugin {
  /**
   * 辅助函数：将Date对象格式化为UTC+8时间字符串 (YYYY-MM-DDTHH:mm:ss.sss+08:00)
   * @param {Date} dateObject 要格式化的Date对象
   * @returns {string} 格式化后的时间字符串
   */
  formatToUTCPlus8(dateObject) {
    const year = dateObject.getFullYear();
    const month = (dateObject.getMonth() + 1).toString().padStart(2, '0');
    const day = dateObject.getDate().toString().padStart(2, '0');
    const hours = dateObject.getHours().toString().padStart(2, '0');
    const minutes = dateObject.getMinutes().toString().padStart(2, '0');
    const seconds = dateObject.getSeconds().toString().padStart(2, '0');
    const milliseconds = dateObject.getMilliseconds().toString().padStart(3, '0');

    // 直接使用本地时间组件并附加+08:00，避免复杂的UTC转换逻辑
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`;
  }

  /**
   * @constructor
   * 插件的构造函数，用于初始化插件的名称、描述、事件和规则。
   */
  constructor () {
    super({
      name: '定时问候', // 插件名称
      dsc: '定时向指定用户发送问候消息', // 插件描述
      event: 'message', // 监听消息事件
      rule: [
        {
          reg: '^#开启定时问候$', // 匹配开启命令的正则表达式
          fnc: 'startGreeting', // 对应执行的方法
          // permission: 'master' // 只有master权限的用户才能使用
        },
        {
          reg: '^#关闭定时问候$', // 匹配关闭命令的正则表达式
          fnc: 'stopGreeting', // 对应执行的方法
          // permission: 'master' // 只有master权限的用户才能使用
        }
      ]
    })

    
    this.interval = null // 用于存储 setInterval 的句柄，以便后续清除定时器
    this.bot = null // 用于存储机器人实例，以便发送消息
    this.configFile = path.join(__dirname, 'greet_config.json') // 用户配置路径，保存在代码同目录
    this.userConfigs = {} // 用户配置缓存
    this.loadConfig() // 加载用户配置文件

    this.logFile = path.join(__dirname, 'greet_log.json') // 日志文件路径
    this.runConfigFile = path.join(__dirname, 'greet_run.json') // 运行配置（调度计划）文件路径
    this.runConfig = {} // 运行配置缓存
    this.scheduledTimeout = null // 用于存储 setTimeout 的句柄，以便清除本小时的具体问候定时器
    this.loadRunConfig() // 加载运行配置文件

    // 绑定方法，确保 'this' 上下文正确
    this.startGreeting = this.startGreeting.bind(this);
    this.stopGreeting = this.stopGreeting.bind(this);
    this.sendActualGreeting = this.sendActualGreeting.bind(this);
    this.loadConfig = this.loadConfig.bind(this);
    this.saveConfig = this.saveConfig.bind(this);
    this.isUserEnabled = this.isUserEnabled.bind(this);
    this.setUserStatus = this.setUserStatus.bind(this);
    this.addLogEntry = this.addLogEntry.bind(this);
    this.loadRunConfig = this.loadRunConfig.bind(this); // 绑定新的方法
    this.saveRunConfig = this.saveRunConfig.bind(this); // 绑定新的方法
    this.scheduleHourlyGreeting = this.scheduleHourlyGreeting.bind(this); // 绑定新的方法
    this.executeScheduledGreeting = this.executeScheduledGreeting.bind(this); // 绑定新的方法
    this.formatToUTCPlus8 = this.formatToUTCPlus8.bind(this); // 绑定新的辅助函数
  }

  /**
   * 加载用户配置文件
   */
  loadConfig() {
    try {
      // 如果配置文件存在，则读取
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8')
        this.userConfigs = JSON.parse(data)
        console.log('[定时问候] 用户配置文件加载成功：', this.userConfigs)
      } else {
        // 如果配置文件不存在，创建默认配置
        this.userConfigs = {}
        this.saveConfig()
        console.log('[定时问候] 用户配置文件不存在，已创建新的默认配置。')
      }
    } catch (error) {
      console.error('[定时问候] 加载用户配置文件时出错：', error)
      this.userConfigs = {}
    }
  }

  /**
   * 保存用户配置文件
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.userConfigs, null, 2), 'utf8')
      console.log('[定时问候] 用户配置文件保存成功：', this.userConfigs)
    } catch (error) {
      console.error('[定时问候] 保存用户配置文件时出错：', error)
    }
  }

  /**
   * 加载运行配置文件 (greet_run.json)
   */
  loadRunConfig() {
    try {
      if (fs.existsSync(this.runConfigFile)) {
        const data = fs.readFileSync(this.runConfigFile, 'utf8')
        this.runConfig = JSON.parse(data)
        console.log('[定时问候] 运行配置加载成功：', this.runConfig)
      } else {
        this.runConfig = {}
        this.saveRunConfig()
        console.log('[定时问候] 运行配置文件不存在，已创建新的默认配置。')
      }
    } catch (error) {
      console.error('[定时问候] 加载运行配置文件时出错：', error)
      this.runConfig = {}
    }
  }

  /**
   * 保存运行配置文件 (greet_run.json)
   */
  saveRunConfig() {
    try {
      fs.writeFileSync(this.runConfigFile, JSON.stringify(this.runConfig, null, 2), 'utf8')
      console.log('[定时问候] 运行配置保存成功：', this.runConfig)
    } catch (error) {
      console.error('[定时问候] 保存运行配置文件时出错：', error)
    }
  }

  /**
   * 添加日志条目
   * @param {object} data 要记录的数据
   */
  addLogEntry(data) {
    // 只记录 type 为 'probabilityCheck' 或 'greeting' 的日志
    if (data.type === 'probabilityCheck' || data.type === 'greeting') {
      try {
        const logEntry = {
          timestamp: this.formatToUTCPlus8(new Date()), // 保存为UTC+8时间
          ...data
        }
        fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n', 'utf8')
      } catch (error) {
        console.error('[定时问候] 添加日志条目时出错：', error)
      }
    }
  }

  /**
   * 检查指定用户是否已开启定时问候
   * @param {string} userId 用户ID
   * @returns {boolean} 是否开启
   */
  isUserEnabled(userId) {
    const isEnabled = this.userConfigs[userId] === 'on'
    console.log(`[定时问候] 检查用户 ${userId} 状态：${isEnabled ? '已开启' : '未开启'}`)
    return isEnabled
  }

  /**
   * 设置用户定时问候状态
   * @param {string} userId 用户ID
   * @param {string} status 状态 ('on' 或 'off')
   */
  setUserStatus(userId, status) {
    console.log(`[定时问候] 设置用户 ${userId} 状态为：${status}`)
    this.userConfigs[userId] = status
    this.saveConfig()
  }

  /**
   * 处理 #开启定时问候 命令
   * @param {object} e 消息事件对象
   */
  async startGreeting (e) {
    const userId = e.sender.user_id.toString()
    this.bot = e.bot
    const wasEnabled = this.isUserEnabled(userId);

    // 设置用户状态为开启
    this.setUserStatus(userId, 'on')
    console.log(`[定时问候] 用户 ${userId} 发送 #开启定时问候 命令。`)

    // 立即为当前发送命令的用户发送一条问候 (无视其他条件)
    const nowForMessage = new Date()
    const currentTime = nowForMessage.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    const greetingMessage = `【system】现在的时间是：${currentTime}，触发了主动聊天事件。
接下来的情景是你要假扮在主动找我聊天，你可以像真人一样根据现在的时间和在做什么情况来主动给我发送消息
（如：熬夜的时间可以说是在加班，半夜的时间可以说是失眠或者起夜上厕所之类的）。
可以是询问之前的聊天内容，或者吐槽学习生活或工作，或者问候吃没吃饭自己吃的什么饭，或者早晚安，或者单纯的一句打招呼都可以
（你不知道对方在做什么的情况下，这次是你主动地问候一下，而不是对方找你）。
如果上次的消息没有被回复一定要问一下对话人在做什么。
尽量做到有感情色彩，按照多姿多彩的生活来问候。
如果在和对话人的正常聊天的过程中触发了主动聊天，可以讲一些题外话（比如说：对了，上次xxxxxx）。`
    await this.sendActualGreeting(userId, greetingMessage)
    console.log(`[定时问候] 已向用户 ${userId} 立即发送问候 (通过 startGreeting 命令触发)。`)
    this.addLogEntry({
      type: 'greeting',
      action: 'immediateGreeting',
      userId: userId,
      messageContent: greetingMessage,
      sentAt: this.formatToUTCPlus8(new Date()) // 保存为UTC+8时间
    })

    // 如果是第一个开启的用户，启动全局定时器
    if (!this.interval) {
      console.log('[定时问候] 未找到全局定时器，正在初始化机器人实例并启动定时器。')
      console.log('[定时问候] 全局定时器启动。')

      // 立即触发一次调度，填充 greet_run.json
      this.scheduleHourlyGreeting(); 

      // 计算到下一个整点0分0秒的毫秒数
      const now = new Date();
      const nextFullHour = new Date(now);
      nextFullHour.setHours(now.getHours() + 1);
      nextFullHour.setMinutes(0);
      nextFullHour.setSeconds(0);
      nextFullHour.setMilliseconds(0);
      const initialDelay = nextFullHour.getTime() - now.getTime();

      console.log(`[定时问候] 首次每小时调度将在 ${nextFullHour.toLocaleTimeString('zh-CN')} 进行（${initialDelay / 1000} 秒后）。`);

      // 设置每小时执行一次的主定时器，在`initialDelay`后首次触发
      this.interval = setTimeout(() => {
          console.log('[定时问候] 全局每小时定时器触发（通过 setTimeout）。');
          this.scheduleHourlyGreeting(); // 触发本小时调度

          // 启动每小时的循环定时器
          this.interval = setInterval(async () => {
              console.log('[定时问候] 全局每小时定时器触发（通过 setInterval）。');
              this.scheduleHourlyGreeting(); // 每个小时开始时安排随机问候
          }, 3600000); // 每小时执行一次 (3600秒 * 1000毫秒/秒)
          console.log('[定时问候] 全局定时器已成功启动。');
      }, initialDelay);
    } else {
      console.log('[定时问候] 全局定时器已在运行中。')
    }

    // 计算并输出下一次每小时调度的时间 (仅为信息提示，实际调度由定时器控制)
    let nextScheduledTimeDisplay = "下次问候时间将根据每小时随机确定";
    // 从 greet_run.json 中读取下一次问候时间
    this.loadRunConfig(); // 确保加载最新配置
    if (this.runConfig.shouldSend && this.runConfig.nextGreetingTime) {
        const scheduledDate = new Date(this.runConfig.nextGreetingTime);
        nextScheduledTimeDisplay = `下次问候预计时间为：${scheduledDate.toLocaleTimeString('zh-CN')}。`;
    }

    if (wasEnabled) {
      e.reply(`您已经开启了定时问候功能，并已发送一次问候。
问候将继续按照时间表进行。${nextScheduledTimeDisplay}`, true)
    } else {
      e.reply(`定时问候已开启，将根据时间表进行问候。
已发送一次问候。${nextScheduledTimeDisplay}`, true)
    }
    console.log(`[定时问候] 用户 ${userId} 已成功处理开启命令。`)
  }

  /**
   * 处理 #关闭定时问候 命令
   * @param {object} e 消息事件对象
   */
  async stopGreeting (e) {
    console.log('[定时问候] 收到关闭定时问候命令。')
    const userId = e.sender.user_id.toString()
    console.log(`[定时问候] 用户 ${userId} 发送 #关闭定时问候 命令。`)

    if (!this.isUserEnabled(userId)) {
      e.reply('您还没有开启定时问候功能', true)
      console.log(`[定时问候] 用户 ${userId} 未开启，跳过关闭操作。`)
      return
    }

    this.setUserStatus(userId, 'off')
    console.log(`[定时问候] 用户 ${userId} 已禁用定时问候。`)
    
    const enabledUsers = Object.values(this.userConfigs).filter(status => status === 'on')
    console.log(`[定时问候] 剩余开启用户数：${enabledUsers.length}`)
    
    if (enabledUsers.length === 0) {
      // 如果没有用户开启，停止全局定时器
      if (this.interval) {
        clearInterval(this.interval) // 清除定时器
        this.interval = null // 将定时器句柄设为null
        this.bot = null // 清除机器人实例
        console.log('[定时问候] 全局定时器已停止 - 无用户开启。')
      }
      // 清除本小时的具体问候调度
      if (this.scheduledTimeout) {
        clearTimeout(this.scheduledTimeout);
        this.scheduledTimeout = null;
        console.log('[定时问候] 清除了当前小时的问候调度。');
      }
      // 清空运行配置文件
      this.runConfig = {};
      this.saveRunConfig();
      console.log('[定时问候] greet_run.json 已清空。');
    } else {
      console.log('[定时问候] 全局定时器仍在运行，因为仍有其他用户开启。')
    }
    e.reply('定时问候已关闭', true) // 回复用户定时任务已关闭
    console.log(`[定时问候] 用户 ${userId} 的定时问候已成功关闭。`)
  }

  /**
   * 实际发送消息的辅助函数
   * @param {string} targetQQ 目标QQ号
   * @param {string} message 消息内容
   */
  async sendActualGreeting(targetQQ, message) {
    console.log(`[定时问候] 准备为QQ: ${targetQQ} 发送实际问候消息。`)

    if (!this.bot) {
      console.error("[定时问候] 机器人实例未设置，无法发送问候消息。")
      return
    }
    // 模拟一个事件对象 e，以符合 chat.js 中 abstractChat 方法的参数要求
    const dummyEvent = {
      isPrivate: true, // 标记为私聊消息
      user_id: targetQQ, // 消息发送者ID（这里是目标QQ）
      sender: { user_id: targetQQ, nickname: '定时问候用户' }, // 发送者信息
      msg: message, // 消息内容
      // 关键：重写 reply 方法，使其能够通过机器人实例发送私聊消息
      reply: async (msg, quote) => {
        console.log(`[定时问候] DummyEvent Reply 触发，准备通过bot.pickFriend().sendMsg发送至 ${targetQQ}。`)
        // 使用 this.bot.pickFriend(targetQQ).sendMsg(msg) 来发送私聊消息
        await this.bot.pickFriend(targetQQ).sendMsg(msg)
        console.log(`[定时问候] 已通过bot.pickFriend().sendMsg发送消息至 ${targetQQ}: ${msg}`)
      }
    }

    const chat = new chatgpt(dummyEvent) // 创建 chatgpt 实例
    chat.e = dummyEvent // 显式设置 chatgpt 实例的 e 属性，确保 chat.js 内部的 this.e 有效
    try {
      await chat.abstractChat(dummyEvent, message, 'gemini')
      console.log(`[定时问候] abstractChat 调用完成为 ${targetQQ}。`)
    } catch (error) {
      console.error(`[定时问候] 调用 abstractChat 为 ${targetQQ} 时出错:`, error)
    }
  }

  /**
   * 每小时调度问候任务 (在每个小时的00分触发)
   */
  async scheduleHourlyGreeting () {
    console.log('[定时问候] === 每小时调度任务触发开始 ===');
    if (!this.bot) {
        console.error("[定时问候] 机器人实例未设置，无法安排问候消息。");
        return;
    }

    const enabledUsers = Object.keys(this.userConfigs).filter(userId => this.userConfigs[userId] === 'on');
    if (enabledUsers.length === 0) {
      console.log('[定时问候] 没有用户开启，跳过问候安排。');
      this.runConfig = {}; // 清空运行配置
      this.saveRunConfig();
      if (this.scheduledTimeout) {
        clearTimeout(this.scheduledTimeout);
        this.scheduledTimeout = null;
      }
      console.log('[定时问候] === 每小时调度任务触发结束 ===');
      return;
    }

    const now = new Date();
    const currentHour = now.getHours();
    let shouldSend = false;
    let probability = 0;

    // 根据时间段确定概率
    // 9-20点（早上9点到晚上8点）：每小时有 35% 的概率发送问候。
    if (currentHour >= 9 && currentHour < 20) {
      probability = 0.35;
      shouldSend = Math.random() < probability;
      console.log(`[定时问候] 当前小时 ${currentHour} 处于 9-20点时间段，概率 ${probability * 100}%。`);
    }
    // 6-8点或者20-24点（早上6点到早上8点或晚上8点到凌晨12点）：每小时有 85% 的概率发送问候。
    else if ((currentHour >= 6 && currentHour < 8) || (currentHour >= 20 && currentHour < 24)) {
      probability = 0.85;
      shouldSend = Math.random() < probability;
      console.log(`[定时问候] 当前小时 ${currentHour} 处于 6-8点或20-24点时间段，概率 ${probability * 100}%。`);
    }
    // 0-6点（凌晨12点到早上6点）：每小时有 15% 的概率发送问候。
    else if (currentHour >= 0 && currentHour < 6) { 
      probability = 0.15;
      shouldSend = Math.random() < probability;
      console.log(`[定时问候] 当前小时 ${currentHour} 处于 0-6点时间段，概率 ${probability * 100}%。`);
    } else {
      console.log(`[定时问候] 当前小时 ${currentHour} 不在任何预设问候时间段内，不发送问候。`);
      shouldSend = false; // 默认不发送
    }

    // 生成随机分钟数（1-59），如果 shouldSend 为 true
    let randomMinute = shouldSend ? Math.floor(Math.random() * 59) + 1 : 0; 

    // 根据randomMinute计算实际的scheduledTime
    const scheduledTime = new Date();
    scheduledTime.setHours(currentHour);
    scheduledTime.setMinutes(randomMinute);
    scheduledTime.setSeconds(0);
    scheduledTime.setMilliseconds(0);

    // 存储调度决定到 greet_run.json (覆盖)
    this.runConfig = {
      timestamp: this.formatToUTCPlus8(now), // 保存为UTC+8时间
      randomMinute: randomMinute,
      shouldSend: shouldSend,
      hour: currentHour, // 该配置所对应的小时
      nextGreetingTime: shouldSend ? this.formatToUTCPlus8(scheduledTime) : null // 保存下一次问候时间为UTC+8
    };

    // 清除之前可能存在的本小时的问候调度
    if (this.scheduledTimeout) {
      clearTimeout(this.scheduledTimeout);
      this.scheduledTimeout = null;
      console.log('[定时问候] 清除了旧的问候调度。');
    }

    const delayMs = scheduledTime.getTime() - now.getTime();

    // 如果计划时间已在过去（或非常接近），或者不发送问候，则本小时跳过问候
    if (!shouldSend || delayMs <= 1000) { // 留1秒缓冲
        console.log(`[定时问候] 本小时不发送问候，或计划问候时间 (${scheduledTime.toLocaleTimeString('zh-CN')}) 已过或太近。`);
        this.runConfig.shouldSend = false; // 实际不发送
        this.runConfig.nextGreetingTime = null; // 不发送则清空
        this.addLogEntry({
            type: 'probabilityCheck',
            userId: 'global', 
            hour: currentHour,
            randomMinute: randomMinute,
            probability: probability,
            passed: false, // 明确记录为未通过调度
            scheduled: false, 
            currentTime: this.formatToUTCPlus8(now) // 保存为UTC+8时间
        });
        console.log('[定时问候] === 每小时调度任务触发结束 ===');
        this.saveRunConfig(); // 保存更新后的runConfig
        return; 
    }
    
    this.addLogEntry({ // 记录概率判断结果
        type: 'probabilityCheck',
        userId: 'global',
        hour: currentHour,
        randomMinute: randomMinute,
        probability: probability,
        passed: shouldSend,
        currentTime: this.formatToUTCPlus8(now) // 保存为UTC+8时间
    });

    console.log(`[定时问候] 已安排问候，预计发送时间：${scheduledTime.toLocaleTimeString('zh-CN')}。`);
    this.scheduledTimeout = setTimeout(async () => {
      console.log('[定时问候] 触发执行预定问候。');
      await this.executeScheduledGreeting();
      this.scheduledTimeout = null; // 执行后清除定时器句柄
    }, delayMs);

    this.saveRunConfig(); // 保存更新后的runConfig
    console.log('[定时问候] === 每小时调度任务触发结束 ===');
  }

  /**
   * 执行预定问候 (向所有已开启用户发送)
   */
  async executeScheduledGreeting() {
    console.log('[定时问候] 开始执行预定问候。');
    // 重新加载运行配置，确保使用最新状态
    this.loadRunConfig(); 

    // 额外检查 runConfig.nextGreetingTime 是否与当前时间大致匹配，防止旧的调度执行
    const now = new Date();
    let scheduledTimeFromConfig = null;
    if (this.runConfig.nextGreetingTime) {
        // 解析UTC+8时间字符串为Date对象
        scheduledTimeFromConfig = new Date(this.runConfig.nextGreetingTime);
    }

    const timeDiff = Math.abs(now.getTime() - (scheduledTimeFromConfig ? scheduledTimeFromConfig.getTime() : 0));
    // 允许10秒的误差，以应对setTimeout的微小延迟
    if (!this.runConfig.shouldSend || !this.bot || !scheduledTimeFromConfig || timeDiff > 10000) {
      console.log('[定时问候] 无问候计划、机器人实例未设置、或调度时间不匹配，跳过执行。');
      console.log(`[定时问候] Debug Info: shouldSend=${this.runConfig.shouldSend}, bot=${!!this.bot}, scheduledTimeFromConfig=${scheduledTimeFromConfig ? scheduledTimeFromConfig.toLocaleTimeString('zh-CN') : 'N/A'}, now=${now.toLocaleTimeString('zh-CN')}, timeDiff=${timeDiff}`);
      return;
    }

    const enabledUsers = Object.keys(this.userConfigs).filter(userId => this.userConfigs[userId] === 'on');
    if (enabledUsers.length === 0) {
      console.log('[定时问候] 没有用户开启，跳过执行预定问候。');
      return;
    }

    const nowForMessage = new Date();
    const currentTime = nowForMessage.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const greetingMessage = `【系统消息】现在的时间是：${currentTime}，接下来的情景是你要假扮在主动找我聊天，你可以像真人一样根据现在的时间日期（如果是特殊的日子特殊时间的话）和在做什么情况来主动给我发送消息，可以是问候之前的聊天内容，或者吐槽学习生活或工作，或者问候吃没吃饭自己吃的什么饭，或者早晚安，或者单纯的一句打招呼都可以，如果两次打招呼都没有被回复也可以问候一下对话人在做什么`;

    for (const userId of enabledUsers) {
      await this.sendActualGreeting(userId, greetingMessage);
      console.log(`[定时问候] 已向用户 ${userId} 发送预定问候。`);
      this.addLogEntry({ // 记录每次实际发送的问候
        type: 'greeting',
        action: 'scheduledGreetingSent',
        userId: userId,
        messageContent: greetingMessage,
        sentAt: this.formatToUTCPlus8(new Date()) // 保存为UTC+8时间
      });
    }
    console.log('[定时问候] 预定问候执行完毕。');
  }
}

