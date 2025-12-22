import React, { useEffect, useState } from 'react';
import { getMultiPromptConfig, updateMultiPromptConfig, getPromptStates } from './api';

interface PromptConfig {
  id: string;
  name: string;
  promptText: string;
  trigger: any;
  stateful: boolean;
  outputTo: string;
  cooldownMs?: number;
}

interface Props {
  meetingId?: string;
}

export function MultiPromptConfig({ meetingId }: Props) {
  const [config, setConfig] = useState<any>(null);
  const [editingConfig, setEditingConfig] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [states, setStates] = useState<any>(null);
  const [showStates, setShowStates] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (meetingId && showStates) {
      const interval = setInterval(() => {
        loadStates();
      }, 3000);
      loadStates();
      return () => clearInterval(interval);
    }
  }, [meetingId, showStates]);

  const loadConfig = async () => {
    try {
      const result = await getMultiPromptConfig();
      setConfig(result.config);
      setEditingConfig(JSON.stringify(result.config, null, 2));
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const loadStates = async () => {
    if (!meetingId) return;
    try {
      const result = await getPromptStates(meetingId);
      setStates(result.states);
    } catch (e: any) {
      console.error('Failed to load prompt states:', e?.message || e);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(editingConfig);
      await updateMultiPromptConfig(parsed);
      setConfig(parsed);
      setMessage({ type: 'success', text: '設定を保存したよ' });
      setTimeout(() => setMessage(null), 3000);
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setEditingConfig(JSON.stringify(config, null, 2));
    setMessage(null);
  };

  if (loading) {
    return <div style={{ color: '#666' }}>マルチプロンプト設定を読み込み中...</div>;
  }

  return (
    <div>
      <h3>マルチプロンプト設定</h3>

      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, color: '#666', fontSize: 14 }}>
          複数のLLMプロンプトを定義して連携させることができる。JSON形式で設定してね。
        </div>

        <textarea
          value={editingConfig}
          onChange={(e) => setEditingConfig(e.target.value)}
          rows={20}
          style={{
            width: '100%',
            fontFamily: 'monospace',
            fontSize: 13,
            padding: 8,
            borderRadius: 4,
            border: '1px solid #ccc',
            resize: 'vertical',
            background: '#f9f9f9'
          }}
          disabled={saving}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button onClick={handleSave} disabled={saving || editingConfig === JSON.stringify(config, null, 2)}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button onClick={handleReset} disabled={saving || editingConfig === JSON.stringify(config, null, 2)}>
            リセット
          </button>
          <button onClick={() => setShowStates(!showStates)} disabled={!meetingId}>
            {showStates ? '状態を隠す' : '状態を表示'}
          </button>
          {message && (
            <span style={{
              color: message.type === 'success' ? '#27ae60' : '#c0392b',
              fontSize: 14,
              marginLeft: 4
            }}>
              {message.text}
            </span>
          )}
        </div>
      </div>

      {showStates && meetingId && (
        <div style={{ marginTop: 16 }}>
          <h4>プロンプト実行状態</h4>
          {!states && <div style={{ color: '#666' }}>状態を読み込み中...</div>}
          {states && (
            <div style={{
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: 12,
              background: '#f9f9f9',
              maxHeight: 400,
              overflowY: 'auto'
            }}>
              {Object.keys(states).length === 0 && (
                <div style={{ color: '#888' }}>まだ実行状態がない</div>
              )}
              {Object.entries(states).map(([promptId, state]: [string, any]) => (
                <div key={promptId} style={{
                  marginBottom: 16,
                  padding: 12,
                  background: 'white',
                  border: '1px solid #ddd',
                  borderRadius: 4
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: '#2980b9' }}>
                    {promptId}
                  </div>
                  <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
                    <div>
                      <span style={{ color: '#666' }}>実行回数:</span>{' '}
                      {state.executionCount || 0}
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>最終実行:</span>{' '}
                      {state.lastExecutedAt ? new Date(state.lastExecutedAt).toLocaleString('ja-JP') : 'なし'}
                    </div>
                    {state.memo && (
                      <div>
                        <span style={{ color: '#666' }}>メモ:</span>{' '}
                        <div style={{
                          marginTop: 4,
                          padding: 8,
                          background: '#fff9f0',
                          borderRadius: 4,
                          whiteSpace: 'pre-wrap',
                          fontSize: 12
                        }}>
                          {state.memo}
                        </div>
                      </div>
                    )}
                    {state.counters && Object.keys(state.counters).length > 0 && (
                      <div>
                        <span style={{ color: '#666' }}>カウンター:</span>{' '}
                        <div style={{
                          marginTop: 4,
                          padding: 8,
                          background: '#f0f8ff',
                          borderRadius: 4,
                          fontSize: 12
                        }}>
                          {JSON.stringify(state.counters, null, 2)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, background: '#fff9e6', border: '1px solid #f1c40f', borderRadius: 4, fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>設定例:</div>
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{`{
  "version": "1.0",
  "prompts": [
    {
      "id": "observer",
      "name": "会話観察者",
      "promptText": "会話を観察してメモを記録する",
      "trigger": { "type": "every" },
      "stateful": true,
      "outputTo": "memo"
    },
    {
      "id": "commentator",
      "name": "全体コメンテーター",
      "promptText": "メモを参照して全体的な流れについてコメント",
      "trigger": { "type": "interval", "intervalMs": 30000 },
      "stateful": false,
      "outputTo": "intervention"
    }
  ],
  "globalSettings": {
    "windowLines": 5,
    "defaultCooldownMs": 5000
  }
}`}</pre>
      </div>
    </div>
  );
}
