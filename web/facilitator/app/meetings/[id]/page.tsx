"use client";

import { useState, useEffect, use } from "react";
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

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [llmLogs, setLlmLogs] = useState<LLMLog[]>([]);
  const [activeTab, setActiveTab] = useState<"transcript" | "ai" | "logs">("transcript");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMeeting = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
        const response = await fetch(`${apiUrl}/recall/meetings/${resolvedParams.id}`);

        if (!response.ok) {
          throw new Error("会議情報の取得に失敗しました");
        }

        const data = await response.json();
        setMeeting(data);

        // TODO: リアルタイム更新（SSE or WebSocket）
        // 今はモックデータ
        setTranscripts([]);
        setAiMessages([]);
        setLlmLogs([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        setLoading(false);
      }
    };

    fetchMeeting();
  }, [resolvedParams.id]);

  const handleLeave = async () => {
    if (!confirm("ボットを会議から退出させますか？")) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/recall/meetings/${resolvedParams.id}`, {
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
          </div>
        </div>
      </main>
    </div>
  );
}
