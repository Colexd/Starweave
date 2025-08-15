import crypto from 'crypto'
import * as GoogleGeminiClientModule from './GoogleGeminiClient.js'
import { newFetch } from '../utils/proxy.js'
import _ from 'lodash'
import { Config } from '../utils/config.js'

const BASEURL = 'https://generativelanguage.googleapis.com'

export const HarmCategory = {
  HARM_CATEGORY_UNSPECIFIED: 'HARM_CATEGORY_UNSPECIFIED',
  HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  HARM_CATEGORY_CIVIC_INTEGRITY: 'HARM_CATEGORY_CIVIC_INTEGRITY'
}

export const HarmBlockThreshold = {
  HARM_BLOCK_THRESHOLD_UNSPECIFIED: 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
  BLOCK_LOW_AND_ABOVE: 'BLOCK_LOW_AND_ABOVE',
  BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
  BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
  BLOCK_NONE: 'BLOCK_NONE',
  OFF: 'OFF'
}

/**
 * @typedef {{
 *   role: string,
 *   parts: Array<{
 *     text?: string,
 *     functionCall?: FunctionCall,
 *     functionResponse?: FunctionResponse,
 *     executableCode?: {
 *       language: string,
 *       code: string
 *     },
 *     codeExecutionResult?: {
 *       outcome: string,
 *       output: string
 *     }
 *   }>
 * }} Content
 *
 * Gemini消息的基本格式
 */

/**
 * @typedef {{
 *   searchEntryPoint: {
 *     renderedContent: string,
 *   },
 *   groundingChunks: Array<{
 *     web: {
 *       uri: string,
 *       title: string
 *     }
 *   }>,
 *   webSearchQueries: Array<string>
 * }} GroundingMetadata
 * 搜索结果的元数据
 */

/**
 * @typedef {{
 *    name: string,
 *    args: {}
 * }} FunctionCall
 *
 * Gemini的FunctionCall
 */

/**
 * @typedef {{
 *   name: string,
 *   response: {
 *     name: string,
 *     content: {}
 *   }
 * }} FunctionResponse
 *
 * Gemini的Function执行结果包裹
 * 其中response可以为任意，本项目根据官方示例封装为name和content两个字段
 */

export class CustomGoogleGeminiClient extends GoogleGeminiClientModule.GoogleGeminiClient {
  constructor (props) {
    super(props)
    this.model = props.model
    this.baseUrl = props.baseUrl || BASEURL
    this.supportFunction = true
    this.debug = props.debug
  }

  /**
   *
   * @param text
   * @param {{
   *     conversationId: string?,
   *     parentMessageId: string?,
   *     stream: boolean?,
   *     onProgress: function?,
   *     functionResponse?: FunctionResponse | FunctionResponse[],
   *     system: string?,
   *     image: string?,
   *     maxOutputTokens: number?,
   *     temperature: number?,
   *     topP: number?,
   *     tokK: number?,
   *     replyPureTextCallback: Function,
   *     toolMode: 'AUTO' | 'ANY' | 'NONE'
   *     search: boolean,
   *     codeExecution: boolean,
   * }} opt
   * @param {number} retryTime 重试次数
   * @returns {Promise<{conversationId: string?, parentMessageId: string, text: string, id: string}>}
   */
  async sendMessage (text, opt = {}) {
    const maxRetries = Config.gemini?.retries ?? 3;
    const requestTimeout = 120000; // 从配置读取超时，默认120秒
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.attemptSendMessage(text, opt, requestTimeout);
      } catch (error) {
        lastError = error;
        // 只对网络超时和5xx系列错误进行重试
        if (error.name === 'AbortError' || (error.message && error.message.startsWith('API请求失败: 5'))) {
          logger.warn(`[Gemini Client] 第 ${attempt} 次请求失败 (超时或服务器错误): ${error.message}`);
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 指数退避
            logger.info(`[Gemini Client] 将在 ${delay / 1000} 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } else {
          // 对于其他错误（如4xx客户端错误），不重试，直接抛出
          throw lastError;
        }
      }
    }

    logger.error(`[Gemini Client] 所有 ${maxRetries} 次重试均失败。`);
    throw lastError;
  }

  async attemptSendMessage(text, opt = {}, timeout) {
    let history = await this.getHistory(opt.parentMessageId)
    let systemMessage = opt.system

    // 增强的诊断日志
    try {
      const diagnosticInfo = {
        model: this.model,
        hasImage: !!opt.image,
        hasAudio: !!(opt.audio && opt.audio.data),
        historyLength: history.length,
        promptLength: text?.length || 0,
      };
      if (opt.image) {
        diagnosticInfo.imageSize = opt.image.length;
      }
      if (opt.audio && opt.audio.data) {
        diagnosticInfo.audioSize = opt.audio.data.length;
      }
      // logger.info(`[Gemini Client] 发送Gemini请求。详情: ${JSON.stringify(diagnosticInfo)}`);
    } catch (logError) {
      logger.warn(`[Gemini Client] 记录诊断日志时出错: ${logError.message}`);
    }

    const idThis = crypto.randomUUID()
    const idModel = crypto.randomUUID()
    if (opt.functionResponse && !typeof Array.isArray(opt.functionResponse)) {
      opt.functionResponse = [opt.functionResponse]
    }
    const thisMessage = opt.functionResponse?.length > 0
      ? {
          role: 'user',
          parts: opt.functionResponse.map(i => {
            return {
              functionResponse: i
            }
          }),
          id: idThis,
          parentMessageId: opt.parentMessageId || undefined
        }
      : {
          role: 'user',
          parts: text ? [{ text }] : [],
          id: idThis,
          parentMessageId: opt.parentMessageId || undefined
        }
    if (opt.image) {
      thisMessage.parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: opt.image
        }
      })
    }
    if (opt.audio && opt.audio.data) {
      thisMessage.parts.push({
        inline_data: {
          mime_type: opt.audio.mimeType || 'audio/amr',
          data: opt.audio.data
        }
      });
    }
    history.push(_.cloneDeep(thisMessage))
    let url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent`
    let body = {
      contents: history,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ],
      generationConfig: {
        maxOutputTokens: opt.maxOutputTokens || 4096,
        temperature: opt.temperature || 0.9,
        topP: opt.topP || 0.95,
        topK: opt.tokK || 16
      },
      tools: []
    }
    if (systemMessage) {
      body.system_instruction = {
        parts: {
          text: systemMessage
        }
      }
    }
    if (this.tools?.length > 0) {
      body.tools.push({
        function_declarations: this.tools.map(tool => tool.function())
      })
      let mode = opt.toolMode || 'AUTO'
      let lastFuncName = (opt.functionResponse)?.map(rsp => rsp.name)
      const mustSendNextTurn = [
        'searchImage', 'searchMusic', 'searchVideo'
      ]
      if (lastFuncName && lastFuncName?.find(name => mustSendNextTurn.includes(name))) {
        mode = 'ANY'
      }
      delete opt.toolMode
      body.tool_config = {
        function_calling_config: {
          mode
        }
      }
    }
    if (opt.search) {
      body.tools.push({ google_search: {} })
    }
    if (opt.codeExecution) {
      body.tools.push({ code_execution: {} })
    }
    if (opt.image) {
      delete body.tools
    }
    body.contents.forEach(content => {
      delete content.id
      delete content.parentMessageId
      delete content.conversationId
    })
    if (this.debug) {
      console.debug(JSON.stringify(body))
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let result
    try {
      result = await newFetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'x-goog-api-key': this._key
        },
        signal: controller.signal
      })
    } catch (error) {
      if (error.name === 'AbortError') {
        // 清理定时器后抛出特定错误
        clearTimeout(timeoutId);
        throw new Error('API请求超时');
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
    
    if (result.status !== 200) {
      const errorText = await result.text()
      console.error(`[Gemini] API请求失败，状态码: ${result.status}, 错误信息: ${errorText}`)
      // 抛出包含状态码的错误，以便重试逻辑可以捕获
      throw new Error(`API请求失败: ${result.status} - ${errorText}`)
    }
    
    let response
    try {
      response = await result.json()
    } catch (parseError) {
      console.error(`[Gemini] JSON解析失败: ${parseError.message}`)
      throw new Error(`JSON解析失败: ${parseError.message}`)
    }
    
    let responseContent
    
    if (this.debug) {
      console.log(JSON.stringify(response))
    }
    
    if (!response || !response.candidates || !Array.isArray(response.candidates) || response.candidates.length === 0) {
      throw new Error(`API返回无效响应: ${JSON.stringify(response)}`)
    }
    
    responseContent = response.candidates[0].content
    let groundingMetadata = response.candidates[0].groundingMetadata
    
    if (!responseContent) {
      // 如果响应中没有内容，也视为一种可重试的错误
      if (response.candidates[0].finishReason === 'SAFETY') {
         throw new Error(`API返回内容被安全策略拦截: ${JSON.stringify(response.candidates[0])}`);
      }
      throw new Error(`API返回的content为空: ${JSON.stringify(response.candidates[0])}`)
    }
    
    if (response.candidates[0].finishReason === 'MALFORMED_FUNCTION_CALL') {
      console.warn('遇到MALFORMED_FUNCTION_CALL，将由重试机制处理。')
      throw new Error('MALFORMED_FUNCTION_CALL');
    }

    if (responseContent.parts && responseContent.parts.filter(i => i.functionCall).length > 0) {
      const functionCall = responseContent.parts.filter(i => i.functionCall).map(i => i.functionCall)
      const text = responseContent.parts.find(i => i.text)?.text
      if (text && text.trim()) {
        console.info('send message: ' + text.trim())
        opt.replyPureTextCallback && await opt.replyPureTextCallback(text.trim())
      }
      let fcResults = []
      for (let fc of functionCall) {
        console.info(JSON.stringify(fc))
        const funcName = fc.name
        let chosenTool = this.tools.find(t => t.name === funcName)
        let functionResponse = {
          name: funcName,
          response: {
            name: funcName,
            content: null
          }
        }
        if (!chosenTool) {
          functionResponse.response.content = {
            error: `Function ${funcName} doesn't exist`
          }
        } else {
          try {
            let isAdmin = ['admin', 'owner'].includes(this.e.sender.role) || (this.e.group?.is_admin && this.e.isMaster)
            let isOwner = ['owner'].includes(this.e.sender.role) || (this.e.group?.is_owner && this.e.isMaster)
            let args = Object.assign(fc.args, {
              isAdmin,
              isOwner,
              sender: this.e.sender.user_id,
              mode: 'gemini'
            })
            functionResponse.response.content = await chosenTool.func(args, this.e)
            if (this.debug) {
              console.info(JSON.stringify(functionResponse.response.content))
            }
          } catch (err) {
            console.error(err)
            functionResponse.response.content = {
              error: `Function execute error: ${err.message}`
            }
          }
        }
        fcResults.push(functionResponse)
      }
      let responseOpt = _.cloneDeep(opt)
      responseOpt.parentMessageId = idModel
      responseOpt.functionResponse = fcResults
      await this.upsertMessage(thisMessage)
      responseContent = handleSearchResponse(responseContent).responseContent
      const respMessage = Object.assign(responseContent, {
        id: idModel,
        parentMessageId: idThis
      })
      await this.upsertMessage(respMessage)
      // The recursive call is now handled by the main sendMessage retry loop
      return await this.sendMessage('', responseOpt)
    }
    if (responseContent) {
      await this.upsertMessage(thisMessage)
      const respMessage = Object.assign(responseContent, {
        id: idModel,
        parentMessageId: idThis
      })
      await this.upsertMessage(respMessage)
    }
    
    if (!responseContent) {
      return {
        text: '',
        conversationId: '',
        parentMessageId: idThis,
        id: idModel
      }
    }
    
    let { final } = handleSearchResponse(responseContent)
    try {
      if (groundingMetadata?.groundingChunks) {
        final += '\n参考资料\n'
        groundingMetadata.groundingChunks.forEach(chunk => {
          final += `[${chunk.web.title}]\n`
        })
        if (groundingMetadata.webSearchQueries && Array.isArray(groundingMetadata.webSearchQueries)) {
          groundingMetadata.webSearchQueries.forEach(q => {
            console.info('search query: ' + q)
          })
        }
      }
    } catch (err) {
      console.warn(err)
    }

    return {
      text: final,
      conversationId: '',
      parentMessageId: idThis,
      id: idModel
    }
  }
}

/**
 * 处理成单独的text
 * @param {Content} responseContent
 * @returns {{final: string, responseContent}}
 */
function handleSearchResponse (responseContent) {
  let final = ''

  // 检查responseContent和parts是否存在
  if (!responseContent || !responseContent.parts || !Array.isArray(responseContent.parts)) {
    return {
      final: '',
      responseContent: responseContent || { parts: [] }
    }
  }

  // 遍历每个 part 并处理
  responseContent.parts = responseContent.parts.map((part) => {
    let newText = ''

    if (part.text) {
      newText += part.text
      final += part.text // 累积到 final
    }
    if (part.executableCode) {
      const codeBlock = '\n执行代码：\n' + '```' + part.executableCode.language + '\n' + part.executableCode.code.trim() + '\n```\n\n'
      newText += codeBlock
      final += codeBlock // 累积到 final
    }
    if (part.codeExecutionResult) {
      const resultBlock = `\n执行结果(${part.codeExecutionResult.outcome})：\n` + '```\n' + part.codeExecutionResult.output + '\n```\n\n'
      newText += resultBlock
      final += resultBlock // 累积到 final
    }

    // 返回更新后的 part，但不设置空的 text
    const updatedPart = { ...part }
    if (newText) {
      updatedPart.text = newText // 仅在 newText 非空时设置 text
    } else {
      delete updatedPart.text // 如果 newText 是空的，则删除 text 字段
    }

    return updatedPart
  })

  return {
    final,
    responseContent
  }
}
