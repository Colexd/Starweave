/**
 * 基础数据模型类
 */
export class BaseModel {
  constructor(data = {}) {
    this.data = { ...data }
    this.createTime = new Date()
    this.updateTime = new Date()
  }

  /**
   * 获取数据
   * @param {string} key - 键名
   * @param {any} defaultValue - 默认值
   * @returns {any} 数据值
   */
  get(key, defaultValue = null) {
    return this.data[key] ?? defaultValue
  }

  /**
   * 设置数据
   * @param {string} key - 键名
   * @param {any} value - 数据值
   */
  set(key, value) {
    this.data[key] = value
    this.updateTime = new Date()
  }

  /**
   * 更新数据
   * @param {object} newData - 新数据
   */
  update(newData) {
    this.data = { ...this.data, ...newData }
    this.updateTime = new Date()
  }

  /**
   * 转换为普通对象
   * @returns {object} 普通对象
   */
  toObject() {
    return {
      ...this.data,
      createTime: this.createTime,
      updateTime: this.updateTime
    }
  }

  /**
   * 转换为JSON字符串
   * @returns {string} JSON字符串
   */
  toJSON() {
    return JSON.stringify(this.toObject())
  }
}

/**
 * 用户数据模型
 */
export class UserModel extends BaseModel {
  constructor(userId, data = {}) {
    super(data)
    this.userId = userId
    this.data.userId = userId
  }

  /**
   * 获取用户ID
   * @returns {string} 用户ID
   */
  getUserId() {
    return this.userId
  }

  /**
   * 设置用户昵称
   * @param {string} nickname - 昵称
   */
  setNickname(nickname) {
    this.set('nickname', nickname)
  }

  /**
   * 获取用户昵称
   * @returns {string} 昵称
   */
  getNickname() {
    return this.get('nickname', '')
  }
}

/**
 * 消息数据模型
 */
export class MessageModel extends BaseModel {
  constructor(messageId, data = {}) {
    super(data)
    this.messageId = messageId
    this.data.messageId = messageId
  }

  /**
   * 获取消息ID
   * @returns {string} 消息ID
   */
  getMessageId() {
    return this.messageId
  }

  /**
   * 设置消息内容
   * @param {string} content - 消息内容
   */
  setContent(content) {
    this.set('content', content)
  }

  /**
   * 获取消息内容
   * @returns {string} 消息内容
   */
  getContent() {
    return this.get('content', '')
  }

  /**
   * 设置发送者
   * @param {string} senderId - 发送者ID
   */
  setSender(senderId) {
    this.set('senderId', senderId)
  }

  /**
   * 获取发送者
   * @returns {string} 发送者ID
   */
  getSender() {
    return this.get('senderId', '')
  }
}

export default {
  BaseModel,
  UserModel,
  MessageModel
}
