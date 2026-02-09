"use client";

import { useEffect } from "react";

interface EditModalProps {
  isOpen: boolean;
  configName: string;
  editedYaml: string;
  isLoading?: boolean;
  onYamlChange: (yaml: string) => void;
  onConfigNameChange: (name: string) => void;
  onSaveAndApply: () => void;
  onDiscard: () => void;
}

export default function EditModal({
  isOpen,
  configName,
  editedYaml,
  isLoading = false,
  onYamlChange,
  onConfigNameChange,
  onSaveAndApply,
  onDiscard,
}: EditModalProps) {
  // ESCキーでモーダルを閉じる
  useEffect(() => {
    if (!isOpen || isLoading) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDiscard();
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, isLoading, onDiscard]);

  if (!isOpen) return null;

  return (
    <>
      {/* 背景オーバーレイ */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={isLoading ? undefined : onDiscard}
        data-testid="modal-backdrop"
      />

      {/* モーダル本体 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
          {/* ヘッダー */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Grasp設定を編集
            </h3>
            <button
              onClick={onDiscard}
              disabled={isLoading}
              className="text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="閉じる"
              data-testid="modal-close-button"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* コンテンツ */}
          <div className="p-6 overflow-y-auto flex-1">
            <div className="space-y-4">
              {/* 設定名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  設定名
                </label>
                <input
                  type="text"
                  value={configName}
                  onChange={(e) => onConfigNameChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  data-testid="modal-config-name-input"
                />
                <p className="text-xs text-gray-500 mt-1">
                  同じ名前の場合は新しいバージョンとして保存されます
                </p>
              </div>

              {/* YAML編集エリア */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  YAML設定
                </label>
                <textarea
                  value={editedYaml}
                  onChange={(e) => onYamlChange(e.target.value)}
                  rows={16}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                  spellCheck={false}
                  data-testid="modal-yaml-textarea"
                />
              </div>
            </div>
          </div>

          {/* フッター（ボタン） */}
          <div className="p-6 border-t border-gray-200">
            <div className="flex space-x-3">
              <button
                onClick={onSaveAndApply}
                disabled={isLoading}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors font-medium"
                data-testid="modal-save-and-apply-button"
              >
                {isLoading ? '保存中...' : '保存して適用'}
              </button>
              <button
                onClick={onDiscard}
                disabled={isLoading}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:bg-gray-200 disabled:cursor-not-allowed transition-colors font-medium"
                data-testid="modal-discard-button"
              >
                編集を破棄
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
