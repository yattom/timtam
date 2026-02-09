"use client";

import { useEffect, useRef } from "react";

interface EditModalProps {
  isOpen: boolean;
  configName: string;
  editedYaml: string;
  onYamlChange: (yaml: string) => void;
  onConfigNameChange: (name: string) => void;
  onSaveAndApply: () => void;
  onDiscard: () => void;
}

export default function EditModal({
  isOpen,
  configName,
  editedYaml,
  onYamlChange,
  onConfigNameChange,
  onSaveAndApply,
  onDiscard,
}: EditModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // 初期フォーカスを設定
  useEffect(() => {
    if (!isOpen) return;

    // モーダルが開いたら最初の入力フィールドにフォーカス
    firstInputRef.current?.focus();
  }, [isOpen]);

  // ESCキーでモーダルを閉じる & フォーカストラップ
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDiscard();
        return;
      }

      // Tabキーでフォーカストラップを実装
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
        );
        
        if (focusableElements.length === 0) return;
        
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          // Shift+Tab で最初の要素にいる場合、最後の要素へ
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          // Tab で最後の要素にいる場合、最初の要素へ
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onDiscard]);

  if (!isOpen) return null;

  return (
    <>
      {/* 背景オーバーレイ */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onDiscard}
        data-testid="modal-backdrop"
      />

      {/* モーダル本体 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
        >
          {/* ヘッダー */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h3 id="modal-title" className="text-lg font-semibold text-gray-900">
              Grasp設定を編集
            </h3>
            <button
              onClick={onDiscard}
              className="text-gray-400 hover:text-gray-600 transition-colors"
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
                  ref={firstInputRef}
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
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
                data-testid="modal-save-and-apply-button"
              >
                保存して適用
              </button>
              <button
                onClick={onDiscard}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors font-medium"
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
