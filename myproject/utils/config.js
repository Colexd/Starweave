import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 插件根目录
const pluginRoot = path.resolve(__dirname, '..')

// 兼容性处理：如果没有全局 logger，创建一个简单的 logger
if (typeof global.logger === 'undefined') {
  global.logger = {
    info: console.log,
    error: console.error,
    debug: console.log,
    warn: console.warn
  }
}

// 默认配置
const defaultConfig = {
  // 基础配置
  enable: true,
  pluginName: 'Yunzai插件模板',
  version: '1.0.0',
  debug: false,
  
  // 功能配置
  allowGroups: [], // 允许使用的群组，为空则所有群组都可以使用
  allowUsers: [],  // 允许使用的用户，为空则所有用户都可以使用
  
  // 其他配置
  cooldown: 5000, // 命令冷却时间（毫秒）
  maxRetries: 3   // 最大重试次数
}

/**
 * 配置管理类
 */
class ConfigManager {
  constructor() {
    this.configPath = path.join(pluginRoot, 'config', 'config.json')
    this.config = { ...defaultConfig }
    this.loadConfig()
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8')
        const userConfig = JSON.parse(configData)
        this.config = { ...defaultConfig, ...userConfig }
      } else {
        this.saveConfig()
      }
    } catch (err) {
      logger.error('加载配置文件失败，使用默认配置', err)
      this.config = { ...defaultConfig }
    }
  }

  /**
   * 保存配置文件
   */
  saveConfig() {
    try {
      const configDir = path.dirname(this.configPath)
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true })
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8')
    } catch (err) {
      logger.error('保存配置文件失败', err)
    }
  }

  /**
   * 获取配置项
   * @param {string} key - 配置键
   * @param {any} defaultValue - 默认值
   * @returns {any} 配置值
   */
  get(key, defaultValue = null) {
    return this.config[key] ?? defaultValue
  }

  /**
   * 设置配置项
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   */
  set(key, value) {
    this.config[key] = value
    this.saveConfig()
  }

  /**
   * 更新配置
   * @param {object} newConfig - 新配置
   */
  update(newConfig) {
    this.config = { ...this.config, ...newConfig }
    this.saveConfig()
  }

  /**
   * 重置配置
   */
  reset() {
    this.config = { ...defaultConfig }
    this.saveConfig()
  }

  /**
   * 检查权限
   * @param {object} e - 消息事件对象
   * @returns {boolean} 是否有权限
   */
  checkPermission(e) {
    // 检查群组权限
    if (e.group_id && this.config.allowGroups.length > 0) {
      if (!this.config.allowGroups.includes(e.group_id)) {
        return false
      }
    }

    // 检查用户权限
    if (this.config.allowUsers.length > 0) {
      if (!this.config.allowUsers.includes(e.user_id)) {
        return false
      }
    }

    return true
  }
}

// 创建全局配置实例
const configManager = new ConfigManager()

// 使用 Proxy 让配置可以直接访问
export const Config = new Proxy(configManager.config, {
  get(target, prop) {
    if (typeof configManager[prop] === 'function') {
      return configManager[prop].bind(configManager)
    }
    return configManager.get(prop)
  },
  set(target, prop, value) {
    configManager.set(prop, value)
    return true
  }
})

export default Config
