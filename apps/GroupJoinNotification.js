///root/TRSS_AllBot/TRSS-Yunzai/plugins/example/
import plugin from '../../lib/plugins/plugin.js'
import Core from '../chatgpt-plugin/model/core.js'

/**
 * 新人入群欢迎消息的 AI 提示词模板
 * {memberName} - 新成员显示名称
 * {userId} - 新成员QQ号
 * {groupName} - 群聊名称
 */
const WELCOME_AI_PROMPT = `【system】有新人{memberName}(QQ:{userId})加入了群聊"{groupName}"，请生成一条热情友好的欢迎消息。要求：
一定要注意：不要发送表情包，不要使用定时命令。
热情欢迎新成员
简单介绍群聊氛围
鼓励新成员互动
语气要亲切自然，不要太正式
控制在20字以内。
例如：引航者，很高兴你加入我们！这里是卡拉彼丘的世界，大家都很期待和你一起探索呢。
欢迎前辈入群~
不要发送表情包。
`

export class newcomer extends plugin {
  constructor () {
    super({
		/** 插件名字 */
      name: '欢迎新人',
	  /** 插件描述 */
      dsc: '新人入群欢迎',
      /** https://oicqjs.github.io/oicq/#events */
	  /** 插件触发事件 */
      event: 'notice.group.increase',
      priority: 5000
    })
  }

  /** 接受到消息都会执行一次 */
  async accept () {
    /** 冷却cd 1s */
    let cd = 1

    /** cd */
    let key = `Yz:newcomers:${this.e.group_id}`
    if (await redis.get(key)) return
    redis.set(key, '1', { EX: cd })

    try {
      // 获取新成员信息
      const memberName = this.e.member?.card || this.e.member?.nickname || '新成员'
      const userId = this.e.user_id
      const groupName = this.e.group?.name || '群聊'

      // 构造AI提示词
      const aiPrompt = WELCOME_AI_PROMPT
        .replace('{memberName}', memberName)
        .replace('{userId}', userId)
        .replace('{groupName}', groupName)

      // 调用AI生成欢迎消息
      const chatMessage = await Core.sendMessage(aiPrompt, {}, 'gemini', this.e)
      
      let welcomeMsg = '欢迎新人~~~~~~' // 默认消息
      if (chatMessage && chatMessage.text) {
        welcomeMsg = chatMessage.text
      }

      /** 回复，@新成员并发送AI生成的欢迎消息 */
      await this.reply([
        segment.at(this.e.user_id),
        ' ',
        welcomeMsg
      ])

      logger.info(`[入群欢迎] 向 ${memberName}(${userId}) 发送了AI生成的欢迎消息`)
    } catch (error) {
      logger.error(`[入群欢迎] AI生成消息失败: ${error}`)
      // 失败时发送默认消息
      await this.reply([
        segment.at(this.e.user_id),
        ' 欢迎新人~~~~~~'
      ])
    }
  }
}
