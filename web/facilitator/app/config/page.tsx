"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GraspConfig, GroupedConfig, groupConfigsByName } from "@/lib/graspConfig";

export default function ConfigPage() {
  const [configs, setConfigs] = useState<GraspConfig[]>([]);
  const [groupedConfigs, setGroupedConfigs] = useState<GroupedConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<GraspConfig | null>(null);
  const [editedYaml, setEditedYaml] = useState("");
  const [configName, setConfigName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Load configs on mount
  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/grasp/configs`);

      if (!response.ok) {
        throw new Error("設定の取得に失敗しました");
      }

      const data = await response.json();
      const loadedConfigs = data.configs || [];
      setConfigs(loadedConfigs);
      setGroupedConfigs(groupConfigsByName(loadedConfigs));
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectConfig = async (configId: string, name: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/grasp/configs/${configId}`);

      if (!response.ok) {
        throw new Error('設定の取得に失敗しました');
      }

      const data = await response.json();
      const config = data.config;
      setSelectedConfigId(configId);
      setSelectedConfig(config);
      setEditedYaml(config.yaml);
      setConfigName(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定の取得に失敗しました');
    }
  };

  const toggleVersionExpansion = (name: string) => {
    setGroupedConfigs((prev) =>
      prev.map((group) =>
        group.name === name ? { ...group, expanded: !group.expanded } : group
      )
    );
  };

  const handleSaveAsNamed = async () => {
    if (!configName.trim()) {
      alert("設定名を入力してください");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const createdAt = Date.now();
      const response = await fetch(`${apiUrl}/grasp/configs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: configName, yaml: editedYaml, createdAt }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "設定の保存に失敗しました");
      }

      const data = await response.json();
      
      // Validate response data
      if (!data.configId || !data.name || !data.yaml || !data.createdAt) {
        throw new Error("サーバーからの応答が不正です");
      }
      
      const savedConfig: GraspConfig = {
        configId: data.configId,
        name: data.name,
        yaml: data.yaml,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };

      setSuccess(true);
      setShowSaveDialog(false);

      // Reload configs
      await loadConfigs();

      // Select the newly saved config
      setSelectedConfigId(savedConfig.configId);
      setSelectedConfig(savedConfig);
      setEditedYaml(savedConfig.yaml);

      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const yamlChanged = selectedConfig ? editedYaml !== selectedConfig.yaml : false;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="text-xl font-bold text-gray-900">
                Timtam Facilitator
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-800 transition-colors"
          >
            ← ダッシュボードに戻る
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Grasp設定
            </h1>
            <p className="text-gray-600">
              保存済みのGrasp設定を選択・編集して、新しいバージョンとして保存できる。
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-6 bg-green-50 border border-green-200 rounded-md p-4" data-testid="dashboard-save-success-message">
              <p className="text-green-800">設定を保存しました</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <p className="mt-2 text-gray-600">読み込み中...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 左側: 保存済み設定の一覧 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-md font-medium text-gray-900">
                    保存済み設定
                  </h3>
                  <button
                    data-testid="dashboard-new-config-button"
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                    onClick={() => {
                      setSelectedConfigId(null);
                      setSelectedConfig(null);
                      setEditedYaml(`grasps:
  - nodeId: example-grasp
    promptTemplate: |
      ここにプロンプトを記述
    intervalSec: 30
    outputHandler: chat`);
                      setConfigName('');
                    }}
                  >
                    新規作成
                  </button>
                </div>
                {groupedConfigs.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    保存済み設定がありません
                  </p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="dashboard-saved-configs-list">
                    {groupedConfigs.map((group) => (
                      <div key={group.name} className="border border-gray-200 rounded" data-testid={`dashboard-config-group-${group.name}`}>
                        {/* グループヘッダー（最新バージョン） */}
                        <div className="flex items-start">
                          <button
                            data-testid={`dashboard-config-version-${group.latestVersion.configId}`}
                            onClick={() => handleSelectConfig(group.latestVersion.configId, group.name)}
                            className={`flex-1 text-left px-3 py-2 transition-colors ${
                              selectedConfigId === group.latestVersion.configId
                                ? 'bg-blue-50'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <div className="font-medium text-gray-900">
                              {group.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(group.latestVersion.createdAt).toLocaleString('ja-JP', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              })}
                            </div>
                          </button>
                          {group.versions.length > 1 && (
                            <button
                              data-testid={`dashboard-expand-versions-button-${group.name}`}
                              onClick={() => toggleVersionExpansion(group.name)}
                              className="px-2 py-2 text-gray-500 hover:text-gray-700"
                              title={group.expanded ? "バージョン一覧を隠す" : "過去のバージョンを表示"}
                            >
                              {group.expanded ? '▲' : '▼'}
                            </button>
                          )}
                        </div>

                        {/* 過去バージョン一覧 */}
                        {group.expanded && group.versions.length > 1 && (
                          <div className="border-t border-gray-200 bg-gray-50">
                            {group.versions.slice(1).map((version) => (
                              <button
                                key={version.configId}
                                data-testid={`dashboard-config-version-${version.configId}`}
                                onClick={() => handleSelectConfig(version.configId, group.name)}
                                className={`w-full text-left px-6 py-2 text-sm transition-colors ${
                                  selectedConfigId === version.configId
                                    ? 'bg-blue-50'
                                    : 'hover:bg-gray-100'
                                }`}
                              >
                                <div className="text-xs text-gray-500">
                                  {new Date(version.createdAt).toLocaleString('ja-JP', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                  })}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 右側: 設定プレビュー・編集 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-md font-medium text-gray-900 mb-3">
                  設定内容
                </h3>
                {selectedConfigId || editedYaml ? (
                  <div className="space-y-3">
                    {/* 設定名 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        設定名
                      </label>
                      <input
                        type="text"
                        data-testid="dashboard-config-name-input"
                        value={configName}
                        onChange={(e) => setConfigName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                      {yamlChanged && (
                        <p className="text-xs text-orange-600 mt-1" data-testid="dashboard-yaml-changed-notice">
                          内容が変更されています。新しいバージョンとして保存されます。
                        </p>
                      )}
                    </div>

                    {/* YAML編集 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        YAML設定
                      </label>
                      <textarea
                        data-testid="dashboard-config-yaml-textarea"
                        value={editedYaml}
                        onChange={(e) => setEditedYaml(e.target.value)}
                        rows={16}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                        spellCheck={false}
                      />
                    </div>

                    {/* 保存ボタン */}
                    <button
                      data-testid="dashboard-save-config-button"
                      onClick={() => setShowSaveDialog(true)}
                      disabled={saving}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                    >
                      名前を付けて保存
                    </button>
                  </div>
                ) : (
                  <div className="text-gray-500 text-center py-16">
                    左側から設定を選択してください
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-blue-900 mb-2">
            使い方
          </h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>左側から保存済み設定を選択すると、最新バージョンが表示される</li>
            <li>▼ボタンで過去のバージョンを表示・選択できる</li>
            <li>右側で内容を編集して「名前を付けて保存」で新しいバージョンとして保存</li>
            <li>ここで保存した設定は、会議詳細画面から選択して適用できる</li>
            <li><strong>注意: ダッシュボードでは進行中の会議に直接適用できない。会議詳細画面から適用すること</strong></li>
          </ul>
        </div>
      </main>

      {/* Save As Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4" data-testid="dashboard-save-dialog">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              設定に名前を付けて保存
            </h3>
            <div className="mb-4">
              <label htmlFor="saveConfigName" className="block text-sm font-medium text-gray-700 mb-2">
                設定名
              </label>
              <input
                id="saveConfigName"
                type="text"
                data-testid="dashboard-save-dialog-name-input"
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
                placeholder="例: 沈黙検知設定"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                タイムスタンプが自動的に付加され、同じ名前の新しいバージョンとして保存される
              </p>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                }}
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors"
              >
                キャンセル
              </button>
              <button
                data-testid="dashboard-confirm-save-button"
                onClick={handleSaveAsNamed}
                disabled={saving || !configName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
