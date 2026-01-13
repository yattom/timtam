import React, { useState, useEffect } from 'react';
import { getGraspPresets, getCurrentGraspConfig, updateGraspConfig, GraspPreset } from './api';

export function GraspConfigPanel() {
  const [presets, setPresets] = useState<GraspPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [currentYaml, setCurrentYaml] = useState<string>('');
  const [yamlEditing, setYamlEditing] = useState<string>('');
  const [yamlSaving, setYamlSaving] = useState<boolean>(false);
  const [validationStatus, setValidationStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 初回ロード: プリセット一覧と現在の設定を取得
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setIsLoading(true);

        // プリセット一覧を取得
        const presetList = await getGraspPresets();
        setPresets(presetList);

        // デフォルトプリセットを選択
        const defaultPreset = presetList.find(p => p.isDefault);
        if (defaultPreset) {
          setSelectedPresetId(defaultPreset.configId);
        } else if (presetList.length > 0) {
          setSelectedPresetId(presetList[0].configId);
        }

        // 現在の設定を取得
        try {
          const currentConfig = await getCurrentGraspConfig();
          setCurrentYaml(currentConfig.yaml);
          setYamlEditing(currentConfig.yaml);
        } catch (e: any) {
          // 現在の設定がない場合、デフォルトプリセットを使用
          if (defaultPreset) {
            setCurrentYaml(defaultPreset.yaml);
            setYamlEditing(defaultPreset.yaml);
          }
        }
      } catch (e: any) {
        console.error('Failed to load initial data', e);
        setValidationStatus({
          type: 'error',
          message: `初期データの読み込みに失敗: ${e?.message || String(e)}`
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []);

  const onSelectPreset = (presetId: string) => {
    const preset = presets.find(p => p.configId === presetId);
    if (preset) {
      setYamlEditing(preset.yaml);
      setSelectedPresetId(presetId);
      setValidationStatus({ type: null, message: '' });
    }
  };

  const onSaveYaml = async () => {
    setYamlSaving(true);
    setValidationStatus({ type: null, message: '' });

    try {
      await updateGraspConfig(yamlEditing);
      setCurrentYaml(yamlEditing);
      setValidationStatus({
        type: 'success',
        message: '設定を適用しました。orchestrator がリアルタイムで更新されます。'
      });
      setTimeout(() => setValidationStatus({ type: null, message: '' }), 5000);
    } catch (e: any) {
      const errorMsg = e?.message || String(e);
      setValidationStatus({
        type: 'error',
        message: `バリデーションエラー: ${errorMsg}`
      });
    } finally {
      setYamlSaving(false);
    }
  };

  const onResetYaml = () => {
    setYamlEditing(currentYaml);
    setValidationStatus({ type: null, message: '' });
  };

  const isModified = yamlEditing !== currentYaml;

  return (
    <details open={isExpanded} onToggle={(e) => setIsExpanded((e.target as HTMLDetailsElement).open)} style={{ marginBottom: 12 }} data-testid="grasp-config-section">
      <summary style={{ cursor: 'pointer', fontSize: 18, fontWeight: 600, padding: '8px 0' }}>
        Grasp 設定 (YAML)
      </summary>

      <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 6, background: '#fff9f0' }} data-testid="grasp-config-panel">
        {isLoading ? (
          <div style={{ padding: 12, textAlign: 'center', color: '#666' }}>
            読み込み中...
          </div>
        ) : (
          <>
            {/* プリセット選択 */}
            {presets.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
                  プリセット:
                </label>
                <select
                  value={selectedPresetId}
                  onChange={(e) => onSelectPreset(e.target.value)}
                  style={{
                    padding: '6px 8px',
                    fontSize: 14,
                    borderRadius: 4,
                    border: '1px solid #ccc',
                    background: '#fff',
                    minWidth: 200
                  }}
                  disabled={yamlSaving}
                >
                  {presets.map(p => (
                    <option key={p.configId} value={p.configId}>
                      {p.name}{p.isDefault ? ' (デフォルト)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* YAML エディタ */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
                YAML 設定:
              </label>
              <textarea
                value={yamlEditing}
                onChange={(e) => setYamlEditing(e.target.value)}
                rows={15}
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  padding: 8,
                  borderRadius: 4,
                  border: '1px solid #ccc',
                  resize: 'vertical',
                  background: '#fff'
                }}
                disabled={yamlSaving}
                placeholder="YAML 設定を入力してください"
                data-testid="grasp-yaml-textarea"
              />
            </div>

            {/* ステータス表示 */}
            {validationStatus.type && (
              <div style={{
                padding: 8,
                borderRadius: 4,
                marginBottom: 12,
                background: validationStatus.type === 'success' ? '#d4edda' : '#f8d7da',
                color: validationStatus.type === 'success' ? '#155724' : '#721c24',
                border: `1px solid ${validationStatus.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
                fontSize: 13
              }}>
                {validationStatus.message}
              </div>
            )}

            {/* ボタン */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                onClick={onSaveYaml}
                disabled={yamlSaving || !isModified}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  borderRadius: 4,
                  border: '1px solid #007bff',
                  background: yamlSaving || !isModified ? '#ccc' : '#007bff',
                  color: '#fff',
                  cursor: yamlSaving || !isModified ? 'not-allowed' : 'pointer',
                  fontWeight: 500
                }}
                data-testid="grasp-save-button"
              >
                {yamlSaving ? '保存中...' : '適用'}
              </button>
              <button
                onClick={onResetYaml}
                disabled={yamlSaving || !isModified}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  borderRadius: 4,
                  border: '1px solid #6c757d',
                  background: yamlSaving || !isModified ? '#e0e0e0' : '#fff',
                  color: '#333',
                  cursor: yamlSaving || !isModified ? 'not-allowed' : 'pointer'
                }}
              >
                リセット
              </button>
            </div>

            <div style={{ fontSize: 12, color: '#666' }}>
              設定を適用すると、orchestrator がリアルタイムで Grasp グループを再構築します。
              <br />
              YAML フォーマットの詳細は <a href="https://github.com/yattom/timtam/blob/main/docs/grasp-config.md" target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', textDecoration: 'underline' }}>ドキュメント</a> を参照してください。
            </div>
          </>
        )}
      </div>
    </details>
  );
}
