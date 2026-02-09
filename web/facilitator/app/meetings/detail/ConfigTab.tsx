"use client";

import EditModal from "./EditModal";

interface GraspConfig {
  configId: string;
  name: string;
  yaml: string;
  createdAt: number;
  updatedAt?: number;
}

interface GroupedConfig {
  name: string;
  latestVersion: GraspConfig;
  versions: GraspConfig[];
  expanded: boolean;
}

interface CurrentConfig {
  configId: string | null;
  name: string | null;
  yaml: string | null;
}

interface ConfigTabProps {
  meetingId: string;
  groupedConfigs: GroupedConfig[];
  currentConfig: CurrentConfig | null;
  selectedConfigId: string | null;
  selectedConfigYaml: string;
  editedYaml: string;
  isEditModalOpen: boolean;
  configName: string;
  configLoading: boolean;
  applySuccess: boolean;
  onSelectConfig: (configId: string, name: string) => void;
  onToggleVersionExpansion: (name: string) => void;
  onEditYamlChange: (yaml: string) => void;
  onConfigNameChange: (name: string) => void;
  onApplyConfig: (saveAsNew: boolean) => void;
  onOpenEditModal: () => void;
  onCloseEditModal: () => void;
  onSaveAndApply: () => void;
}

export default function ConfigTab({
  meetingId,
  groupedConfigs,
  currentConfig,
  selectedConfigId,
  selectedConfigYaml,
  editedYaml,
  isEditModalOpen,
  configName,
  configLoading,
  applySuccess,
  onSelectConfig,
  onToggleVersionExpansion,
  onEditYamlChange,
  onConfigNameChange,
  onApplyConfig,
  onOpenEditModal,
  onCloseEditModal,
  onSaveAndApply,
}: ConfigTabProps) {

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Grasp設定
      </h2>

      {/* 現在適用中の設定 */}
      {!configLoading && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4" data-testid="current-config-display">
          <h3 className="text-sm font-medium text-blue-900 mb-2">
            現在適用中の設定
          </h3>
          {currentConfig && currentConfig.configId ? (
            <div>
              <p className="text-blue-800 font-medium" data-testid="current-config-name">{currentConfig.name}</p>
              <p className="text-xs text-blue-600" data-testid="current-config-id">ID: {currentConfig.configId}</p>
            </div>
          ) : (
            <p className="text-blue-800" data-testid="no-config-applied">現在表示できません</p>
          )}
        </div>
      )}

      {applySuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-md p-4" data-testid="apply-success-message">
          <p className="text-green-800">設定を適用しました</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 左側: 保存済み設定の一覧 */}
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-md font-medium text-gray-900 mb-3">
            保存済み設定
          </h3>
          {configLoading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            </div>
          ) : groupedConfigs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              保存済み設定がありません
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="saved-configs-list">
              {groupedConfigs.map((group) => (
                <div key={group.name} className="border border-gray-200 rounded" data-testid={`config-group-${group.name}`}>
                  {/* グループヘッダー（最新バージョン） */}
                  <div className="flex items-start">
                    <button
                      onClick={() => onSelectConfig(group.latestVersion.configId, group.name)}
                      className={`flex-1 text-left px-3 py-2 transition-colors ${
                        selectedConfigId === group.latestVersion.configId
                          ? 'bg-blue-50'
                          : 'hover:bg-gray-50'
                      }`}
                      data-testid={`config-version-${group.latestVersion.configId}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {group.name}
                        </span>
                        {currentConfig?.configId === group.latestVersion.configId && (
                          <span className="text-xs text-green-600 font-medium" data-testid="currently-applied-badge">
                            現在適用中
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(group.latestVersion.createdAt).toLocaleString('ja-JP')}
                      </div>
                    </button>
                    {group.versions.length > 1 && (
                      <button
                        onClick={() => onToggleVersionExpansion(group.name)}
                        className="px-2 py-2 text-gray-500 hover:text-gray-700"
                        title={group.expanded ? "バージョン一覧を隠す" : "過去のバージョンを表示"}
                        data-testid={`expand-versions-button-${group.name}`}
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
                          onClick={() => onSelectConfig(version.configId, group.name)}
                          className={`w-full text-left px-6 py-2 text-sm transition-colors ${
                            selectedConfigId === version.configId
                              ? 'bg-blue-50'
                              : 'hover:bg-gray-100'
                          }`}
                          data-testid={`config-version-${version.configId}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">
                              {new Date(version.createdAt).toLocaleString('ja-JP')}
                            </span>
                            {currentConfig?.configId === version.configId && (
                              <span className="text-xs text-green-600 font-medium" data-testid="currently-applied-badge">
                                現在適用中
                              </span>
                            )}
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
          {selectedConfigId ? (
            <div className="space-y-3">
              {/* 設定名（読み取り専用） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  設定名
                </label>
                <div className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-gray-900" data-testid="config-name-display">
                  {configName}
                </div>
              </div>

              {/* YAML表示（読み取り専用） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  YAML設定
                </label>
                <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto max-h-64 overflow-y-auto font-mono" data-testid="config-yaml-display">
                  {selectedConfigYaml}
                </pre>
              </div>

              {/* 操作ボタン（横並び） */}
              <div className="flex space-x-2">
                <button
                  onClick={() => onApplyConfig(false)}
                  disabled={configLoading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                  data-testid="apply-config-button"
                >
                  {configLoading ? '適用中...' : '適用'}
                </button>
                <button
                  onClick={onOpenEditModal}
                  disabled={configLoading}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:bg-gray-200 disabled:cursor-not-allowed transition-colors font-medium"
                  data-testid="edit-button"
                >
                  編集
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">
              左側から保存済み設定を選択してください
            </p>
          )}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-2">
          使い方
        </h4>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>左側から保存済み設定を選択すると、最新バージョンが選択される</li>
          <li>▼ボタンで過去のバージョンを表示・選択できる</li>
          <li>「編集」ボタンでモーダルが開き、内容を編集できる</li>
          <li>「適用」ボタンでこの設定を会議に適用できる</li>
        </ul>
      </div>

      {/* 編集用モーダル */}
      <EditModal
        isOpen={isEditModalOpen}
        configName={configName}
        editedYaml={editedYaml}
        onYamlChange={onEditYamlChange}
        onConfigNameChange={onConfigNameChange}
        onSaveAndApply={onSaveAndApply}
        onDiscard={onCloseEditModal}
      />
    </div>
  );
}
