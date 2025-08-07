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
    // 防止重复实例化
    if (Greet.instance) {
      console.log('[定时问候] 检测到重复实例化，清理旧实例的定时器。');
      const oldInstance = Greet.instance;
      if (oldInstance.scanInterval) {
        clearInterval(oldInstance.scanInterval);
        oldInstance.scanInterval = null;
      }
      if (oldInstance.hourlyInterval) {
        clearInterval(oldInstance.hourlyInterval);
        oldInstance.hourlyInterval = null;
      }
      if (oldInstance.heartbeatInterval) {
        clearInterval(oldInstance.heartbeatInterval);
        oldInstance.heartbeatInterval = null;
      }
    }
    
    super({
      name: '定时问候', // 插件名称
      dsc: '定时向指定用户发送问候消息', // 插件描述
      event: 'message', // 监听消息事件
      /** 定时任务，留空表示无定时任务 */
      task: [],
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

    
    this.scanInterval = null // 用于存储 45秒扫描定时器的句柄
    this.hourlyInterval = null // 用于存储每小时更新定时器的句柄
    this.bot = null // 用于存储机器人实例，以便发送消息
    
    // 全局问候消息模板
    this.greetingMessageTemplate = `【system】现在的时间是：{currentTime}，触发了主动聊天事件。（这条消息不用发表情和定时命令）
      接下来的情景是你要假扮在主动找我聊天，你可以像真人一样根据现在的时间和在做什么情况来主动给我发送消息
      （如：熬夜的时间可以说是在加班，半夜的时间可以说是失眠或者起夜上厕所之类的）。
      可以是询问之前的聊天内容，或者吐槽学习生活或工作，或者问候吃没吃饭自己吃的什么饭，或者早晚安，或者单纯的一句打招呼都可以
      （你不知道对方在做什么的情况下，这次是你主动地问候一下，而不是对方找你）。
      如果上次的消息没有被回复一定要问一下对话人在做什么。
      尽量做到有感情色彩，按照多姿多彩的生活来问候。
      如果在和对话人的正常聊天的过程中触发了主动聊天，可以讲一些题外话（比如说：对了，上次xxxxxx）。`
    
    this.configFile = path.join(__dirname, 'greet_config.json') // 用户配置路径，保存在代码同目录
    this.userConfigs = {} // 用户配置缓存
    this.loadConfig() // 加载用户配置文件

    this.logFile = path.join(__dirname, 'greet_log.json') // 日志文件路径
    this.runConfigFile = path.join(__dirname, 'greet_run.json') // 运行配置（调度计划）文件路径
    this.runConfig = {} // 运行配置缓存
    this.loadRunConfig() // 加载运行配置文件

    // 添加心跳日志，每45秒输出一次证明程序正在运行
    this.heartbeatInterval = setInterval(() => {
      const enabledUsersCount = Object.values(this.userConfigs).filter(status => status === 'on').length;
      console.log(`[定时问候-心跳] ${new Date().toLocaleString('zh-CN')} | 运行状态: 正常 | 开启用户数: ${enabledUsersCount} | 扫描定时器: ${this.scanInterval ? '运行中' : '未启动'} | 每小时定时器: ${this.hourlyInterval ? '运行中' : '未启动'}`);
    }, 45000) // 每45秒执行一次

    // 绑定方法，确保 'this' 上下文正确
    this.startGreeting = this.startGreeting.bind(this);
    this.stopGreeting = this.stopGreeting.bind(this);
    this.sendActualGreeting = this.sendActualGreeting.bind(this);
    this.loadConfig = this.loadConfig.bind(this);
    this.saveConfig = this.saveConfig.bind(this);
    this.isUserEnabled = this.isUserEnabled.bind(this);
    this.setUserStatus = this.setUserStatus.bind(this);
    this.addLogEntry = this.addLogEntry.bind(this);
    this.loadRunConfig = this.loadRunConfig.bind(this);
    this.saveRunConfig = this.saveRunConfig.bind(this);
    this.scanAndExecuteGreeting = this.scanAndExecuteGreeting.bind(this); // 新的扫描执行方法
    this.generateNextHourGreetingTime = this.generateNextHourGreetingTime.bind(this); // 新的生成下个小时时间方法
    this.updateHourlyGreetingTime = this.updateHourlyGreetingTime.bind(this); // 新的每小时更新方法
    this.formatToUTCPlus8 = this.formatToUTCPlus8.bind(this);

    // 机器人启动时自动启动定时器系统
    this.initializeTimerSystem();
    
    // 设置单例实例引用
    Greet.instance = this;
  }

  /**
   * 初始化定时器系统
   */
  async initializeTimerSystem() {
    console.log('[定时问候] 机器人启动 - 自动初始化定时器系统。');
    
    // 立即生成本小时的问候计划
    await this.updateHourlyGreetingTime();

    // 启动每50秒的扫描定时器
    this.scanInterval = setInterval(async () => {
      await this.scanAndExecuteGreeting();
    }, 50000); // 每50秒执行一次
    console.log('[定时问候] 50秒扫描定时器已启动。');

    // 计算到下一个整点的时间
    const now = new Date();
    const nextFullHour = new Date(now);
    nextFullHour.setHours(now.getHours() + 1);
    nextFullHour.setMinutes(0);
    nextFullHour.setSeconds(0);
    nextFullHour.setMilliseconds(0);
    const initialDelay = nextFullHour.getTime() - now.getTime();

    console.log(`[定时问候] 首次每小时更新将在 ${nextFullHour.toLocaleString('zh-CN')} 进行（${Math.round(initialDelay / 1000)} 秒后）。`);

    // 设置首次每小时更新
    setTimeout(() => {
      console.log('[定时问候] 首次每小时更新触发。');
      this.updateHourlyGreetingTime();
      
      // 启动每小时的定时器
      this.hourlyInterval = setInterval(async () => {
        console.log('[定时问候] 每小时更新定时器触发。');
        await this.updateHourlyGreetingTime();
      }, 3600000); // 每小时执行一次
      console.log('[定时问候] 每小时更新定时器已启动。');
    }, initialDelay);
    
    console.log('[定时问候] 定时器系统初始化完成。');
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
        // 浓缩日志格式
        const timestamp = this.runConfig.timestamp || '未设置';
        const shouldSend = this.runConfig.shouldSend ? '是' : '否';
        const nextGreetingTime = this.runConfig.nextGreetingTime || '未设置';
        console.log(`=== 定时问候 ===\n运行时间：${timestamp} | 是否发送：${shouldSend} | 下次问候：${nextGreetingTime}`)
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
   * 生成下个小时的随机问候时间
   * @returns {Date} 下个小时的随机时间
   */
  generateNextHourGreetingTime() {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1);
    
    // 生成随机分钟数（1-59）
    const randomMinute = Math.floor(Math.random() * 59) + 1;
    nextHour.setMinutes(randomMinute);
    nextHour.setSeconds(0);
    nextHour.setMilliseconds(0);
    
    console.log(`[定时问候] 生成下个小时随机时间: ${nextHour.toLocaleString('zh-CN')}`);
    return nextHour;
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
   * 每50秒扫描并执行问候任务
   */
  async scanAndExecuteGreeting() {
    // 自动获取机器人实例（如果还没有的话）
    if (!this.bot) {
      try {
        // 尝试从全局获取机器人实例
        if (typeof Bot !== 'undefined' && Bot.uin) {
          this.bot = Bot;
          console.log('[定时问候] 自动获取到机器人实例。');
        } else {
          console.log('[定时问候] 机器人实例未就绪，跳过扫描。');
          return;
        }
      } catch (error) {
        console.log('[定时问候] 获取机器人实例失败，跳过扫描。');
        return;
      }
    }

    // 重新加载运行配置，确保使用最新状态
    this.loadRunConfig();
    
    if (!this.runConfig.shouldSend || !this.runConfig.nextGreetingTime) {
      console.log('[定时问候] 无问候计划或时间未设置，跳过扫描。');
      return;
    }

    const now = new Date();
    const scheduledTime = new Date(this.runConfig.nextGreetingTime);
    
    // 检查当前时间的分钟是否匹配
    if (now.getHours() === scheduledTime.getHours() && now.getMinutes() === scheduledTime.getMinutes()) {
      console.log(`[定时问候] 时间匹配！当前时间: ${now.toLocaleString('zh-CN')}, 计划时间: ${scheduledTime.toLocaleString('zh-CN')}`);
      
      // 执行问候
      await this.executeGreetingToAllUsers();
      
      // 立即更新为下个小时的随机时间
      const nextGreetingTime = this.generateNextHourGreetingTime();
      this.runConfig.nextGreetingTime = this.formatToUTCPlus8(nextGreetingTime);
      this.runConfig.timestamp = this.formatToUTCPlus8(now);
      this.runConfig.hour = nextGreetingTime.getHours();
      this.runConfig.randomMinute = nextGreetingTime.getMinutes();
      this.saveRunConfig();
      
      console.log(`[定时问候] 已更新下次问候时间为: ${nextGreetingTime.toLocaleString('zh-CN')}`);
    }
  }

  /**
   * 向所有开启用户执行问候
   */
  async executeGreetingToAllUsers() {
    console.log('[定时问候] 开始向所有用户发送问候。');
    
    const enabledUsers = Object.keys(this.userConfigs).filter(userId => this.userConfigs[userId] === 'on');
    if (enabledUsers.length === 0) {
      console.log('[定时问候] 没有用户开启，跳过问候发送。');
      return;
    }

    const nowForMessage = new Date();
    const currentTime = nowForMessage.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const greetingMessage = this.greetingMessageTemplate.replace('{currentTime}', currentTime);
    for (const userId of enabledUsers) {
      await this.sendActualGreeting(userId, greetingMessage);
      console.log(`[定时问候] 已向用户 ${userId} 发送定时问候。`);
      this.addLogEntry({
        type: 'greeting',
        action: 'scheduledGreetingSent',
        userId: userId,
        messageContent: greetingMessage,
        sentAt: this.formatToUTCPlus8(new Date())
      });
    }
    console.log('[定时问候] 所有用户问候发送完毕。');
  }

  /**
   * 每小时更新问候时间（概率判断）
   */
  async updateHourlyGreetingTime() {
    console.log('[定时问候] === 每小时更新任务开始 ===');
    
    const now = new Date();
    const currentHour = now.getHours();
    let shouldSend = false;
    let probability = 0;

    // 根据时间段确定概率
    if (currentHour >= 9 && currentHour < 20) {
      probability = 0.35;
      shouldSend = Math.random() < probability;
      console.log(`[定时问候] 当前小时 ${currentHour} 处于 9-20点时间段，概率 ${probability * 100}%。`);
    }
    else if ((currentHour >= 6 && currentHour < 8) || (currentHour >= 20 && currentHour < 24)) {
      probability = 0.85;
      shouldSend = Math.random() < probability;
      console.log(`[定时问候] 当前小时 ${currentHour} 处于 6-8点或20-24点时间段，概率 ${probability * 100}%。`);
    }
    else if (currentHour >= 0 && currentHour < 6) { 
      probability = 0.15;
      shouldSend = Math.random() < probability;
      console.log(`[定时问候] 当前小时 ${currentHour} 处于 0-6点时间段，概率 ${probability * 100}%。`);
    } else {
      console.log(`[定时问候] 当前小时 ${currentHour} 不在任何预设问候时间段内，不发送问候。`);
      shouldSend = false;
    }

    // 生成这个小时的随机分钟数
    let randomMinute = shouldSend ? Math.floor(Math.random() * 59) + 1 : 0;
    
    const scheduledTime = new Date();
    scheduledTime.setHours(currentHour);
    scheduledTime.setMinutes(randomMinute);
    scheduledTime.setSeconds(0);
    scheduledTime.setMilliseconds(0);

    // 如果计划时间已经过去，则安排到下一个小时
    if (scheduledTime.getTime() <= now.getTime()) {
      scheduledTime.setHours(currentHour + 1);
      console.log(`[定时问候] 原定时间已过，调整到下一小时：${scheduledTime.toLocaleString('zh-CN')}`);
    }

    // 更新运行配置
    this.runConfig = {
      timestamp: this.formatToUTCPlus8(now),
      randomMinute: scheduledTime.getMinutes(),
      shouldSend: shouldSend,
      hour: scheduledTime.getHours(),
      nextGreetingTime: shouldSend ? this.formatToUTCPlus8(scheduledTime) : null
    };

    this.addLogEntry({
      type: 'probabilityCheck',
      userId: 'global',
      hour: currentHour,
      randomMinute: randomMinute,
      probability: probability,
      passed: shouldSend,
      scheduled: shouldSend,
      currentTime: this.formatToUTCPlus8(now)
    });

    this.saveRunConfig();
    console.log(`[定时问候] 本小时问候计划: ${shouldSend ? `将在 ${scheduledTime.toLocaleString('zh-CN')} 发送问候` : '不发送问候'}`);
    console.log('[定时问候] === 每小时更新任务结束 ===');
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
    this.bot = e.bot // 更新机器人实例
    const wasEnabled = this.isUserEnabled(userId);

    // 设置用户状态为开启
    this.setUserStatus(userId, 'on')
    console.log(`[定时问候] 用户 ${userId} 发送 #开启定时问候 命令。`)

    // 立即为当前发送命令的用户发送一条问候 (无视其他条件) - 已注释
    // const nowForMessage = new Date()
    // const currentTime = nowForMessage.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    // const greetingMessage = this.greetingMessageTemplate.replace('{currentTime}', currentTime);
    // await this.sendActualGreeting(userId, greetingMessage)
    // console.log(`[定时问候] 已向用户 ${userId} 立即发送问候 (通过 startGreeting 命令触发)。`)
    // this.addLogEntry({
    //   type: 'greeting',
    //   action: 'immediateGreeting',
    //   userId: userId,
    //   messageContent: greetingMessage,
    //   sentAt: this.formatToUTCPlus8(new Date()) // 保存为UTC+8时间
    // })

    // 显示下次问候时间
    let nextScheduledTimeDisplay = "下次问候时间将根据每小时随机确定";
    this.loadRunConfig(); // 确保加载最新配置
    if (this.runConfig.shouldSend && this.runConfig.nextGreetingTime) {
        const scheduledDate = new Date(this.runConfig.nextGreetingTime);
        nextScheduledTimeDisplay = `下次问候预计时间为：${scheduledDate.toLocaleString('zh-CN')}。`;
    }

    if (wasEnabled) {
      e.reply(`您已经开启了定时问候功能。`, true)
    } else {
      e.reply(`定时问候已开启`, true)
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
    
    // 注意：定时器系统保持运行，只是不会给关闭的用户发送消息
    // 如果需要完全停止系统，可以取消下面的注释
    // if (enabledUsers.length === 0) {
    //   // 如果没有用户开启，停止所有定时器
    //   if (this.scanInterval) {
    //     clearInterval(this.scanInterval);
    //     this.scanInterval = null;
    //     console.log('[定时问候] 50秒扫描定时器已停止。');
    //   }
    //   if (this.hourlyInterval) {
    //     clearInterval(this.hourlyInterval);
    //     this.hourlyInterval = null;
    //     console.log('[定时问候] 每小时更新定时器已停止。');
    //   }
    //   // 清除心跳定时器
    //   if (this.heartbeatInterval) {
    //     clearInterval(this.heartbeatInterval);
    //     this.heartbeatInterval = null;
    //     console.log('[定时问候] 清除了心跳日志定时器。');
    //   }
    //   this.bot = null // 清除机器人实例
    //   // 清空运行配置文件
    //   this.runConfig = {};
    //   this.saveRunConfig();
    //   console.log('[定时问候] greet_run.json 已清空。');
    // } else {
    //   console.log('[定时问候] 定时器系统仍在运行，因为仍有其他用户开启。')
    // }
    
    console.log('[定时问候] 定时器系统继续运行，但不会向您发送问候。');
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

}

export default Greet

