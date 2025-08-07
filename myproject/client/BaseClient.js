/**
 * 基础客户端类
 * 所有API客户端都应该继承自此类
 */
export class BaseClient {
  constructor(options = {}) {
    this.options = {
      timeout: 30000,
      retries: 3,
      ...options
    }
    this.name = this.constructor.name
  }

  /**
   * 发送请求的通用方法
   * @param {object} params - 请求参数
   * @returns {Promise<any>} 响应结果
   */
  async request(params) {
    throw new Error(`${this.name}: request method must be implemented`)
  }

  /**
   * 处理错误
   * @param {Error} error - 错误对象
   * @returns {Error} 处理后的错误
   */
  handleError(error) {
    logger.error(`${this.name} Error:`, error)
    return error
  }

  /**
   * 重试逻辑
   * @param {Function} fn - 要重试的函数
   * @param {number} retries - 重试次数
   * @returns {Promise<any>} 结果
   */
  async retry(fn, retries = this.options.retries) {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn()
      } catch (error) {
        if (i === retries) {
          throw this.handleError(error)
        }
        logger.debug(`${this.name}: Retry ${i + 1}/${retries}`)
        await this.sleep(1000 * (i + 1)) // 递增延迟
      }
    }
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟毫秒数
   * @returns {Promise} Promise对象
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 验证参数
   * @param {object} params - 参数对象
   * @param {Array<string>} required - 必需参数列表
   */
  validateParams(params, required = []) {
    for (const key of required) {
      if (!(key in params) || params[key] === undefined || params[key] === null) {
        throw new Error(`${this.name}: Missing required parameter: ${key}`)
      }
    }
  }

  /**
   * 格式化响应
   * @param {any} response - 原始响应
   * @returns {object} 格式化后的响应
   */
  formatResponse(response) {
    return {
      success: true,
      data: response,
      timestamp: Date.now(),
      client: this.name
    }
  }

  /**
   * 格式化错误响应
   * @param {Error} error - 错误对象
   * @returns {object} 格式化后的错误响应
   */
  formatError(error) {
    return {
      success: false,
      error: error.message,
      timestamp: Date.now(),
      client: this.name
    }
  }
}

/**
 * HTTP 客户端类
 */
export class HttpClient extends BaseClient {
  constructor(options = {}) {
    super(options)
    this.baseURL = options.baseURL || ''
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Yunzai-Plugin-Template/1.0.0',
      ...options.headers
    }
  }

  /**
   * 发送 HTTP 请求
   * @param {object} params - 请求参数
   * @returns {Promise<any>} 响应结果
   */
  async request(params) {
    const { method = 'GET', url, data, headers = {} } = params
    
    try {
      const response = await fetch(this.baseURL + url, {
        method,
        headers: { ...this.headers, ...headers },
        body: data ? JSON.stringify(data) : undefined,
        timeout: this.options.timeout
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      return this.formatResponse(result)
    } catch (error) {
      return this.formatError(error)
    }
  }

  /**
   * GET 请求
   * @param {string} url - 请求URL
   * @param {object} headers - 请求头
   * @returns {Promise<any>} 响应结果
   */
  async get(url, headers = {}) {
    return this.request({ method: 'GET', url, headers })
  }

  /**
   * POST 请求
   * @param {string} url - 请求URL
   * @param {object} data - 请求数据
   * @param {object} headers - 请求头
   * @returns {Promise<any>} 响应结果
   */
  async post(url, data, headers = {}) {
    return this.request({ method: 'POST', url, data, headers })
  }

  /**
   * PUT 请求
   * @param {string} url - 请求URL
   * @param {object} data - 请求数据
   * @param {object} headers - 请求头
   * @returns {Promise<any>} 响应结果
   */
  async put(url, data, headers = {}) {
    return this.request({ method: 'PUT', url, data, headers })
  }

  /**
   * DELETE 请求
   * @param {string} url - 请求URL
   * @param {object} headers - 请求头
   * @returns {Promise<any>} 响应结果
   */
  async delete(url, headers = {}) {
    return this.request({ method: 'DELETE', url, headers })
  }
}

export default {
  BaseClient,
  HttpClient
}
