import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config } from './utils/config.js'

// 获取当前插件目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginName = path.basename(__dirname)

// 兼容性处理：如果没有全局 logger，创建一个简单的 logger
if (typeof global.logger === 'undefined') {
  global.logger = {
    info: console.log,
    error: console.error,
    debug: console.log,
    warn: console.warn,
    red: (str) => str
  }
}

// 确保 logger.red 函数存在
if (typeof logger.red !== 'function') {
  logger.red = (str) => str
}

logger.info('**************************************')
logger.info(`${pluginName} 插件加载中...`)

// 确保 segment 全局可用
if (!global.segment) {
  try {
    global.segment = (await import('icqq')).segment
  } catch (err) {
    try {
      global.segment = (await import('oicq')).segment
    } catch (e) {
      logger.error('无法加载 segment，请检查 Yunzai 版本')
    }
  }
}

// 动态加载 apps 目录下的功能模块
const appsDir = path.join(__dirname, 'apps')
const files = fs.readdirSync(appsDir).filter(file => file.endsWith('.js'))

let ret = []

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')
  if (ret[i].status !== 'fulfilled') {
    logger.error(`载入插件错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

// 全局插件对象
global.pluginTemplate = {
  apps,
  config: Config
}

logger.info(`${pluginName} 插件加载成功`)
logger.info(`当前版本 v${Config.version}`)
logger.info('**************************************')

export { apps }
