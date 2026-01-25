"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TranscriptEntry {
  timestamp: number;
  speakerId: string;
  text: string;
  isFinal: boolean;
}

interface AIMessage {
  timestamp: number;
  message: string;
  nodeId?: string;
}

interface LLMLog {
  timestamp: number;
  nodeId?: string;
  prompt: string;
  rawResponse: string;
}

interface GraspConfig {
  configId: string;
  name: string;
  yaml: string;
  createdAt: number;
}

interface Meeting {
  meetingId: string;
  platform: string;
  status: string;
  meetingCode?: string;
  recallBot?: {
    botId: string;
    meetingUrl: string;
    platform: string;
    status: string;
  };
}

export default function MeetingDetailClient({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [llmLogs, setLlmLogs] = useState<LLMLog[]>([]);
  const [activeTab, setActiveTab] = useState<"transcript" | "ai" | "logs" | "config">("transcript");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graspConfigs, setGraspConfigs] = useState<GraspConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [selectedConfigYaml, setSelectedConfigYaml] = useState<string>("");
  const [customYaml, setCustomYaml] = useState<string>("");
  const [configLoading, setConfigLoading] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);

  useEffect(() => {
    const fetchMeeting = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
        const response = await fetch(`${apiUrl}/recall/meetings/${meetingId}`);

        if (!response.ok) {
          throw new Error("会議情報の取得に失敗しました");
        }

        const data = await response.json();
        setMeeting(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        setLoading(false);
      }
    };

    fetchMeeting();
  }, [meetingId]);

  // 新しいuseEffectを追加: ポーリングでメッセージ取得
  useEffect(() => {
    if (!meeting) return;

    let lastTimestamp = 0;

    const pollMessages = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
        const response = await fetch(
          `${apiUrl}/meetings/${meetingId}/messages?since=${lastTimestamp}&limit=100`
        );

        if (!response.ok) {
          console.error('Failed to poll messages', response.status);
          return;
        }

        const data = await response.json();

        // メッセージをtype別に分類・追加
        data.messages.forEach((msg: any) => {
          if (msg.type === 'transcript') {
            try {
              const transcriptData = JSON.parse(msg.message);
              setTranscripts(prev => [...prev, {
                timestamp: msg.timestamp,
                speakerId: transcriptData.speakerId,
                text: transcriptData.text,
                isFinal: transcriptData.isFinal,
              }]);
            } catch (e) {
              console.error('Failed to parse transcript', e);
            }
          } else if (msg.type === 'ai_intervention') {
            setAiMessages(prev => [...prev, {
              timestamp: msg.timestamp,
              message: msg.message,
            }]);
          } else if (msg.type === 'llm_call') {
            try {
              const logData = JSON.parse(msg.message);
              setLlmLogs(prev => [...prev, {
                timestamp: msg.timestamp,
                nodeId: logData.nodeId,
                prompt: logData.prompt,
                rawResponse: logData.rawResponse,
              }]);
            } catch (e) {
              console.error('Failed to parse LLM log', e);
            }
          }
        });

        // 最新タイムスタンプを更新
        if (data.messages.length > 0) {
          lastTimestamp = Math.max(...data.messages.map((m: any) => m.timestamp));
        }
      } catch (err) {
        console.error('Failed to poll messages', err);
      }
    };

    // 初回取得
    pollMessages();

    // 2秒ごとにポーリング
    const interval = setInterval(pollMessages, 2000);

    return () => clearInterval(interval);
  }, [meeting, meetingId]);

  // Load Grasp configs when config tab is active
  useEffect(() => {
    if (activeTab !== 'config') return;

    const fetchConfigs = async () => {
      try {
        setConfigLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
        const response = await fetch(`${apiUrl}/grasp/configs`);

        if (!response.ok) {
          throw new Error('設定の取得に失敗しました');
        }

        const data = await response.json();
        setGraspConfigs(data.configs || []);
      } catch (err) {
        console.error('Failed to load Grasp configs', err);
      } finally {
        setConfigLoading(false);
      }
    };

    fetchConfigs();
  }, [activeTab]);

  // Handle config selection
  const handleSelectConfig = async (configId: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/grasp/configs/${configId}`);

      if (!response.ok) {
        throw new Error('設定の取得に失敗しました');
      }

      const data = await response.json();
      setSelectedConfigId(configId);
      setSelectedConfigYaml(data.config.yaml);
      setCustomYaml('');
    } catch (err) {
      alert(err instanceof Error ? err.message : '設定の取得に失敗しました');
    }
  };

  // Handle applying Grasp config to meeting
  const handleApplyConfig = async () => {
    try {
      setConfigLoading(true);
      setApplySuccess(false);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";

      const body = selectedConfigId
        ? { configId: selectedConfigId }
        : { yaml: customYaml };

      const response = await fetch(`${apiUrl}/meetings/${meetingId}/grasp-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '設定の適用に失敗しました');
      }

      setApplySuccess(true);
      setTimeout(() => setApplySuccess(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : '設定の適用に失敗しました');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm("ボットを会議から退出させますか？")) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/recall/meetings/${meetingId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("ボットの退出に失敗しました");
      }

      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          <p className="mt-2 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "会議が見つかりません"}</p>
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-800 transition-colors"
          >
            ダッシュボードに戻る
          </Link>
        </div>
      </div>
    );
  }

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

        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Meeting ID: {meeting.meetingId}
              </h1>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      meeting.status === "active" ? "bg-green-500" : "bg-gray-400"
                    }`}
                  ></div>
                  <span>Status: {meeting.status}</span>
                </div>
                {meeting.meetingCode && (
                  <span>Code: {meeting.meetingCode}</span>
                )}
                {meeting.recallBot && (
                  <>
                    <span>Platform: {meeting.recallBot.platform}</span>
                    <span>Bot Status: {meeting.recallBot.status}</span>
                  </>
                )}
              </div>
              {meeting.recallBot && (
                <p className="mt-2 text-sm text-gray-600">
                  URL: {meeting.recallBot.meetingUrl}
                </p>
              )}
            </div>
            <button
              onClick={handleLeave}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            >
              ボット退出
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              {[
                { id: "transcript", label: "文字起こし" },
                { id: "ai", label: "AI応答" },
                { id: "logs", label: "LLMログ" },
                { id: "config", label: "Grasp設定" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === "transcript" && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  リアルタイム文字起こし
                </h2>
                {transcripts.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    まだ文字起こしがありません
                  </p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {transcripts.map((entry, index) => (
                      <div
                        key={index}
                        className="flex space-x-3 text-sm"
                      >
                        <span className="text-gray-500 w-16 flex-shrink-0">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-gray-700 font-medium w-24 flex-shrink-0">
                          {entry.speakerId}:
                        </span>
                        <span className={entry.isFinal ? "text-gray-900" : "text-gray-400"}>
                          {entry.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "ai" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  AI介入
                </h2>
                {aiMessages.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    まだAI介入がありません
                  </p>
                ) : (
                  <div className="space-y-4">
                    {aiMessages.map((msg, index) => (
                      <div
                        key={index}
                        className="border border-gray-200 rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-gray-500">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                          {msg.nodeId && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              Grasp: {msg.nodeId}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-900">{msg.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "logs" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  LLM呼び出しログ
                </h2>
                {llmLogs.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    まだLLMログがありません
                  </p>
                ) : (
                  <div className="space-y-4">
                    {llmLogs.map((log, index) => (
                      <div
                        key={index}
                        className="border border-gray-200 rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm text-gray-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          {log.nodeId && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              Grasp: {log.nodeId}
                            </span>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1">
                              Prompt ({log.prompt.length} chars):
                            </h4>
                            <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto text-gray-800">
                              {log.prompt}
                            </pre>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1">
                              Response ({log.rawResponse.length} chars):
                            </h4>
                            <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto text-gray-800">
                              {log.rawResponse}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "config" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Grasp設定
                </h2>

                {applySuccess && (
                  <div className="mb-4 bg-green-50 border border-green-200 rounded-md p-4">
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
                    ) : graspConfigs.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">
                        保存済み設定がありません
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {graspConfigs.map((config) => (
                          <button
                            key={config.configId}
                            onClick={() => handleSelectConfig(config.configId)}
                            className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                              selectedConfigId === config.configId
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="font-medium text-gray-900">
                              {config.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(config.createdAt).toLocaleString('ja-JP')}
                            </div>
                          </button>
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
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            選択中の設定（YAML）
                          </label>
                          <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto max-h-64 overflow-y-auto font-mono">
                            {selectedConfigYaml}
                          </pre>
                        </div>
                        <button
                          onClick={handleApplyConfig}
                          disabled={configLoading}
                          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                        >
                          {configLoading ? '適用中...' : 'この設定を適用'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            カスタムYAML設定
                          </label>
                          <textarea
                            value={customYaml}
                            onChange={(e) => setCustomYaml(e.target.value)}
                            rows={10}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                            spellCheck={false}
                            placeholder="grasps:&#10;  - nodeId: example&#10;    promptTemplate: |&#10;      プロンプト内容&#10;    intervalSec: 30&#10;    outputHandler: chat"
                          />
                        </div>
                        <button
                          onClick={handleApplyConfig}
                          disabled={configLoading || !customYaml.trim()}
                          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                        >
                          {configLoading ? '適用中...' : 'カスタム設定を適用'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">
                    使い方
                  </h4>
                  <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>左側から保存済み設定を選択してプレビュー・適用できる</li>
                    <li>右側でカスタムYAMLを直接入力して適用することもできる</li>
                    <li>設定を適用すると、この会議のGraspが更新される</li>
                    <li>チャットにて設定適用の通知が表示される</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
