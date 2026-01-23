"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function ConfigPage() {
  const [config, setConfig] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
        const response = await fetch(`${apiUrl}/grasp/config/current`);

        if (!response.ok) {
          throw new Error("設定の取得に失敗しました");
        }

        const data = await response.json();
        setConfig(data.yaml || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
        // フォールバック: デフォルト設定
        setConfig(`grasps:
  - nodeId: silence-monitor
    promptTemplate: |
      以下の会議文字起こしで沈黙が30秒以上続いているか判断してください。
      {{INPUT:past5m}}
    intervalSec: 30
    outputHandler: chat

  - nodeId: topic-summary
    promptTemplate: |
      現在の議論のトピックを要約してください。
      {{INPUT:past10m}}
    intervalSec: 60
    outputHandler: chat
`);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/grasp/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ yaml: config }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "設定の保存に失敗しました");
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

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
              YAML形式でGraspの設定を編集できる。変更は保存後すぐに反映される。
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-6 bg-green-50 border border-green-200 rounded-md p-4">
              <p className="text-green-800">設定を保存しました</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <p className="mt-2 text-gray-600">読み込み中...</p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <label
                  htmlFor="config"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  YAML設定
                </label>
                <textarea
                  id="config"
                  value={config}
                  onChange={(e) => setConfig(e.target.value)}
                  rows={20}
                  className="w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                  spellCheck={false}
                />
                <p className="mt-2 text-sm text-gray-500">
                  構文エラーがある場合、保存時にエラーメッセージが表示される
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Link
                  href="/"
                  className="px-6 py-2 text-gray-700 hover:text-gray-900 transition-colors"
                >
                  キャンセル
                </Link>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {saving ? "保存中..." : "保存して適用"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-blue-900 mb-2">
            YAML設定のヒント
          </h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>各GraspにはnodeId、promptTemplate、intervalSec、outputHandlerが必要</li>
            <li>promptTemplateでは {"{{INPUT:past5m}}"} のような変数が使える</li>
            <li>intervalSecは秒単位で実行間隔を指定</li>
            <li>outputHandlerは通常 "chat" を指定</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
