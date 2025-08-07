# 开发指南

本文档介绍如何使用此插件模板进行开发。

## 快速开始

### 1. 克隆或下载模板
将此模板复制到你的 Yunzai-Bot 插件目录中。

### 2. 修改基本信息
- 修改 `package.json` 中的项目名称、作者等信息
- 修改 `README.md` 中的项目说明
- 修改 `guoba.support.js` 中的插件信息

### 3. 配置插件
复制 `config/config.example.json` 为 `config/config.json` 并根据需要修改配置。

### 4. 开发功能
在 `apps/` 目录下创建新的功能模块。

## 目录结构说明

```
yunzai-plugin-template/
├── apps/                   # 功能模块目录
├── client/                 # API客户端目录  
├── config/                 # 配置文件目录
├── model/                  # 数据模型目录
├── resources/              # 资源文件目录
├── utils/                  # 工具函数目录
├── index.js               # 插件入口文件
├── guoba.support.js       # 锅巴面板支持文件
└── package.json           # 项目配置文件
```

## 功能模块开发

### 创建新的功能模块

在 `apps/` 目录下创建新的 JS 文件，例如 `my-feature.js`：

```javascript
import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'

export class MyFeature extends plugin {
  constructor() {
    super({
      name: '我的功能',
      dsc: '功能描述',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#我的命令$',
          fnc: 'myMethod'
        }
      ]
    })
  }

  async myMethod(e) {
    // 检查权限
    if (!Config.checkPermission(e)) {
      await this.reply('没有权限使用此功能')
      return false
    }

    // 功能逻辑
    await this.reply('Hello World!')
    return true
  }
}
```

### 触发规则配置

在 `rule` 数组中定义触发规则：

```javascript
rule: [
  {
    reg: '^#命令名$',           // 正则表达式
    fnc: 'methodName'         // 处理函数名
  },
  {
    reg: '^#命令 (.+)$',        // 带参数的命令
    fnc: 'methodWithParam'
  }
]
```

### 消息回复

```javascript
// 简单文本回复
await this.reply('Hello World!')

// 回复图片
await this.reply(segment.image(imageBuffer))

// 回复转发消息
const msgs = ['消息1', '消息2', '消息3']
const forwardMsg = makeForwardMsg(e, msgs)
await this.reply(forwardMsg)
```

## API客户端开发

### 创建新的API客户端

在 `client/` 目录下创建新的客户端文件：

```javascript
import { HttpClient } from './BaseClient.js'

export class MyAPIClient extends HttpClient {
  constructor(options = {}) {
    super({
      baseURL: 'https://api.example.com',
      ...options
    })
  }

  async getData(params) {
    this.validateParams(params, ['id'])
    
    return this.retry(async () => {
      const response = await this.get(`/data/${params.id}`)
      return response
    })
  }
}
```

## 配置管理

### 读取配置

```javascript
import { Config } from '../utils/config.js'

// 读取配置项
const value = Config.get('myKey', 'defaultValue')

// 读取嵌套配置
const nestedValue = Config.get('section.key', 'defaultValue')
```

### 修改配置

```javascript
// 设置单个配置项
Config.set('myKey', 'newValue')

// 批量更新配置
Config.update({
  key1: 'value1',
  key2: 'value2'
})
```

### 权限检查

```javascript
// 检查用户/群组权限
if (!Config.checkPermission(e)) {
  await this.reply('没有权限使用此功能')
  return false
}
```

## 工具函数使用

### 通用工具

```javascript
import { 
  formatTime, 
  randomString, 
  sleep,
  isImage,
  makeForwardMsg 
} from '../utils/common.js'

// 格式化时间
const now = formatTime(new Date(), 'YYYY-MM-DD HH:mm:ss')

// 生成随机字符串
const id = randomString(8)

// 延迟执行
await sleep(1000)

// 检查是否为图片
if (isImage(msg)) {
  // 处理图片
}
```

## 数据模型使用

### 使用基础模型

```javascript
import { BaseModel, UserModel } from '../model/base.js'

// 创建用户模型
const user = new UserModel('123456', {
  nickname: '用户昵称',
  level: 1
})

// 获取数据
const nickname = user.getNickname()

// 设置数据
user.setNickname('新昵称')

// 转换为对象
const userData = user.toObject()
```

## 锅巴面板配置

在 `guoba.support.js` 中配置锅巴面板：

```javascript
// 配置项定义
schemas: [
  {
    field: 'myOption',
    label: '我的选项',
    component: 'Switch',
    bottomHelpMessage: '选项说明'
  }
]
```

支持的组件类型：
- `Switch` - 开关
- `Input` - 输入框
- `InputNumber` - 数字输入框
- `Select` - 下拉选择
- `Radio` - 单选
- `Checkbox` - 复选框

## 调试和日志

### 调试模式

在配置中开启调试模式：
```json
{
  "debug": true
}
```

### 日志输出

```javascript
// 根据调试模式输出日志
if (Config.debug) {
  logger.debug('调试信息')
}

// 错误日志
logger.error('错误信息', error)

// 信息日志
logger.info('信息')
```

## 最佳实践

1. **错误处理**：所有异步操作都应该有适当的错误处理
2. **权限检查**：敏感功能应该检查用户权限
3. **配置验证**：在使用配置前进行验证
4. **日志记录**：记录关键操作和错误信息
5. **代码复用**：将通用逻辑抽取到工具函数中

## 常见问题

### Q: 如何添加定时任务？
A: 可以在 `index.js` 中使用 `setInterval` 或第三方任务调度库。

### Q: 如何处理文件上传？
A: 可以在消息事件中检查附件类型并进行相应处理。

### Q: 如何集成数据库？
A: 可以在 `model/` 目录下创建数据库连接和操作模块。

### Q: 如何添加中间件？
A: 可以在基类中添加中间件逻辑，或使用插件系统的钩子功能。
