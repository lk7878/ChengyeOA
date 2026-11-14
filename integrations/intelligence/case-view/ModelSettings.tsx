import React, { useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';

export function ModelSettings({ model }: { model: any }) {
  const [baseURL, setBaseURL] = useState(model.settings.baseURL || 'https://api.deepseek.com');
  const [name, setName] = useState(model.settings.model || 'deepseek-chat');
  const [apiKey, setApiKey] = useState(''); const [message, setMessage] = useState('');
  const [working, setWorking] = useState(''); const [failed, setFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const edit = (set: (value: string) => void, value: string) => { set(value); setMessage(''); setFailed(false); };
  const execute = async (operation: 'save' | 'test' | 'clear') => {
    setWorking(operation); setMessage(''); setFailed(false);
    try {
      const values = { baseURL, model: name, apiKey };
      if (operation === 'test') { const result = await model.testSettings(values); setMessage(`${result.message}（${result.latencyMs}毫秒）`); }
      if (operation === 'save') { await model.saveSettings(values); setApiKey(''); setMessage('组织模型配置已加密保存，所有获授权用户下次发送时生效'); }
      if (operation === 'clear') { await model.clearSettings(); setApiKey(''); setConfirmClear(false); setMessage('界面配置已清除；如部署环境提供默认模型则恢复使用，否则暂停新模型调用'); }
    } catch (e) { setFailed(true); setMessage((e as Error).message); }
    finally { setWorking(''); }
  };
  if (!model.settings.canManage) return <p>AI模型由管理员统一配置。请联系管理员处理模型配置或使用授权。</p>;
  return <form className="native-panel-content native-model-settings" onSubmit={event => { event.preventDefault(); void execute('save'); }}>
    <p>管理员统一配置，供组织内已获“智慧办案”权限的用户使用。用户无需填写API Key；会话与材料仍按账号隔离。</p>
    <p>支持 OpenAI Chat Completions 兼容接口，模型需支持流式输出及工具调用。</p>
    <label>Base URL<input aria-label="模型Base URL" type="url" required disabled={!!working} value={baseURL} onChange={e => edit(setBaseURL, e.target.value)} placeholder="https://api.example.com/v1" /></label>
    <label>模型名称<input aria-label="模型名称" required disabled={!!working} maxLength={200} value={name} onChange={e => edit(setName, e.target.value)} /></label>
    <label>API Key<input aria-label="模型API Key" type="password" autoComplete="new-password" disabled={!!working} maxLength={4096} value={apiKey} onChange={e => edit(setApiKey, e.target.value)} placeholder={model.settings.configured ? '已配置；同地址留空保留密钥' : '请输入API Key'} /></label>
    <p>密钥加密保存在服务器，不会回显或下发给普通用户。材料提取文本、对话和知识库引用会按需发送至该模型服务。</p>
    <p>连通性测试仅发送固定测试文本，可能产生少量模型调用费用；不会发送业务资料，也不会保存或启用未保存的配置。</p>
    <Button type="button" variant="outline" disabled={!!working} onClick={() => void execute('test')}>{working === 'test' ? '正在测试…' : '测试连通性'}</Button>
    <Button variant="primary" type="submit" disabled={!!working}>{working === 'save' ? '正在保存…' : '保存模型配置'}</Button>
    {model.settings.source === 'administrator' && (confirmClear ? <div role="group" aria-label="确认清除组织模型配置"><p>清除将影响所有获授权用户后续的模型调用，是否继续？</p><Button type="button" disabled={!!working} onClick={() => setConfirmClear(false)}>取消</Button><Button type="button" disabled={!!working} onClick={() => void execute('clear')}>确认清除</Button></div> : <Button type="button" disabled={!!working} onClick={() => setConfirmClear(true)}>清除组织模型配置</Button>)}
    <p role={failed ? 'alert' : 'status'}>{message || (model.settings.configured ? '组织模型已配置' : '管理员尚未配置模型')}</p>
    <p>使用授权：在OA管理中心的角色与权限中勾选“智慧办案”，再在账号管理中将该角色分配给指定用户。</p>
  </form>;
}
