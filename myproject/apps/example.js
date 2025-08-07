import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { render } from '../utils/common.js'

export class ExampleApp extends plugin {
  constructor() {
    super({
      name: '示例功能',
      dsc: '插件模板示例功能',
      event: 'message',
      priority: 5000,
      /** 定时任务，留空表示无定时任务 */
      task: [],
      rule: [
        {
          reg: '^#?(插件|plugin)?(测试|test)$',
          fnc: 'test'
        },
        {
          reg: '^#?(插件|plugin)?(帮助|help)$',
          fnc: 'help'
        }
      ]
    })
  }

  /**
   * 测试功能
   * @param {object} e - 消息事件对象
   */
  async test(e) {
    if (!Config.enable) {
      await this.reply('插件未启用，请联系管理员开启')
      return false
    }

    const msg = [
      '🎉 插件模板测试成功！',
      `📱 插件名称：${Config.pluginName || 'Yunzai插件模板'}`,
      `🔧 版本：v${Config.version}`,
      `👤 用户：${e.user_id}`,
      `💬 群组：${e.group_id || '私聊'}`,
      `⏰ 时间：${new Date().toLocaleString()}`
    ]

    await this.reply(msg.join('\n'))
    return true
  }

  /**
   * 帮助功能
   * @param {object} e - 消息事件对象
   */
  async help(e) {
    const helpData = {
      pluginName: Config.pluginName || 'Yunzai插件模板',
      version: Config.version,
      commands: [
        {
          name: '#插件测试',
          desc: '测试插件是否正常运行'
        },
        {
          name: '#插件帮助',
          desc: '显示插件帮助信息'
        }
      ]
    }

    try {
      // 尝试渲染帮助图片
      const img = await render('help', 'help', helpData)
      if (img) {
        await this.reply(img)
      } else {
        // 降级到文本帮助
        await this.textHelp(helpData)
      }
    } catch (err) {
      logger.debug('渲染帮助图片失败，使用文本帮助', err)
      await this.textHelp(helpData)
    }

    return true
  }

  /**
   * 文本帮助
   * @param {object} data - 帮助数据
   */
  async textHelp(data) {
    const msg = [
      `📖 ${data.pluginName} 帮助`,
      `版本：v${data.version}`,
      '',
      '命令列表：'
    ]

    data.commands.forEach(cmd => {
      msg.push(`${cmd.name} - ${cmd.desc}`)
    })

    await this.reply(msg.join('\n'))
  }
}
