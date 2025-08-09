///root/TRSS_AllBot/TRSS-Yunzai/plugins/example/
import plugin from '../../lib/plugins/plugin.js'
import Core from '../chatgpt-plugin/model/core.js'

/**
 * 成员退群告别消息的 AI 提示词模板
 * {userId} - 退群成员QQ号
 * {groupName} - 群聊名称
 */
const FAREWELL_AI_PROMPT = `【system】成员(QQ:{userId})离开了群聊"{groupName}"，请生成一条合适的告别消息。要求：
一定要注意：不要发送表情包，不要使用定时命令。
如：xxxx退群了呢，前辈，期待下次相遇呢。之类的。
语气要得体，表达不舍但不强求
祝福TA未来发展
语气要温暖但不煽情
控制在20字以内。
不要发送表情包。
不要发送表情包。
不要发送表情包。
`

export class outNotice extends plugin {
  constructor () {
    super({
      name: '退群通知',
      dsc: 'xx退群了',
      event: 'notice.group.decrease',
      priority: 5000
    })

    /** 退群提示词 (使用Unicode转义避免乱码) */
    this.tips = '\u9000\u7fa4\u4e86' // "退群了"
  }

  async accept () {
    // 获取退群成员和群聊信息
    const userId = this.e.user_id;
    const groupName = this.e.group?.name || '本群';
    const groupId = this.e.group_id;

    let msg;
    try {
      // 构造AI提示词
      const aiPrompt = FAREWELL_AI_PROMPT
        .replace('{userId}', userId)
        .replace('{groupName}', groupName);

      // 使用原始事件对象调用AI，与入群欢迎插件保持一致
      const chatMessage = await Core.sendMessage(aiPrompt, {}, 'gemini', this.e);
      
      if (chatMessage && chatMessage.text) {
        msg = chatMessage.text;
      } else {
        throw new Error("AI未能生成有效的回复文本。");
      }
    } catch (error) {
      logger.error(`[退群通知] AI生成消息失败，将使用默认消息。错误: ${error}`);
      // AI调用失败时，回退到默认消息
      msg = `${userId} ${this.tips}`;
    }

    // 发送最终消息
    await this.reply(msg);
  }
}
