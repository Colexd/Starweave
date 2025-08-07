export const supportGuoba = () => {
  return {
    // 插件信息，将会显示在前端页面
    pluginInfo: {
      name: 'myproject',
      title: 'Gemini AI 聊天插件',
      author: '@ikechan8370',
      authorLink: 'https://github.com/ikechan8370',
      link: 'https://github.com/ikechan8370/chatgpt-plugin',
      isV3: true,
      isV2: false,
      description: '基于 Gemini AI 的智能对话插件，支持语音合成、图片识别、定时问候等功能',
      // 显示图标，此为个性化配置
      // 图标可在 https://icon-sets.iconify.design 这里进行搜索
      icon: 'mdi:robot-outline',
      // 图标颜色，例：#FF0000 或 rgb(255, 0, 0)
      iconColor: '#4285f4'
    },
    // 配置项信息
    configInfo: {
      // 配置项 schemas
      schemas: [
        {
          component: 'Divider',
          label: '基础配置'
        },
        {
          field: 'enable',
          label: '启用插件',
          bottomHelpMessage: '是否启用 Gemini AI 聊天插件',
          component: 'Switch'
        },
        {
          field: 'apiBaseUrl',
          label: 'API 基础地址',
          bottomHelpMessage: 'Gemini API 的基础 URL，如：https://api.gemini.ai',
          component: 'Input',
          required: true
        },
        {
          field: 'apiKey',
          label: 'API 密钥',
          bottomHelpMessage: 'Gemini API 密钥，从 Google AI Studio 获取',
          component: 'InputPassword',
          required: true
        },
        {
          field: 'model',
          label: '模型选择',
          bottomHelpMessage: '选择要使用的 Gemini 模型',
          component: 'Select',
          componentProps: {
            options: [
              { label: 'gemini-pro', value: 'gemini-pro' },
              { label: 'gemini-pro-vision', value: 'gemini-pro-vision' },
              { label: 'gemini-1.5-pro', value: 'gemini-1.5-pro' },
              { label: 'gemini-1.5-flash', value: 'gemini-1.5-flash' }
            ]
          }
        },
        {
          component: 'Divider',
          label: '对话配置'
        },
        {
          field: 'toggleMode',
          label: '触发模式',
          bottomHelpMessage: '选择插件的触发方式',
          component: 'Select',
          componentProps: {
            options: [
              { label: '前缀模式（需要 # 前缀）', value: 'prefix' },
              { label: '艾特模式（艾特机器人）', value: 'at' },
              { label: '关键词模式', value: 'keyword' }
            ]
          }
        },
        {
          field: 'conversationPreserveTime',
          label: '对话保留时间',
          bottomHelpMessage: '单个对话的上下文保留时间（秒），0 表示永久保留',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            max: 86400,
            placeholder: '3600'
          }
        },
        {
          field: 'maxTokens',
          label: '最大令牌数',
          bottomHelpMessage: '单次请求的最大 token 数量',
          component: 'InputNumber',
          componentProps: {
            min: 100,
            max: 8000,
            placeholder: '2000'
          }
        },
        {
          component: 'Divider',
          label: '语音配置'
        },
        {
          field: 'defaultUseTTS',
          label: '默认启用语音',
          bottomHelpMessage: '新用户是否默认启用语音回复',
          component: 'Switch'
        },
        {
          field: 'ttsMode',
          label: 'TTS 模式',
          bottomHelpMessage: '选择语音合成服务',
          component: 'Select',
          componentProps: {
            options: [
              { label: 'VITS', value: 'vits-uma-genshin-honkai' },
              { label: 'VoiceVox', value: 'voicevox' }
            ]
          }
        },
        {
          field: 'ttsSpace',
          label: 'VITS 服务地址',
          bottomHelpMessage: 'VITS 语音合成服务的地址',
          component: 'Input'
        },
        {
          field: 'voicevoxSpace',
          label: 'VoiceVox 服务地址',
          bottomHelpMessage: 'VoiceVox 语音合成服务的地址',
          component: 'Input'
        },
        {
          component: 'Divider',
          label: '图片配置'
        },
        {
          field: 'defaultUsePicture',
          label: '默认使用图片回复',
          bottomHelpMessage: '是否默认以图片形式回复消息',
          component: 'Switch'
        },
        {
          field: 'enableMd',
          label: '启用 Markdown 渲染',
          bottomHelpMessage: '是否启用 Markdown 格式的消息渲染',
          component: 'Switch'
        },
        {
          component: 'Divider',
          label: '网络配置'
        },
        {
          field: 'proxy',
          label: '代理设置',
          bottomHelpMessage: '网络代理地址，如：http://127.0.0.1:7890',
          component: 'Input'
        },
        {
          field: 'timeout',
          label: '请求超时时间',
          bottomHelpMessage: 'API 请求超时时间（毫秒）',
          component: 'InputNumber',
          componentProps: {
            min: 5000,
            max: 300000,
            placeholder: '120000'
          }
        },
        {
          component: 'Divider',
          label: '高级配置'
        },
        {
          field: 'debug',
          label: '调试模式',
          bottomHelpMessage: '开启后会输出更多日志信息',
          component: 'Switch'
        },
        {
          field: 'blockWords',
          label: '屏蔽词列表',
          bottomHelpMessage: '包含这些词的消息将被过滤，一行一个',
          component: 'InputTextArea',
          componentProps: {
            placeholder: '请输入屏蔽词，一行一个',
            rows: 4
          }
        },
        {
          field: 'groupAdminPage',
          label: '群管功能',
          bottomHelpMessage: '是否启用群管理功能',
          component: 'Switch'
        }
      ],
      // 获取配置
      getConfigData() {
        // 这里应该从实际的配置文件中读取数据
        // 暂时返回默认配置
        const config = {
          enable: true,
          apiBaseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: '',
          model: 'gemini-pro',
          toggleMode: 'prefix',
          conversationPreserveTime: 3600,
          maxTokens: 2000,
          defaultUseTTS: false,
          ttsMode: 'vits-uma-genshin-honkai',
          ttsSpace: '',
          voicevoxSpace: '',
          defaultUsePicture: false,
          enableMd: false,
          proxy: '',
          timeout: 120000,
          debug: false,
          blockWords: '',
          groupAdminPage: false
        }
        return config
      },
      // 设置配置
      setConfigData(data, { Result }) {
        // 这里可以添加配置保存逻辑
        // 验证必填字段
        if (!data.apiKey) {
          return Result.error('API 密钥不能为空')
        }
        if (!data.apiBaseUrl) {
          return Result.error('API 基础地址不能为空')
        }
        
        // 保存配置到配置文件
        // 这里需要根据实际的配置文件格式来实现
        
        return Result.ok({}, '保存成功~')
      }
    }
  }
}
