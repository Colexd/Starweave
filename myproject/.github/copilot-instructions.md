<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Yunzai-Bot 插件开发指南

这是一个 Yunzai-Bot 插件项目，请遵循以下开发规范：

## 项目结构
- `apps/` - 功能模块，每个文件应该导出一个继承自 plugin 的类
- `config/` - 配置文件目录
- `utils/` - 工具函数目录
- `resources/` - 资源文件目录

## 编码规范
- 使用 ES6 模块语法 (import/export)
- 所有插件类应继承自 `../../../lib/plugins/plugin.js`
- 配置管理使用 `utils/config.js` 中的 Config 对象
- 通用工具函数放在 `utils/common.js` 中

## 插件开发要点
- 在构造函数中定义 name、dsc、event、priority 和 rule
- rule 数组定义触发规则，包含 reg (正则表达式) 和 fnc (处理函数名)
- 处理函数应该是 async 函数，参数为事件对象 e
- 使用 this.reply() 回复消息，返回 true 表示处理成功

## 配置系统
- 使用 Config.get(key, defaultValue) 读取配置
- 使用 Config.set(key, value) 设置配置
- 使用 Config.checkPermission(e) 检查权限

## 示例代码参考
请参考 `apps/example.js` 中的示例实现。
