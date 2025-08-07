# Yunzai插件模板

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D16.0.0-green.svg)](https://nodejs.org/)

一个通用的 Yunzai-Bot 插件开发模板，提供了完整的项目结构和基础功能。

## ✨ 特性

- 🎯 **现代化架构** - 基于 ES6 模块和最新的 Node.js 特性
- 🔧 **完整配置系统** - 支持配置文件管理和热更新
- 🎨 **模块化设计** - 清晰的目录结构和代码组织
- 📱 **锅巴面板支持** - 内置锅巴面板配置界面
- 🚀 **开箱即用** - 包含常用工具函数和示例代码
- 🛡️ **权限控制** - 支持用户和群组权限管理

## 📁 项目结构

```
yunzai-plugin-template/
├── apps/                   # 功能模块
│   └── example.js         # 示例功能
├── config/                # 配置文件
│   ├── config.json        # 主配置文件
│   ├── config.example.json # 配置示例
│   └── config.md          # 配置说明
├── resources/             # 资源文件
│   └── help/              # 帮助模板
├── utils/                 # 工具函数
│   ├── config.js          # 配置管理
│   └── common.js          # 通用工具
├── index.js               # 入口文件
├── guoba.support.js       # 锅巴面板支持
├── package.json           # 项目配置
└── README.md              # 说明文档
```

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 配置插件

1. 复制配置示例文件：
   ```bash
   cp config/config.example.json config/config.json
   ```

2. 根据需要修改 `config/config.json` 中的配置项

### 使用插件

将插件放置到 Yunzai-Bot 的 `plugins` 目录下，重启机器人即可。

### 基础命令

- `#插件测试` - 测试插件是否正常运行
- `#插件帮助` - 显示插件帮助信息

## 🔧 配置说明

### 基础配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enable` | boolean | `true` | 是否启用插件 |
| `pluginName` | string | `"Yunzai插件模板"` | 插件显示名称 |
| `debug` | boolean | `false` | 是否开启调试模式 |

### 权限配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `allowGroups` | Array | `[]` | 允许使用的群组ID列表 |
| `allowUsers` | Array | `[]` | 允许使用的用户ID列表 |

详细配置说明请参考 [config/config.md](config/config.md)

## 🛠️ 开发指南

### 添加新功能

1. 在 `apps/` 目录下创建新的 JS 文件
2. 继承 `plugin` 类并实现功能
3. 在构造函数中定义触发规则

示例：

```javascript
import plugin from '../../../lib/plugins/plugin.js'

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
    await this.reply('Hello World!')
    return true
  }
}
```

### 使用工具函数

```javascript
import { formatTime, randomString, sleep } from '../utils/common.js'
import { Config } from '../utils/config.js'

// 获取配置
const pluginName = Config.pluginName

// 格式化时间
const now = formatTime(new Date(), 'YYYY-MM-DD HH:mm:ss')

// 生成随机字符串
const id = randomString(8)

// 延迟执行
await sleep(1000)
```

### 配置管理

```javascript
import { Config } from '../utils/config.js'

// 读取配置
const value = Config.get('myKey', 'defaultValue')

// 设置配置
Config.set('myKey', 'newValue')

// 检查权限
if (!Config.checkPermission(e)) {
  await this.reply('没有权限使用此功能')
  return false
}
```

## 📝 更新日志

### v1.0.0 (2024-01-01)
- 🎉 初始版本发布
- ✨ 提供基础项目结构
- 🔧 实现配置管理系统
- 📱 添加锅巴面板支持

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。

## 🙏 致谢

感谢 [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) 提供的优秀框架。
